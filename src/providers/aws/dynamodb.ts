import {
  CreateTableCommand,
  DescribeTableCommand,
  DescribeTimeToLiveCommand,
  DynamoDBClient,
  TableDescription,
  TimeToLiveDescription,
  UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';
import {
  CloudProvider,
  CloudProviderOptions,
  FatalError,
  RetryError,
  Since,
} from '..';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  catchError,
  combineLatest,
  concatMap,
  defer,
  filter,
  forkJoin,
  from,
  fromEvent,
  map,
  Observable,
  of,
  scan,
  shareReplay,
  Subject,
  switchMap,
  takeUntil,
  tap,
  throwError,
  timer,
} from 'rxjs';
import {
  _Record,
  DynamoDBStreamsClient,
  DescribeStreamCommand,
  GetRecordsCommand,
  GetShardIteratorCommand,
  Shard,
} from '@aws-sdk/client-dynamodb-streams';

export type DynamoDBProviderOptions = CloudProviderOptions & {
  client: DynamoDBClient;
  hashKey: string;
  rangeKey: string;
  ttlAttribute?: string;
  shardPollingInterval?: number;
};

export default class DynamoDBProvider extends CloudProvider<_Record> {
  private static instances: Record<string, Observable<DynamoDBProvider>> = {};
  // Map to store shared shard observables by streamArn
  private static shardObservables: {
    [key: string]: Observable<Shard[]>;
  } = {};

  private client: DynamoDBDocumentClient;
  private _streamClient?: DynamoDBStreamsClient;
  protected opts: DynamoDBProviderOptions;

  private _tableArn?: string;
  private _streamArn?: string;

  protected constructor(id: string, options: DynamoDBProviderOptions) {
    super(id, options);
    this.client = DynamoDBDocumentClient.from(options.client);
    this.opts = options;
  }

  get tableName(): string {
    return `cloudrx-${this.id}`;
  }

  get tableArn(): string {
    if (!this._tableArn) {
      throw new FatalError('Table ARN is not yet available');
    }
    return this._tableArn;
  }

  get streamArn(): string {
    if (!this._streamArn) {
      throw new FatalError('Stream ARN is not yet available');
    }
    return this._streamArn;
  }

  get streamClient(): DynamoDBStreamsClient {
    if (!this._streamClient) {
      throw new FatalError('Stream client is not yet available');
    }
    return this._streamClient;
  }

  get hashKey(): string {
    return this.opts.hashKey;
  }

  get rangeKey(): string {
    return this.opts.rangeKey;
  }

  get ttlAttribute(): string {
    return this.opts.ttlAttribute || 'expires';
  }

  get shardPollingInterval(): number {
    return this.opts.shardPollingInterval || 5000;
  }

  // Get or create a shared shard observable for the given stream ARN
  private getSharedShardObservable(signal: AbortSignal): Observable<Shard[]> {
    // Make sure the streamArn exists as a key in the map
    DynamoDBProvider.shardObservables = DynamoDBProvider.shardObservables || {};

    // Initialize the shared observable if it doesn't exist for this stream ARN
    if (!DynamoDBProvider.shardObservables[this.streamArn]) {
      this.logger.debug(
        `[${this.id}] Creating shared shard observable for stream: ${this.streamArn}`
      );

      // Create the shared observable for this stream ARN
      DynamoDBProvider.shardObservables[this.streamArn] = timer(
        0,
        this.shardPollingInterval
      ).pipe(
        takeUntil(fromEvent(signal, 'abort')),
        switchMap(() => {
          this.logger.debug(`[${this.id}] Attempting to describe stream...`);
          return this.streamClient
            .send(new DescribeStreamCommand({ StreamArn: this.streamArn }), {
              abortSignal: signal,
            })
            .then((response) => {
              this.logger.debug(
                `[${this.id}] Stream description successful, shards:`,
                response.StreamDescription?.Shards?.length || 0
              );
              return response.StreamDescription?.Shards || [];
            })
            .catch((error) => {
              this.logger.error(
                `[${this.id}] Failed to describe stream:`,
                error
              );
              return []; // Return empty array on error to keep polling
            });
        }),
        scan((previousShards, currentShards) => {
          // Only emit shards we haven't seen before
          return currentShards.filter(
            (shard) =>
              !previousShards.some((prev) => prev.ShardId === shard.ShardId)
          );
        }, [] as Shard[]),
        // Only emit when there are new shards
        filter((newShards) => newShards.length > 0),
        // Share the observable with all subscribers
        shareReplay(1)
      );
    }

    // The observable must exist at this point
    return DynamoDBProvider.shardObservables[this.streamArn]!;
  }

