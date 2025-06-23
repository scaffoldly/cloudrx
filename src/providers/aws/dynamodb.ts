import {
  CreateTableCommand,
  DescribeTableCommand,
  DescribeTimeToLiveCommand,
  DynamoDBClient,
  TableDescription,
  TimeToLiveDescription,
  UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  CloudProvider,
  CloudProviderOptions,
  FatalError,
  RetryError,
  Streamed,
} from '../base';
import {
  DynamoDBDocumentClient,
  PutCommand,
  TranslateConfig,
} from '@aws-sdk/lib-dynamodb';
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
};

export type DynamoDBStreamedData<T> = Streamed<T, string>;

export type DynamoDBStoredData<T> = {
  [x: string]: string | number | T;
  data: T;
  timestamp: number;
  expires?: number;
};

export class DynamoDBProvider extends CloudProvider<_Record> {
  private static instances: Record<string, Observable<DynamoDBProvider>> = {};
  private static shards: Record<string, Observable<Shard>> = {};

  private client: DynamoDBDocumentClient;
  private _streamClient?: DynamoDBStreamsClient;
  protected opts: DynamoDBProviderOptions;

  private _tableArn?: string;
  private _streamArn?: string;

  readonly translation: TranslateConfig = {
    marshallOptions: {},
    unmarshallOptions: {
      convertWithoutMapWrapper: false,
    },
  };

