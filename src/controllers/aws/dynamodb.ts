import { Observable, Subscription, defer, timer, of, EMPTY } from 'rxjs';
import {
  takeUntil,
  switchMap,
  map,
  tap,
  catchError,
  expand,
  retry,
} from 'rxjs/operators';
import {
  DynamoDBClient,
  DynamoDBClientConfig,
  TableDescription,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
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
import { Controller, ControllerEvent, ControllerOptions, EventType } from '..';

/**
 * Configuration options for DynamoDBController
 */
export interface DynamoDBControllerOptions extends ControllerOptions {
  /** AWS client configuration for constructing DynamoDB and Streams clients */
  clientConfig?: DynamoDBClientConfig;
  /** Polling interval in ms (default: 5000) */
  pollInterval?: number;
  /** TTL attribute name (default: 'expires'), null to disable TTL detection */
  ttlAttribute?: string | null;
}

/**
 * Event emitted by DynamoDBController.
 *
 * Extends {@link ControllerEvent} with DynamoDB-specific metadata.
 * Key and value are flattened directly onto the event.
 *
 * @typeParam T - The application-level type of the DynamoDB record
 */
export type DynamoDBEvent<T = unknown> = ControllerEvent<
  Record<string, unknown>,
  T
> & {
  /** Original DynamoDB event name */
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  /** Approximate creation time of the record */
  timestamp: Date;
  /** DynamoDB stream sequence number */
  sequenceNumber: string;
  /** Original DynamoDB stream record */
  raw: _Record;
};

/**
 * DynamoDB Streams controller compatible with RxJS fromEvent pattern.
 *
 * Provides singleton-per-table semantics with read and write operations:
 * - `put(value)`: write an item (stream emits 'modified')
 * - `remove(key)`: delete an item (stream emits 'removed' or 'expired')
 *
 * Event types:
 * - modified: INSERT or MODIFY events
 * - removed: REMOVE events (manual deletion or before TTL)
 * - expired: REMOVE events due to TTL expiration
 *
 * @example
 * ```typescript
 * const controller = DynamoDBController.from<MyType>(table);
 *
 * fromEvent(controller, 'modified').subscribe(event => {
 *   console.log('Added/changed:', event.key, event.value);
 * });
 *
 * controller.put({ id: '123', name: 'Alice' }).subscribe();
 * controller.remove({ id: '123' }).subscribe();
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

  // Configuration
  private readonly tableArn: string;
  private readonly streamArn: string;
  private readonly ttlAttribute: string | null;
  private readonly pollInterval: number;

  // AWS clients
  private readonly dynamoDBClient: DynamoDBDocumentClient;
  private readonly streamsClient: DynamoDBStreamsClient;

  // Shard management
  private readonly activeShards = new Map<
    string,
    { iterator: string | null; subscription: Subscription }
  >();

  private constructor(
    tableArn: string,
    streamArn: string,
    options: DynamoDBControllerOptions
  ) {
    super(`DynamoDBController:${tableArn}`, options);

    this.tableArn = tableArn;
    this.streamArn = streamArn;
    this.ttlAttribute =
      'ttlAttribute' in options ? (options.ttlAttribute ?? null) : 'expires';
    this.pollInterval = options.pollInterval ?? 5000;
    const clientConfig = options.clientConfig ?? {};
    this.dynamoDBClient = DynamoDBDocumentClient.from(
      new DynamoDBClient(clientConfig)
    );
    this.streamsClient = new DynamoDBStreamsClient(clientConfig);
  }

  /**
   * Unique identifier for this controller (table ARN)
   */
  override get id(): string {
    return this.tableArn;
  }

  /**
   * Get the table ARN this controller is connected to
   */
  get arn(): string {
    return this.tableArn;
  }

  /**
   * Factory method - singleton per table ARN
   */
  static from<T = unknown>(
    table: TableDescription,
    options: DynamoDBControllerOptions = {}
  ): Controller<DynamoDBEvent<T>> {
    const tableArn = table.TableArn;
    const streamArn = table.LatestStreamArn;

    if (!tableArn) {
      throw new Error('TableDescription must have TableArn');
    }

    if (!streamArn) {
      throw new Error(
        `Table ${table.TableName ?? tableArn} does not have streaming enabled`
      );
    }

    // Check cache
    if (DynamoDBController.instances.has(tableArn)) {
      return DynamoDBController.instances.get(
        tableArn
      ) as DynamoDBController<T>;
    }

    // Create new instance
    const controller = new DynamoDBController<T>(tableArn, streamArn, options);
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
    table: TableDescription,
    options: DynamoDBControllerOptions = {}
  ): Observable<Controller<DynamoDBEvent<T>>> {
    return defer(() => of(DynamoDBController.from<T>(table, options)));
  }

  /**
   * Start streaming from DynamoDB Streams
   */
  protected override start(): void {
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

  /**
   * Stop streaming from DynamoDB Streams
   */
  protected override stop(): void {
    // Stop shard discovery
    this.streamSubscription?.unsubscribe();
    this.streamSubscription = undefined;

    // Stop all shard pollers
    Array.from(this.activeShards.values()).forEach((shard) => {
      shard.subscription.unsubscribe();
    });
    this.activeShards.clear();
  }

  /**
   * Cleanup specific to DynamoDBController
   */
  protected override onDispose(): void {
    // Remove from singleton cache
    DynamoDBController.instances.delete(this.tableArn);

    // Destroy AWS clients
    this.dynamoDBClient.destroy();
    this.streamsClient.destroy();
  }

  /** Write an item to DynamoDB. The stream will emit a 'modified' event. */
  override put(value: Record<string, unknown> & T): Observable<void> {
    const tableName = this.tableArn.split('/').pop();
    return defer(() =>
      this.dynamoDBClient.send(
        new PutCommand({
          TableName: tableName,
          Item: value as Record<string, unknown>,
        }),
        { abortSignal: this.abortable.signal }
      )
    ).pipe(
      map(() => undefined as void),
      catchError((err) => {
        if (this.isAbortError(err)) return EMPTY;
        throw err;
      })
    );
  }

  /** Delete an item from DynamoDB. The stream will emit a 'removed' event. */
  override remove(key: Record<string, unknown>): Observable<void> {
    const tableName = this.tableArn.split('/').pop();
    return defer(() =>
      this.dynamoDBClient.send(
        new DeleteCommand({
          TableName: tableName,
          Key: key,
        }),
        { abortSignal: this.abortable.signal }
      )
    ).pipe(
      map(() => undefined as void),
      catchError((err) => {
        if (this.isAbortError(err)) return EMPTY;
        throw err;
      })
    );
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

    // Extract keys
    const key: Record<string, unknown> = dynamodb.Keys
      ? unmarshall(dynamodb.Keys)
      : {};

    // Unmarshall images
    const newImage: T | undefined = dynamodb.NewImage
      ? (unmarshall(dynamodb.NewImage) as T)
      : undefined;
    const oldImage: T | undefined = dynamodb.OldImage
      ? (unmarshall(dynamodb.OldImage) as T)
      : undefined;

    const base = { eventName, timestamp, sequenceNumber, raw: record };

    if (eventName === 'INSERT' || eventName === 'MODIFY') {
      if (!newImage) return null;
      return {
        type: 'modified',
        key,
        value: newImage,
        ...base,
      };
    } else if (eventName === 'REMOVE') {
      if (!oldImage) return null;
      const type: EventType = this.isExpiredRemoval(oldImage, timestamp)
        ? 'expired'
        : 'removed';
      return {
        type,
        key,
        value: oldImage,
        ...base,
      } as DynamoDBEvent<T>;
    }

    return null;
  }

  /**
   * Determines if a REMOVE was due to TTL expiration.
   *
   * A removal is "expired" if:
   * 1. TTL attribute is configured (not null)
   * 2. The old value has a TTL attribute
   * 3. The TTL value is <= deletion timestamp
   */
  private isExpiredRemoval(
    oldValue: T | undefined,
    deletionTime: Date
  ): boolean {
    // No TTL configured - all removals are "removed"
    if (this.ttlAttribute === null) {
      return false;
    }

    if (!oldValue || typeof oldValue !== 'object') {
      return false;
    }

    const ttlValue = (oldValue as Record<string, unknown>)[this.ttlAttribute];

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
}