  static from(
    id: string,
    options: DynamoDBProviderOptions
  ): Observable<DynamoDBProvider> {
    if (!DynamoDBProvider.instances[id]) {
      DynamoDBProvider.instances[id] = new DynamoDBProvider(id, options)
        .init()
        .pipe(shareReplay(1));
    }

    return DynamoDBProvider.instances[id];
  }

  protected _stream(since: Since, signal: AbortSignal): Observable<_Record[]> {
    this.logger.debug(
      `[${this.id}] Starting _stream with since: ${since}, streamArn: ${this.streamArn}`
    );
    const shardIterator = new Subject<string>();

    // Create a local subscription to the shared shard observable
    const shardSubscription = this.getSharedShardObservable(signal)
      .pipe(
        takeUntil(fromEvent(signal, 'abort')),
        // Process new shards
        switchMap((newShards) => from(newShards)),
        switchMap((shard) => {
          this.logger.debug(
            `[${this.id}] Getting iterator for shard: ${shard.ShardId} with type: ${since === 'latest' ? 'LATEST' : 'TRIM_HORIZON'} at ${Date.now()}`
          );
          return this.streamClient
            .send(
              new GetShardIteratorCommand({
                StreamArn: this.streamArn,
                ShardId: shard.ShardId,
                ShardIteratorType:
                  since === 'latest' ? 'LATEST' : 'TRIM_HORIZON',
              }),
              { abortSignal: signal }
            )
            .then((response) => {
              if (!response.ShardIterator) {
                this.logger.error(
                  `[${this.id}] No ShardIterator returned for shard:`,
                  shard.ShardId
                );
                return null;
              }
              this.logger.debug(`[${this.id}] Got shard iterator successfully`);
              return response.ShardIterator;
            })
            .catch((error) => {
              this.logger.error(
                `[${this.id}] Failed to get shard iterator:`,
                error
              );
              return null;
            });
        }),
        tap((iterator) => {
          if (iterator) {
            shardIterator.next(iterator);
          }
        })
      )
      .subscribe();

    return shardIterator.pipe(
      takeUntil(
        fromEvent(signal, 'abort').pipe(
          tap(() => shardSubscription.unsubscribe())
        )
      ),
      concatMap((position) => {
        this.logger.debug(`[${this.id}] Getting records with iterator`);
        return this.streamClient
          .send(new GetRecordsCommand({ ShardIterator: position }), {
            abortSignal: signal,
          })
          .then((response) => {
            const nextShardIterator = response.NextShardIterator;
            const records = response.Records || [];

            if (nextShardIterator) {
              setTimeout(
                () => {
                  shardIterator.next(nextShardIterator);
                },
                !records.length ? 100 : 0
              );
            } else {
              this.logger.debug(
                `[${this.id}] No next iterator, stream may be closed`
              );
            }

            return records;
          })
          .catch((error) => {
            this.logger.error(`[${this.id}] Failed to get records:`, error);
            throw error;
          });
      })
    );
  }

