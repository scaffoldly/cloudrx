import {
  Observable,
  Subject,
  Subscription,
  defer,
  timer,
  of,
  EMPTY,
} from 'rxjs';
import {
  takeUntil,
  switchMap,
  map,
  tap,
  catchError,
  filter,
  shareReplay,
  expand,
  retry,
} from 'rxjs/operators';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBStreamsClient,
  DescribeStreamCommand,
  GetShardIteratorCommand,
  GetRecordsCommand,
  GetRecordsCommandOutput,
  _Record,
  Shard,
} from '@aws-sdk/client-dynamodb-streams';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { Controller, EventListener, EventType } from './Controller';
import { Abortable } from '../util/abortable';

/**
 * Configuration options for DynamoDBController
 */
export interface DynamoDBControllerOptions {
  /** DynamoDB client - if not provided, uses default */
  dynamoDBClient?: DynamoDBClient;
  /** DynamoDB Streams client - if not provided, uses default */
  streamsClient?: DynamoDBStreamsClient;
  /** Polling interval in ms (default: 5000) */
  pollInterval?: number;
  /** TTL attribute name (default: 'expires'), null to disable TTL detection */
  ttlAttribute?: string | null;
  /** External abort signal to chain */
  signal?: AbortSignal;
}

/**
 * Event emitted by DynamoDBController
 */
export interface DynamoDBEvent<T = unknown> {
  /** Event classification: modified, removed, or expired */
  type: EventType;
  /** Original DynamoDB event name */
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  /** Approximate creation time of the record */
  timestamp: Date;
  /** DynamoDB stream sequence number */
  sequenceNumber: string;
  /** Hash/Range key values */
  keys: Record<string, unknown>;
  /** New image (present for INSERT/MODIFY) */
  newImage: T | undefined;
  /** Old image (present for MODIFY/REMOVE) */
  oldImage: T | undefined;
  /** Original DynamoDB stream record */
  raw: _Record;
}

/**
 * DynamoDB Streams controller compatible with RxJS fromEvent pattern.
 *
 * Provides singleton-per-table semantics with three event types:
 * - modified: INSERT or MODIFY events
 * - removed: REMOVE events (manual deletion or before TTL)
 * - expired: REMOVE events due to TTL expiration
 *
 * @example
 * ```typescript
 * const controller = await DynamoDBController.from<MyType>('my-table');
 *
 * fromEvent(controller, 'modified').subscribe(event => {
 *   console.log('Added/changed:', event.newImage);
 * });
 *
 * fromEvent(controller, 'expired').subscribe(event => {
 *   console.log('TTL expired:', event.oldImage);
 * });
 *
 * // Cleanup
 * controller.dispose();
 * ```
 */
export class DynamoDBController<T = unknown> extends Controller<
  DynamoDBEvent<T>
