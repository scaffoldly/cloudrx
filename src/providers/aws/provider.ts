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
  CloudOptions,
  Streamed,
  Matcher,
  FatalError,
  RetryError,
  Expireable,
} from '../base';
import {
  asyncScheduler,
  catchError,
  combineLatest,
  concatMap,
  defer,
  distinct,
  EMPTY,
  expand,
  filter,
  forkJoin,
  from,
  fromEvent,
  map,
  Observable,
  observeOn,
  of,
  scan,
  shareReplay,
  Subject,
  Subscription,
  switchMap,
  takeUntil,
  tap,
  throwError,
  timer,
} from 'rxjs';
import {
  _Record,
  DescribeStreamCommand,
  DynamoDBStreamsClient,
  GetRecordsCommand,
  GetShardIteratorCommand,
  Shard,
} from '@aws-sdk/client-dynamodb-streams';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  DynamoDBDocument,
  PutCommand,
  QueryCommand,
  TranslateConfig,
} from '@aws-sdk/lib-dynamodb';
import { random } from 'timeflake';

const INIT_SIGNATURE = '__init__';

export type DynamoDBOptions<
  THashKey extends string = 'hashKey',
  TRangeKey extends string = 'rangeKey',
> = CloudOptions & {
  client?: DynamoDBClient;
  hashKey?: THashKey;
  rangeKey?: TRangeKey;
  ttlAttribute?: string;
  pollInterval?: number;
};

export type DynamoDBStreamedData<T> = Streamed<T, string>;

export type DynamoDBStoredData<T> = {
  [x: string]: string | number | T | undefined;
  data: T;
};

export class DynamoDBImpl<
  THashKey extends string = 'hashKey',
  TRangeKey extends string = 'rangeKey',
> extends CloudProvider<
  _Record,
  NonNullable<_Record['dynamodb']>['SequenceNumber']