  protected init(): Observable<this> {
    this.logger.info(`[${this.id}] Initializing DynamoDB provider...`);
    const describe$ = defer(() => {
      this.logger.debug(`[${this.id}] Describing existing table and TTL...`);
      return forkJoin([
        this.client.send(
          new DescribeTableCommand({ TableName: this.tableName }),
          {
            abortSignal: this.signal,
          }
        ),
        this.client.send(
          new DescribeTimeToLiveCommand({ TableName: this.tableName }),
          {
            abortSignal: this.signal,
          }
        ),
      ]).pipe(
        map(([table, ttl]) => {
          this.logger.debug(
            `[${this.id}] Successfully described table and TTL`
          );
          return {
            table: table.Table,
            ttl: ttl.TimeToLiveDescription,
          };
        })
      );
    });

    const create$ = defer(() => {
      this.logger.debug(`[${this.id}] Creating new table and TTL...`);
      return forkJoin([
        this.client.send(
          new CreateTableCommand({
            TableName: this.tableName,
            KeySchema: [
              { AttributeName: this.hashKey, KeyType: 'HASH' },
              { AttributeName: this.rangeKey, KeyType: 'RANGE' },
            ],
            AttributeDefinitions: [
              { AttributeName: this.opts.hashKey, AttributeType: 'S' },
              { AttributeName: this.opts.rangeKey, AttributeType: 'S' },
            ],
            BillingMode: 'PAY_PER_REQUEST',
            StreamSpecification: {
              StreamEnabled: true,
              StreamViewType: 'NEW_AND_OLD_IMAGES',
            },
          }),
          {
            abortSignal: this.signal,
          }
        ),
        this.client.send(
          new UpdateTimeToLiveCommand({
            TableName: this.tableName,
            TimeToLiveSpecification: {
              AttributeName: this.ttlAttribute,
              Enabled: true,
            },
          }),
          {
            abortSignal: this.signal,
          }
        ),
      ]).pipe(
        map(([table, ttl]) => {
          this.logger.debug(`[${this.id}] Successfully created table and TTL`);
          return {
            table: table.TableDescription,
            ttl: ttl.TimeToLiveSpecification,
          };
        })
      );
    });

    const assert = (
      table?: TableDescription,
      ttl?: TimeToLiveDescription,
      error?: Error
    ): {
      table: TableDescription;
      ttl: TimeToLiveDescription;
    } => {
      if (this.signal.aborted) {
        throw new FatalError('Aborted');
      }

      if (error) {
        if (error instanceof FatalError || error instanceof RetryError) {
          throw error;
        }

        // console.warn(chalk.yellow(`WARN: ${error.name}: ${error.message}`));

        if ('code' in error && error.code === 'ECONNREFUSED') {
          throw new RetryError('Connection refused');
        }
        if (error.name === 'ResourceNotFoundException') {
          throw new RetryError('Resource not found');
        }
        if (error.name === 'ResourceInUseException') {
          throw new RetryError('Resource in use');
        }
        if (error.name === 'ValidationException') {
          throw new RetryError('Validation error');
        }

        throw new FatalError(`${error.name}: ${error.message}`);
      }

      if (!table || !ttl) {
        throw new FatalError('Table or TTL is not yet available');
      }

      if (table.TableStatus !== 'ACTIVE') {
        throw new RetryError('Table is not yet active');
      }

      if (
        ttl.TimeToLiveStatus !== 'ENABLED' &&
        ttl.TimeToLiveStatus !== 'ENABLING'
      ) {
        throw new RetryError(
          `TTL is not yet enabled, current status: ${ttl.TimeToLiveStatus}`
        );
      }

      if (
        table.KeySchema?.find(
          (key) =>
            key.KeyType === 'HASH' && key.AttributeName !== this.opts.hashKey
        )
      ) {
        throw new FatalError(
          `Hash key does not match desired name of \`${
            this.opts.hashKey
          }\`: ${JSON.stringify(table.KeySchema)}`
        );
      }
      if (
        table.KeySchema?.find(
          (key) =>
            key.KeyType === 'RANGE' && key.AttributeName !== this.opts.rangeKey
        )
      ) {
        throw new FatalError(
          `Range key does not match desired name of \`${
            this.opts.rangeKey
          }\`: ${JSON.stringify(table.KeySchema)}`
        );
      }

      if (
        table.AttributeDefinitions?.find(
          (key) =>
            key.AttributeName === this.opts.hashKey && key.AttributeType !== 'S'
        )
      ) {
        throw new FatalError(
          `Hash Key needs to be a string type: ${JSON.stringify(
            table.AttributeDefinitions
          )}`
        );
      }

      if (
        table.AttributeDefinitions?.find(
          (key) =>
            key.AttributeName === this.opts.rangeKey &&
            key.AttributeType !== 'S'
        )
      ) {
        throw new FatalError(
          `Range Key needs to be a string type: ${JSON.stringify(
            table.AttributeDefinitions
          )}`
        );
      }

      if (
        table.AttributeDefinitions?.find(
          (key) =>
            key.AttributeName === this.ttlAttribute && key.AttributeType !== 'N'
        )
      ) {
        throw new FatalError(
          `Table needs a TTL attribute named "${this.ttlAttribute}" of type number`
        );
      }

      if (table.StreamSpecification?.StreamEnabled !== true) {
        throw new FatalError(`Table needs to have streams enabled`);
      }

      if (table.StreamSpecification?.StreamViewType !== 'NEW_AND_OLD_IMAGES') {
        throw new FatalError(
          `Table needs to have streams configured to emit new and old images`
        );
      }

      if (ttl?.AttributeName !== this.ttlAttribute) {
        throw new FatalError(
          `TTL attribute needs to be named ${this.ttlAttribute}`
        );
      }

      return { table, ttl };
    };

    const check = (
      delay: number
    ): Observable<{
      table: TableDescription;
      ttl: TimeToLiveDescription;
    }> =>
      timer(delay).pipe(
        takeUntil(fromEvent(this.signal, 'abort')),
        switchMap(() =>
          describe$.pipe(switchMap(({ table, ttl }) => of(assert(table, ttl))))
        ),
        catchError((err) => {
          if (err instanceof FatalError) {
            return throwError(() => err);
          }
          return create$.pipe(
            switchMap(({ table, ttl }) => of(assert(table, ttl)))
          );
        }),
        catchError((err) => {
          if (err instanceof FatalError) {
            return throwError(() => err);
          }
          return of(assert(undefined, undefined, err));
        }),
        catchError((err) => {
          if (err instanceof RetryError) {
            return check(1000);
          }
          return throwError(() => err);
        })
      );

    return check(0).pipe(
      map(({ table }) => {
        this.logger.info(`[${this.id}] Setting table ARN and stream ARN...`);
        this._tableArn = `${table.TableArn}`;
        this._streamArn = `${table.LatestStreamArn}`;
      }),
      switchMap(() =>
        combineLatest([
          this.client.config.region(),
          this.client.config.credentials(),
          this.client.config.endpoint
            ? this.client.config.endpoint()
            : Promise.resolve(undefined),
        ])
      ),
      map(([region, credentials, endpoint]) => {
        this.logger.debug(
          `[${this.id}] Creating stream client with endpoint:`,
          endpoint
        );
        this._streamClient = endpoint
          ? new DynamoDBStreamsClient({
              region,
              credentials,
              endpoint,
            })
          : new DynamoDBStreamsClient({
              region,
              credentials,
            });
      }),
      map(() => {
        this.logger.info(
          `[${this.id}] DynamoDB provider initialization complete!`
        );
        return this;
      })
    );
  }