> {
  // Singleton cache by table ARN
  private static readonly instances = new Map<
    string,
    DynamoDBController<unknown>
  >();

  // Lifecycle management
  private readonly abortable: Abortable<void>;

  // Configuration
  private readonly tableArn: string;
  private readonly streamArn: string;
  private readonly ttlAttribute: string | null;
  private readonly pollInterval: number;

  // AWS clients (dynamoDBClient kept for future use)
  private readonly _dynamoDBClient: DynamoDBClient;
  private readonly streamsClient: DynamoDBStreamsClient;

  // Event bus - single subject for all events
  private readonly allEvents$ = new Subject<DynamoDBEvent<T>>();

  // Filtered observables for each event type (shared)
  private readonly modified$: Observable<DynamoDBEvent<T>>;
  private readonly removed$: Observable<DynamoDBEvent<T>>;
  private readonly expired$: Observable<DynamoDBEvent<T>>;

  // Stream management
  private streamSubscription: Subscription | undefined;
  private listenerCount = 0;
  private readonly activeShards = new Map<
    string,
    { iterator: string | null; subscription: Subscription }
  >();

  private constructor(
    tableArn: string,
    streamArn: string,
    options: DynamoDBControllerOptions
  ) {
    super();
    this.tableArn = tableArn;
    this.streamArn = streamArn;
    this.ttlAttribute =
      'ttlAttribute' in options ? (options.ttlAttribute ?? null) : 'expires';
    this.pollInterval = options.pollInterval ?? 5000;
    this._dynamoDBClient = options.dynamoDBClient ?? new DynamoDBClient({});
    this.streamsClient = options.streamsClient ?? new DynamoDBStreamsClient({});

    // Fork from Abortable.root for lifecycle
    this.abortable = Abortable.root.fork(`DynamoDBController:${tableArn}`);

    // Chain external abort signal if provided
    if (options.signal) {
      options.signal.addEventListener('abort', () => this.dispose());
    }

    // Create filtered observables for each event type (shared across listeners)
    const shared$ = this.allEvents$.pipe(
      shareReplay({ bufferSize: 0, refCount: true })
    );
    this.modified$ = shared$.pipe(filter((e) => e.type === 'modified'));
    this.removed$ = shared$.pipe(filter((e) => e.type === 'removed'));
    this.expired$ = shared$.pipe(filter((e) => e.type === 'expired'));
  }

  /**
   * Factory method - singleton per table ARN
   */
  static async from<T = unknown>(
    tableNameOrArn: string,
    options: DynamoDBControllerOptions = {}
  ): Promise<DynamoDBController<T>> {
    const client = options.dynamoDBClient ?? new DynamoDBClient({});

    // Resolve table ARN if given table name
    const tableArn = await DynamoDBController.resolveTableArn(
      tableNameOrArn,
      client
    );

    // Check cache
    if (DynamoDBController.instances.has(tableArn)) {
      return DynamoDBController.instances.get(
        tableArn
      ) as DynamoDBController<T>;
    }

    // Resolve stream ARN
    const streamArn = await DynamoDBController.resolveStreamArn(
      tableArn,
      client
    );

    // Create new instance
    const controller = new DynamoDBController<T>(tableArn, streamArn, {
      ...options,
      dynamoDBClient: client,
    });
    DynamoDBController.instances.set(
      tableArn,
      controller as DynamoDBController<unknown>
    );

    return controller;
  }

  /**
   * Observable-based factory for RxJS integration
   */
  static from$<T = unknown>(
    tableNameOrArn: string,
    options: DynamoDBControllerOptions = {}
  ): Observable<DynamoDBController<T>> {
    return defer(() => DynamoDBController.from<T>(tableNameOrArn, options));
  }

  private static async resolveTableArn(
    tableNameOrArn: string,
    client: DynamoDBClient
  ): Promise<string> {
    // If already an ARN, return as-is
    if (tableNameOrArn.startsWith('arn:aws:dynamodb:')) {
      return tableNameOrArn;
    }

    // Otherwise, describe table to get ARN
    const response = await client.send(
      new DescribeTableCommand({ TableName: tableNameOrArn })
    );

    if (!response.Table?.TableArn) {
      throw new Error(`Could not resolve ARN for table: ${tableNameOrArn}`);
    }

    return response.Table.TableArn;
  }

  private static async resolveStreamArn(
    tableArn: string,
    client: DynamoDBClient
  ): Promise<string> {
    // Extract table name from ARN
    const tableName = tableArn.split('/').pop()!;

    const response = await client.send(
      new DescribeTableCommand({ TableName: tableName })
    );

    if (!response.Table?.LatestStreamArn) {
      throw new Error(`Table ${tableName} does not have streaming enabled`);
    }

    return response.Table.LatestStreamArn;
  }

  /**
   * Subscribe to events of a specific type
   */
  protected override on(
    type: EventType,
    listener: EventListener<DynamoDBEvent<T>>
  ): Subscription {
    const source$ = this.getObservableForType(type);

    // Increment listener count and start streaming if needed
    this.listenerCount++;
    if (this.listenerCount === 1) {
      this.startStreaming();
    }

    // Create subscription that calls the listener
    const subscription = source$
      .pipe(takeUntil(this.abortable.aborted))
      .subscribe({
        next: (event) => {
          if (typeof listener === 'function') {
            listener(event);
          } else if (listener && typeof listener.handleEvent === 'function') {
            listener.handleEvent(event);
          }
        },
      });

    return subscription;
  }

  /**
   * Unsubscribe from events
   */
  override off(sub: Subscription): Observable<void> {
    return new Observable((subscriber) => {
      sub.unsubscribe();

      // Decrement listener count and stop streaming if no listeners
      this.listenerCount--;
      if (this.listenerCount === 0) {
        this.stopStreaming();
      }

      subscriber.next();
      subscriber.complete();
    });
  }

  private getObservableForType(type: EventType): Observable<DynamoDBEvent<T>> {
    switch (type) {
      case 'modified':
        return this.modified$;
      case 'removed':
        return this.removed$;
      case 'expired':
        return this.expired$;
      default:
        throw new Error(`Unknown event type: ${type}`);
    }
  }

  private startStreaming(): void {
    if (this.streamSubscription) return;

    const aborted$ = this.abortable.aborted;

    // Shard discovery loop
    this.streamSubscription = timer(0, this.pollInterval)
      .pipe(
        takeUntil(aborted$),
        switchMap(() => this.discoverShards()),
        tap((shards) => {
          // Start polling for any new shards
          for (const shard of shards) {
            if (!shard.ShardId || this.activeShards.has(shard.ShardId))
              continue;

            const shardSub = this.pollShard(
              shard.ShardId,
              aborted$
            ).subscribe();
            this.activeShards.set(shard.ShardId, {
              iterator: null,
              subscription: shardSub,
            });
          }
        })
      )
      .subscribe({
        error: (err) => {
          if (!this.isAbortError(err)) {
            // Error logged but not thrown - stream continues
            void err;
          }
        },
      });
  }

  private stopStreaming(): void {
    // Stop shard discovery
    this.streamSubscription?.unsubscribe();
    this.streamSubscription = undefined;

    // Stop all shard pollers
    Array.from(this.activeShards.values()).forEach((shard) => {
      shard.subscription.unsubscribe();
    });
    this.activeShards.clear();
  }

  private discoverShards(): Observable<Shard[]> {
    return defer(() =>
      this.streamsClient.send(
        new DescribeStreamCommand({ StreamArn: this.streamArn }),
        { abortSignal: this.abortable.signal }
      )
    ).pipe(
      map((response) => response.StreamDescription?.Shards ?? []),
      catchError((err) => {
        if (this.isAbortError(err)) return of([]);
        throw err;
      })
    );
  }

  private pollShard(
    shardId: string,
    aborted$: Observable<void>
  ): Observable<void> {
    // First get the shard iterator
    return defer(() =>
      this.streamsClient.send(
        new GetShardIteratorCommand({
          StreamArn: this.streamArn,
          ShardId: shardId,
          ShardIteratorType: 'LATEST',
        }),
        { abortSignal: this.abortable.signal }
      )
    ).pipe(
      // Switch to GetRecords loop using the iterator
      switchMap((iteratorResponse) => {
        const initialIterator = iteratorResponse.ShardIterator;
        if (!initialIterator) {
          this.activeShards.delete(shardId);
          return EMPTY;
        }

        // Start the polling loop with GetRecords
        return this.getRecords(initialIterator).pipe(
          expand((response) => {
            const nextIterator = response.NextShardIterator;
            if (!nextIterator) {
              // Shard is closed
              this.activeShards.delete(shardId);
              return EMPTY;
            }

            // Update stored iterator
            const shardInfo = this.activeShards.get(shardId);
            if (shardInfo) {
              shardInfo.iterator = nextIterator;
            }

            return timer(this.pollInterval).pipe(
              takeUntil(aborted$),
              switchMap(() => this.getRecords(nextIterator))
            );
          }),
          tap((response) => {
            if (response.Records && response.Records.length > 0) {
              this.processRecords(response.Records);
            }
          })
        );
      }),
      // Retry transient errors with backoff
      retry({
        count: 3,
        delay: (error, retryCount) => {
          if (this.isAbortError(error)) throw error;
          return timer(Math.min(1000 * Math.pow(2, retryCount), 10000));
        },
      }),
      takeUntil(aborted$),
      catchError((err) => {
        if (!this.isAbortError(err)) {
          // Error logged but not thrown
          void err;
        }
        this.activeShards.delete(shardId);
        return EMPTY;
      }),
      // Ignore values, we only care about side effects
      switchMap(() => EMPTY)
    );
  }

  private getRecords(iterator: string): Observable<GetRecordsCommandOutput> {
    return defer(() =>
      this.streamsClient.send(
        new GetRecordsCommand({ ShardIterator: iterator }),
        { abortSignal: this.abortable.signal }
      )
    );
  }

  private processRecords(records: _Record[]): void {
    for (const record of records) {
      const event = this.classifyRecord(record);
      if (event) {
        this.allEvents$.next(event);
      }
    }
  }

  private classifyRecord(record: _Record): DynamoDBEvent<T> | null {
    const dynamodb = record.dynamodb;
    if (!dynamodb?.SequenceNumber) return null;

    const eventName = record.eventName as 'INSERT' | 'MODIFY' | 'REMOVE';
    if (!eventName) return null;

    const sequenceNumber = dynamodb.SequenceNumber;
    const creationTime = dynamodb.ApproximateCreationDateTime;
    const timestamp =
      creationTime instanceof Date
        ? creationTime
        : typeof creationTime === 'number'
          ? new Date(creationTime * 1000)
          : new Date();

    // Unmarshall images - NewImage/OldImage are already AttributeValue maps
    const newImage: T | undefined = dynamodb.NewImage
      ? (unmarshall(dynamodb.NewImage) as T)
      : undefined;
    const oldImage: T | undefined = dynamodb.OldImage
      ? (unmarshall(dynamodb.OldImage) as T)
      : undefined;

    // Extract keys
    const keys: Record<string, unknown> = dynamodb.Keys
      ? unmarshall(dynamodb.Keys)
      : {};

    let type: EventType;

    if (eventName === 'INSERT' || eventName === 'MODIFY') {
      type = 'modified';
    } else if (eventName === 'REMOVE') {
      type = this.isExpiredRemoval(oldImage, timestamp) ? 'expired' : 'removed';
    } else {
      return null;
    }

    return {
      type,
      eventName,
      timestamp,
      sequenceNumber,
      keys,
      newImage,
      oldImage,
      raw: record,
    };
  }

  /**
   * Determines if a REMOVE was due to TTL expiration.
   *
   * A removal is "expired" if:
   * 1. TTL attribute is configured (not null)
   * 2. The old image has a TTL value
   * 3. The TTL value is <= deletion timestamp
   */
  private isExpiredRemoval(
    oldImage: T | undefined,
    deletionTime: Date
  ): boolean {
    // No TTL configured - all removals are "removed"
    if (this.ttlAttribute === null) {
      return false;
    }

    if (!oldImage || typeof oldImage !== 'object') {
      return false;
    }

    const ttlValue = (oldImage as Record<string, unknown>)[this.ttlAttribute];

    // No TTL attribute on record - it was manually deleted
    if (ttlValue === undefined || ttlValue === null) {
      return false;
    }

    // TTL is stored as Unix epoch seconds
    if (typeof ttlValue !== 'number') {
      return false;
    }

    const ttlDate = new Date(ttlValue * 1000);

    // If deleted at or after TTL time, it's an expiration
    return deletionTime >= ttlDate;
  }

  private isAbortError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const err = error as { name?: string };
    return err.name === 'AbortError';
  }

  /**
   * Get the AbortSignal for external cancellation
   */
  get signal(): AbortSignal {
    return this.abortable.signal;
  }

  /**
   * Get the table ARN this controller is connected to
   */
  get arn(): string {
    return this.tableArn;
  }

  /**
   * Wrap an observable to automatically cancel on controller disposal
   */
  track<U>(source$: Observable<U>): Observable<U> {
    return this.abortable.wrap(source$);
  }

  /**
   * Dispose the controller and clean up resources
   */
  dispose(): void {
    // Remove from singleton cache
    DynamoDBController.instances.delete(this.tableArn);

    // Stop streaming
    this.stopStreaming();

    // Complete subjects
    this.allEvents$.complete();

    // Abort the lifecycle node
    this.abortable.dispose();
  }
}
