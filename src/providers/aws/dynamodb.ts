import {
  CreateTableCommand,
  DescribeTableCommand,
  DescribeTimeToLiveCommand,
  DynamoDBClient,
  TableDescription,
  TimeToLiveDescription,
  UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';
import { CloudProvider, FatalError, RetryError, Since } from '..';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  catchError,
  combineLatest,
  concatMap,
  defer,
  forkJoin,
  fromEvent,
  map,
  Observable,
  of,
  ReplaySubject,
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

export type DynamoDBProviderOptions = {
  client: DynamoDBClient;
  hashKey: string;
  rangeKey: string;
  signal: AbortSignal;
};

export default class DynamoDBProvider extends CloudProvider<_Record> {
  private static instances: Record<string, Observable<DynamoDBProvider>> = {};

  private client: DynamoDBDocumentClient;
  private _streamClient?: DynamoDBStreamsClient;
  private opts: DynamoDBProviderOptions;

  private _tableArn?: string;
  private _streamArn?: string;

  protected constructor(id: string, options: DynamoDBProviderOptions) {
    super(id);
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

  get signal(): AbortSignal {
    return this.opts.signal;
  }

  get hashKey(): string {
    return this.opts.hashKey;
  }

  get rangeKey(): string {
    return this.opts.rangeKey;
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
    const shardIterator = new Subject<string>();

    const shards = timer(0, 5000)
      .pipe(
        takeUntil(fromEvent(signal, 'abort')),
        switchMap(() =>
          this.streamClient
            .send(new DescribeStreamCommand({ StreamArn: this.streamArn }), {
              abortSignal: signal,
            })
            .then((response) => response.StreamDescription?.Shards || [])
        ),
        scan(
          (acc, currentShards) => {
            const newShards = currentShards.filter(
              (shard) =>
                !acc.previousShards.some(
                  (prev) => prev.ShardId === shard.ShardId
                )
            );
            return { previousShards: currentShards, newShards };
          },
          { previousShards: [] as Shard[], newShards: [] as Shard[] }
        ),
        switchMap(({ newShards }) => newShards),
        switchMap((shard) =>
          this.streamClient
            .send(
              new GetShardIteratorCommand({
                StreamArn: this.streamArn,
                ShardId: shard.ShardId,
                ShardIteratorType:
                  since === 'latest' ? 'LATEST' : 'TRIM_HORIZON',
              }),
              { abortSignal: signal }
            )
            .then((response) => response.ShardIterator!)
        ),
        tap((iterator) => shardIterator.next(iterator))
      )
      .subscribe();

    return shardIterator.pipe(
      takeUntil(
        fromEvent(signal, 'abort').pipe(tap(() => shards.unsubscribe()))
      ),
      concatMap((position) =>
        this.streamClient
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
            }

            return records;
          })
      )
    );
  }

  protected init(): Observable<this> {
    const describe$ = defer(() =>
      forkJoin([
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
        map(([table, ttl]) => ({
          table: table.Table,
          ttl: ttl.TimeToLiveDescription,
        }))
      )
    );

    const create$ = defer(() =>
      forkJoin([
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
              AttributeName: 'expires',
              Enabled: true,
            },
          }),
          {
            abortSignal: this.signal,
          }
        ),
      ]).pipe(
        map(([table, ttl]) => ({
          table: table.TableDescription,
          ttl: ttl.TimeToLiveSpecification,
        }))
      )
    );

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

      if (ttl.TimeToLiveStatus !== 'ENABLED') {
        throw new RetryError('TTL is not yet enabled');
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
          (key) => key.AttributeName === 'expires' && key.AttributeType !== 'N'
        )
      ) {
        throw new FatalError(
          `Table neesd a TTL attribute named "expires" of type number`
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

      if (ttl?.AttributeName !== 'expires') {
        throw new FatalError(`TTL attribute needs to be named expires`);
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
        return this;
      })
    );
  }
}