  protected _store<T>(item: T): Observable<(event: _Record) => boolean> {
    this.logger.debug(
      `[${this.id}] Starting store operation for item at ${Date.now()}:`,
      item
    );
    const timestamp = Date.now();
    const hashKeyValue = `item-${timestamp}`;
    const rangeKeyValue = `${timestamp}`;
    const record = {
      [this.hashKey]: hashKeyValue,
      [this.rangeKey]: rangeKeyValue,
      data: item,
      timestamp,
      expires: Math.floor(Date.now() / 1000) + 3600, // Expire in 1 hour
    };

    this.logger.debug(
      `[${this.id}] Storing record to table ${this.tableName}:`,
      record
    );

    return from(
      this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: record,
        }),
        { abortSignal: this.signal }
      )
    ).pipe(
      map(() => {
        this.logger.debug(
          `[${this.id}] Successfully stored item with keys: ${hashKeyValue}, ${rangeKeyValue}`
        );
        // Return a matcher function that checks if the event matches our stored item
        return (event: _Record): boolean => {
          const dynamoRecord = event.dynamodb;
          if (!dynamoRecord?.Keys) return false;

          const eventHashKey = dynamoRecord.Keys[this.hashKey]?.S;
          const eventRangeKey = dynamoRecord.Keys[this.rangeKey]?.S;

          const matches =
            eventHashKey === hashKeyValue && eventRangeKey === rangeKeyValue;
          if (matches) {
            this.logger.debug(
              `[${this.id}] Found matching event for stored item!`
            );
          }

          return matches;
        };
      }),
      catchError((error) => {
        this.logger.error(`[${this.id}] Failed to store item:`, error);
        return throwError(
          () => new FatalError(`Failed to store item: ${error.message}`)
        );
      })
    );
  }
}