> {
  private static DEFAULT_CLIENT = new DynamoDBClient({});
  private static shards: Record<string, Observable<Shard>> = {};

  private _client: DynamoDBClient;
  private _streamClient?: DynamoDBStreamsClient;
  private _hashKey: THashKey;
  private _rangeKey: TRangeKey;
  private _ttlAttribute: string;
  private _pollInterval: number;
  private _tableArn?: string;
  private _streamArn?: string;

  public readonly translation: TranslateConfig = {
    marshallOptions: {
      removeUndefinedValues: true,
      convertEmptyValues: false,
      convertClassInstanceToMap: true,
    },
    unmarshallOptions: {
      convertWithoutMapWrapper: true,
    },
  };

  constructor(id: string, opts?: DynamoDBOptions<THashKey, TRangeKey>) {
    super(id, opts);
    this._client = opts?.client || DynamoDBImpl.DEFAULT_CLIENT;
    this._hashKey = opts?.hashKey || ('hashKey' as THashKey);
    this._rangeKey = opts?.rangeKey || ('rangeKey' as TRangeKey);
    this._ttlAttribute = opts?.ttlAttribute || 'expires';
    this._pollInterval = opts?.pollInterval || 5000;
  }

  get client(): DynamoDBDocument {
    return DynamoDBDocument.from(this._client, this.translation);
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

  get hashKey(): THashKey {
    return this._hashKey;
  }

  get rangeKey(): TRangeKey {
    return this._rangeKey;
  }

  get ttlAttribute(): string {
    return this._ttlAttribute;
  }

  get pollInterval(): number {
    return this._pollInterval;
  }

  get streamClient(): DynamoDBStreamsClient {
    if (!this._streamClient) {
      throw new FatalError('Stream client is not yet available');
    }
    return this._streamClient;
  }

  get streamArn(): string {
    if (!this._streamArn) {
      throw new FatalError('Stream ARN is not yet available');
    }
    return this._streamArn;
  }

  get shards(): Observable<Shard> {
    const { id } = this;

    if (DynamoDBImpl.shards[id]) {
      this.logger.debug?.(`[${this.id}] Returning existing shard observable`);
      return DynamoDBImpl.shards[id];
    }

    DynamoDBImpl.shards[id] = timer(0, this.pollInterval || 5000).pipe(
      takeUntil(fromEvent(this.signal, 'abort')),
      switchMap((tick) => {
        this.logger.debug?.(`[${this.id}] [iter:${tick}] Stream refresh...`);
        return from(
          this.streamClient
            .send(new DescribeStreamCommand({ StreamArn: this.streamArn }))
            .then((response) => {
              return response.StreamDescription?.Shards || [];
            })
            .catch((error) => {
              this.logger.error?.(
                `[${this.id}] Failed to describe stream:`,
                error
              );
              return [];
            })
        );
      }),
      switchMap((shards) => from(shards)),
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
      filter(({ newShard }) => newShard !== null),
      map(({ newShard }) => newShard!),
      shareReplay(1)
    );

    return DynamoDBImpl.shards[id];
  }

  protected _init(): Observable<this> {
    this.logger.debug?.(`[${this.id}] Initializing DynamoDB provider...`);
    const describe$ = defer(() => {
      this.logger.debug?.(`[${this.id}] Describing existing table and TTL...`);
      return forkJoin([
        this.client.send(
          new DescribeTableCommand({ TableName: this.tableName })
        ),
        this.client.send(
          new DescribeTimeToLiveCommand({ TableName: this.tableName })
        ),
      ]).pipe(
        map(([table, ttl]) => {
          this.logger.debug?.(
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
      this.logger.debug?.(`[${this.id}] Creating new table and TTL...`);
      return forkJoin([
        this.client.send(
          new CreateTableCommand({
            TableName: this.tableName,
            KeySchema: [
              { AttributeName: this.hashKey, KeyType: 'HASH' },
              { AttributeName: this.rangeKey, KeyType: 'RANGE' },
            ],
            AttributeDefinitions: [
              { AttributeName: this.hashKey, AttributeType: 'S' },
              { AttributeName: this.rangeKey, AttributeType: 'S' },
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
          this.logger.debug?.(
            `[${this.id}] Successfully created table and TTL`
          );
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
          (key) => key.KeyType === 'HASH' && key.AttributeName !== this.hashKey
        )
      ) {
        throw new FatalError(
          `Hash key does not match desired name of \`${
            this.hashKey
          }\`: ${JSON.stringify(table.KeySchema)}`
        );
      }
      if (
        table.KeySchema?.find(
          (key) =>
            key.KeyType === 'RANGE' && key.AttributeName !== this.rangeKey
        )
      ) {
        throw new FatalError(
          `Range key does not match desired name of \`${
            this.rangeKey
          }\`: ${JSON.stringify(table.KeySchema)}`
        );
      }
      if (
        table.AttributeDefinitions?.find(
          (key) =>
            key.AttributeName === this.hashKey && key.AttributeType !== 'S'
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
            key.AttributeName === this.rangeKey && key.AttributeType !== 'S'
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
        this.logger.debug?.(`[${this.id}] Setting table ARN and stream ARN...`);
        this._tableArn = `${table.TableArn}`;
        this._streamArn = `${table.LatestStreamArn}`;
      }),
      switchMap(() => {
        const init: DynamoDBStoredData<Date> = {
          [this.hashKey]: this.id,
          [this.rangeKey]: INIT_SIGNATURE,
          data: new Date(),
        };

        return combineLatest([
          this.client.config.region(),
          this.client.config.credentials(),
          this.client.config.endpoint
            ? this.client.config.endpoint()
            : Promise.resolve(undefined),
          this.client.send(
            new PutCommand({
              TableName: this.tableName,
              Item: init,
            })
          ),
        ]);
      }),
      map(([region, credentials, endpoint]) => {
        this.logger.debug?.(
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
        this.logger.info?.(`[${this.id}] ${this._tableArn}`);
        return this;
      })
    );
  }

  protected _stream(all: boolean): Observable<_Record[]> {
    return new Observable<_Record[]>((subscriber) => {
      const shardIteratorType = all ? 'TRIM_HORIZON' : 'LATEST';
      this.logger.debug?.(
        `[${this.id}] Starting _stream with ${shardIteratorType}, streamArn: ${this.streamArn}`
      );

      const iterator = new Subject<{
        iterator: string | undefined;
        shardId: string | undefined;
      }>();
      const subscriptions: Subscription[] = [];

      subscriptions.push(
        this.shards
          .pipe(
            tap((shard) => {
              this.logger.debug?.(`[${this.id}] New shard: ${shard.ShardId}`);
            }),
            concatMap((shard) =>
              from(
                this.streamClient.send(
                  new GetShardIteratorCommand({
                    StreamArn: this.streamArn,
                    ShardId: shard.ShardId,
                    ShardIteratorType: shardIteratorType,
                  })
                )
              ).pipe(
                map(({ ShardIterator }) => ({
                  ShardIterator,
                  ShardId: shard.ShardId,
                }))
              )
            )
          )
          .subscribe({
            next: ({ ShardIterator, ShardId }) => {
              if (ShardIterator) {
                iterator.next({ iterator: ShardIterator, shardId: ShardId });
              }
            },
            error: (error) => {
              this.logger.warn?.(
                `[${this.id}] Failed to get shard iterator:`,
                error
              );
            },
          })
      );

      subscriptions.push(
        iterator
          .pipe(
            observeOn(asyncScheduler),
            distinct(),
            takeUntil(fromEvent(this.signal, 'abort')),
            concatMap(({ iterator, shardId }) =>
              from(
                this.streamClient.send(
                  new GetRecordsCommand({ ShardIterator: iterator })
                )
              ).pipe(
                map(({ Records, NextShardIterator }) => ({
                  Records,
                  NextShardIterator,
                  ShardId: shardId,
                }))
              )
            )
          )
          .subscribe({
            next: ({ Records = [], NextShardIterator, ShardId }) => {
              Records = Records.filter((r) => {
                if (
                  r.dynamodb?.Keys?.[this.hashKey]?.S === this.id &&
                  r.dynamodb?.Keys?.[this.rangeKey]?.S === INIT_SIGNATURE
                ) {
                  this.logger.debug?.(`[${this.id}] Skipping init record`);
                  return false;
                }
                return true;
              });

              const updates = Records.filter(
                (r) => r.eventName === 'INSERT' || r.eventName === 'MODIFY'
              );

              const deletes = Records.filter((r) => r.eventName === 'REMOVE');

              subscriber.next(updates);
              deletes.forEach((r) =>
                this.events.expire(r.dynamodb?.SequenceNumber, r)
              );

              if (NextShardIterator) {
                subscriptions.push(
                  asyncScheduler.schedule(
                    () => {
                      iterator.next({
                        iterator: NextShardIterator,
                        shardId: ShardId,
                      });
                    },
                    !Records.length ? 100 : 0
                  )
                );
              }
            },
            error: (error) => {
              this.logger.warn?.(`[${this.id}] Failed to get records:`, error);
            },
            complete: () => {
              this.logger.debug?.(`[${this.id}] Stream iterator completed`);
              subscriber.next([]);
              subscriber.complete();
            },
          })
      );

      return () => {
        this.logger.debug?.(`[${this.id}] Stream cleanup`);
        subscriptions.forEach((sub) => sub.unsubscribe());
        iterator.complete();
      };
    });
  }

  protected _snapshot<T>(): Observable<T[]> {
    return new Observable<T[]>((subscriber) => {
      this.logger.debug?.(`[${this.id}] Fetching snapshot from DynamoDB...`);

      // TODO: Do a quck scan to figure out KeyConditionExpression values
      let query = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: `${this.hashKey} = :hashKey`,
        ExpressionAttributeValues: {
          ':hashKey': this.id,
        },
        ScanIndexForward: false,
      });

      const subscription = from(this.client.query(query.input))
        // const subscription = from(this.client.query(query.input))
        .pipe(
          expand((response) => {
            const lastEvaluatedKey = response.LastEvaluatedKey;
            if (!lastEvaluatedKey) return EMPTY;

            query.input.ExclusiveStartKey = lastEvaluatedKey;

            return from(
              this.client.query({
                ...query.input,
                ExclusiveStartKey: lastEvaluatedKey,
              })
            );
          }),
          map((response) => {
            const items = (response.Items || []) as DynamoDBStoredData<T>[];
            // Extract the 'data' field from each DynamoDB record
            return items
              .filter((item) => item[this.rangeKey] !== INIT_SIGNATURE)
              .map((item) => item.data);
          })
        )
        .subscribe({
          next: (items) => {
            this.logger.debug?.(
              `[${this.id}] Fetched ${items.length} items from snapshot`
            );
            subscriber.next(items);
          },
          error: (error) => {
            this.logger.error?.(
              `[${this.id}] Failed to fetch snapshot:`,
              error
            );
            subscriber.error(
              new FatalError(`Failed to fetch snapshot: ${error.message}`)
            );
          },
          complete: () => {
            this.logger.debug?.(`[${this.id}] Snapshot fetch completed`);
            subscriber.complete();
          },
        });

      return () => {
        this.logger.debug?.(`[${this.id}] Cleaning up snapshot subscription`);
        subscription.unsubscribe();
      };
    });
  }

  protected _store<T>(
    item: Expireable<T>,
    hashFn: (value: T) => string = () => random().base62,
    matched?: (event: _Record) => void
  ): Observable<Matcher<_Record>> {
    return new Observable<Matcher<_Record>>((subscriber) => {
      this.logger.debug?.(`[${this.id}] Storing item:`, item);

      const hashKeyValue = this.id;
      const rangeKeyValue = hashFn(item);

      const record: DynamoDBStoredData<T> = {
        [this.hashKey]: hashKeyValue,
        [this.rangeKey]: rangeKeyValue,
        data: item,
      };

      if (item.__expires) {
        record[this.ttlAttribute] = item.__expires;
      }

      const matcher: Matcher<_Record> = (event: _Record): boolean => {
        const dynamoRecord = event.dynamodb;
        if (!dynamoRecord?.Keys) return false;
        const eventHashKey = dynamoRecord.Keys[this.hashKey]?.S;
        const eventRangeKey = dynamoRecord.Keys[this.rangeKey]?.S;

        if (eventHashKey === hashKeyValue && eventRangeKey === rangeKeyValue) {
          // TODO: Write sequence number to a checkpoint store
          this.logger.debug?.(
            `[${this.id}] Stored item matched event with SequenceNumber: ${dynamoRecord.SequenceNumber}`
          );
          matched?.(event);
          return true;
        }

        return false;
      };

      const subscription = from(
        this.client.send(
          new PutCommand({
            TableName: this.tableName,
            Item: record,
          })
        )
      ).subscribe({
        error: (error) => {
          this.logger.error?.(`[${this.id}] Failed to store item:`, error);
          subscriber.error(
            new FatalError(`Failed to store item: ${error.message}`)
          );
        },
        complete: () => {
          this.logger.debug?.(
            `[${this.id}] Successfully stored item with hashKey: ${hashKeyValue}, rangeKey: ${rangeKeyValue}`
          );
          subscriber.next(matcher);
          subscriber.complete();
        },
      });

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  protected _unmarshall<T>(
    event: _Record
  ): Streamed<
    Expireable<T>,
    NonNullable<_Record['dynamodb']>['SequenceNumber']
  > {
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
    const storedData = unmarshall(image) as DynamoDBStoredData<Expireable<T>>;
    const result = {
      ...storedData.data,
      __marker__: marker,
    };

    // Copy TTL attribute back to __expires
    const ttlValue = storedData[this.ttlAttribute];
    if (typeof ttlValue === 'number') {
      result.__expires = ttlValue;
    }

    return result;
  }
}

type DynamoDBConstructor = {
  DEFAULT_CLIENT: DynamoDBClient;

  new <
    THashKey extends string = 'hashKey',
    TRangeKey extends string = 'rangeKey',
  >(
    id: string,
    opts?: DynamoDBOptions<THashKey, TRangeKey>
  ): DynamoDBImpl<THashKey, TRangeKey>;

  from<
    THashKey extends string = 'hashKey',
    TRangeKey extends string = 'rangeKey',
  >(
    id: string,
    opts?: DynamoDBOptions<THashKey, TRangeKey>
  ): Observable<DynamoDBImpl<THashKey, TRangeKey>>;
};

// Export DynamoDB with enhanced typing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DynamoDB = DynamoDBImpl as any as DynamoDBConstructor;