  protected constructor(id: string, options: DynamoDBProviderOptions) {
    super(id, options);
    this.client = DynamoDBDocumentClient.from(options.client, this.translation);
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

  public getShards(): Observable<Shard> {
    const { id } = this;

    if (DynamoDBProvider.shards[id]) {
      this.logger.debug(`[${this.id}] Returning existing shard observable`);
      return DynamoDBProvider.shards[id];
    }

    DynamoDBProvider.shards[id] = timer(0, this.opts.pollInterval || 5000).pipe(
      takeUntil(fromEvent(this.signal, 'abort')),
      switchMap((tick) => {
        this.logger.debug(`[${this.id}] [iter:${tick}] Stream refresh...`);
        return from(
          this.streamClient
            .send(new DescribeStreamCommand({ StreamArn: this.streamArn }))
            .then((response) => {
              return response.StreamDescription?.Shards || [];
            })
            .catch((error) => {
              this.logger.error(
                `[${this.id}] Failed to describe stream:`,
                error
              );
              return []; // Return empty array on error to keep polling
            })
        );
      }),
      // Flatten the array to emit individual shards
      switchMap((shards) => from(shards)),
      // Track all seen shard IDs and only emit new ones
      scan(
        (
          acc: { seenShardIds: Set<string>; newShard: Shard | null },
          shard: Shard
        ) => {
          if (shard.ShardId && !acc.seenShardIds.has(shard.ShardId)) {
            acc.seenShardIds.add(shard.ShardId);
            return { seenShardIds: acc.seenShardIds, newShard: shard };
          }
          return { seenShardIds: acc.seenShardIds, newShard: null };
        },
        { seenShardIds: new Set<string>(), newShard: null }
      ),
      // Only emit when we have a new shard
      filter(({ newShard }) => newShard !== null),
      // Extract the new shard
      map(({ newShard }) => newShard!),
      // Share the observable with all subscribers
      shareReplay(1)
    );

    return DynamoDBProvider.shards[id];
  }

  static from(
    id: string,
    options: DynamoDBProviderOptions
  ): Observable<DynamoDBProvider> {
    if (!DynamoDBProvider.instances[id]) {
      DynamoDBProvider.instances[id] = new DynamoDBProvider(id, options)
        .init(options.signal)
        .pipe(shareReplay(1));
    }

    return DynamoDBProvider.instances[id];
  }

  protected _stream(all: boolean): Observable<_Record[]> {
    const shardIteratorType = all ? 'TRIM_HORIZON' : 'LATEST';

    this.logger.debug(
      `[${this.id}] Starting _stream with ${shardIteratorType}, streamArn: ${this.streamArn}`
    );

    const shardIterator = new Subject<string>();

    // Create a local subscription to the shared shard observable
    const shardSubscription = this.getShards()
      .pipe(
        // Process each shard
        switchMap((shard) => {
          this.logger.debug(
            `[${this.id}] Getting iterator for shard: ${shard.ShardId} with type: ${shardIteratorType} at ${Date.now()}`
          );
          return from(
            this.streamClient
              .send(
                new GetShardIteratorCommand({
                  StreamArn: this.streamArn,
                  ShardId: shard.ShardId,
                  ShardIteratorType: shardIteratorType,
                })
              )
              .then((response) => {
                if (!response.ShardIterator) {
                  this.logger.warn(
                    `[${this.id}] No ShardIterator returned for shard:`,
                    shard.ShardId
                  );
                  return null;
                }
                return response.ShardIterator;
              })
              .catch((error) => {
                this.logger.error(
                  `[${this.id}] Failed to get shard iterator:`,
                  error
                );
                return null;
              })
          );
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
        fromEvent(this.signal, 'abort').pipe(
          tap(() => shardSubscription.unsubscribe())
        )
      ),
      concatMap((position) => {
        return from(
          this.streamClient
            .send(new GetRecordsCommand({ ShardIterator: position }))
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
              }

              return records;
            })
            .catch((error) => {
              if (error.name === 'AbortError') {
                this.logger.debug(`[${this.id}] Stream aborted`);
                return [];
              }
              this.logger.error(`[${this.id}] Failed to get records:`, error);
              throw error;
            })
        );
      })
    );
  }

  protected init(signal: AbortSignal): Observable<this> {
    this.logger.debug(`[${this.id}] Initializing DynamoDB provider...`);
    const describe$ = defer(() => {
      this.logger.debug(`[${this.id}] Describing existing table and TTL...`);
      return forkJoin([
        this.client.send(
          new DescribeTableCommand({ TableName: this.tableName })
        ),
        this.client.send(
          new DescribeTimeToLiveCommand({ TableName: this.tableName })
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
          })
        ),
        this.client.send(
          new UpdateTimeToLiveCommand({
            TableName: this.tableName,
            TimeToLiveSpecification: {
              AttributeName: this.ttlAttribute,
              Enabled: true,
            },
          })
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
      if (signal.aborted) {
        throw new FatalError('Aborted');
      }

      if (error) {
        if (error instanceof FatalError || error instanceof RetryError) {
          throw error;
        }

        // Handle AggregateError from AWS SDK v3
        if (
          error &&
          typeof error === 'object' &&
          'name' in error &&
          error.name === 'AggregateError' &&
          'errors' in error &&
          Array.isArray(error.errors)
        ) {
          // Process the first error in the aggregate, or use the aggregate message
          const firstError = error.errors[0];
          if (
            firstError &&
            typeof firstError === 'object' &&
            'name' in firstError
          ) {
            // Recursively handle the first underlying error
            return assert(table, ttl, firstError as Error);
          }
          // If no processable errors, treat as fatal
          throw new FatalError(`AggregateError: ${error.message}`);
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
        takeUntil(fromEvent(signal, 'abort')),
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
        this.logger.debug(`[${this.id}] Setting table ARN and stream ARN...`);
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
        this.logger.info(`[${this.id}] ${this._tableArn}`);
        return this;
      })
    );
  }

  public unmarshall<T>(event: _Record): DynamoDBStreamedData<T> {
    const marker = event.dynamodb?.SequenceNumber;
    if (!marker) {
      throw new FatalError('Invalid DynamoDB record: missing SequenceNumber');
    }

    const image = event.dynamodb?.NewImage || event.dynamodb?.OldImage;
    if (!image) {
      throw new FatalError(
        'Invalid DynamoDB record: missing NewImage or OldImage'
      );
    }

    const storedData = unmarshall(
      image,
      this.translation.unmarshallOptions
    ) as DynamoDBStoredData<T>;

    const { data } = storedData;

    return {
      ...data,
      __marker__: marker,
    };
  }

  protected _store<T>(item: T): Observable<(event: _Record) => boolean> {
    const timestamp = Date.now();
    const hashKeyValue = `item-${timestamp}`;
    const rangeKeyValue = `${timestamp}`;

    // TODO: Make this a hard type
    const record: DynamoDBStoredData<T> = {
      [this.hashKey]: hashKeyValue,
      [this.rangeKey]: rangeKeyValue,
      data: item,
      timestamp,
      expires: Math.floor(Date.now() / 1000) + 3600, // Expire in 1 hour
    };

    return from(
      this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: record,
        })
        // { abortSignal: this.signal }
      )
    ).pipe(
      map(() => {
        // Return a matcher function that checks if the event matches our stored item
        return (event: _Record): boolean => {
          const dynamoRecord = event.dynamodb;
          if (!dynamoRecord?.Keys) return false;

          const eventHashKey = dynamoRecord.Keys[this.hashKey]?.S;
          const eventRangeKey = dynamoRecord.Keys[this.rangeKey]?.S;

          return (
            eventHashKey === hashKeyValue && eventRangeKey === rangeKeyValue
          );
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
