import { _Record } from '@aws-sdk/client-dynamodb-streams';
import {
  asyncScheduler,
  combineLatest,
  concatAll,
  filter,
  fromEvent,
  map,
  Observable,
  observeOn,
  Observer,
  shareReplay,
  Subscription,
  take,
  takeUntil,
  tap,
} from 'rxjs';
import { InfoLogger, Logger } from '../util';
import { EventEmitter } from 'stream';

export type Streamed<T, TMarker> = T & {
  __marker__?: TMarker;
};

export interface ICloudProvider<TEvent, TMarker> {
  get id(): string;
  get signal(): AbortSignal;
  get logger(): Logger;

  init(): Observable<this>;
  snapshot<T>(): Observable<T[]>;
  stream(
    all?: boolean,
    expired?: (event: TEvent, marker: TMarker) => void
  ): Observable<TEvent>;
  expired<T>(): Observable<T>;
  store<T>(item: Expireable<T>): Observable<T>;
  unmarshall<T>(event: TEvent): T;
}

export type CloudOptions = {
  logger?: Logger;
};

export type Matcher<TEvent> = (
  event: TEvent,
  matched?: (event: TEvent) => void
) => boolean;

export type Expireable<T> = T & { __expires?: number };

export class StreamEvent<TEvent> extends EventEmitter<{
  start: [];
  expired: [TEvent];
  end: [];
}> {}

export abstract class CloudProvider<TEvent, TMarker>
  implements ICloudProvider<TEvent, TMarker>
{
  private static aborts: AbortController[] = [];
  public static DEFAULT_LOGGER = new InfoLogger();

  private static instances: Record<
    string,
    Observable<ICloudProvider<unknown, unknown>>
  > = {};

  private _events: StreamEvent<TEvent> = new StreamEvent();
  private _init$?: Observable<this>;
  private _stream$?: Observable<TEvent[]>;
  private _logger: Logger;
  private _signal: AbortSignal;

  static from<
    Options extends CloudOptions,
    Provider extends ICloudProvider<unknown, unknown>,
  >(
    this: new (id: string, options?: Options) => Provider,
    id: string,
    opts?: Options
  ): Observable<Provider> {
    if (!CloudProvider.instances[id]) {
      CloudProvider.instances[id] = new this(id, opts).init();
    }

    return CloudProvider.instances[id] as Observable<Provider>;
  }

  static abort(reason?: unknown): void {
    CloudProvider.aborts.forEach((abort) => {
      if (!abort.signal.aborted) {
        abort.abort(reason);
      }
    });
  }

  protected constructor(
    public readonly id: string,
    opts?: CloudOptions
  ) {
    this._events.setMaxListeners(100);

    this._logger = opts?.logger ?? CloudProvider.DEFAULT_LOGGER;

    const abort = new AbortController();
    CloudProvider.aborts.push(abort);
    this._signal = abort.signal;

    this._signal.addEventListener('abort', () => {
      this._events.emit('end');
      delete CloudProvider.instances[this.id];
    });

    process.once('beforeExit', () => {
      abort.abort(new Error('Process exiting...'));
    });
  }

  get logger(): Logger {
    return this._logger;
  }

  get signal(): AbortSignal {
    return this._signal;
  }

  protected abstract _init(): Observable<this>;
  protected abstract _snapshot<T>(): Observable<T[]>;
  protected abstract _stream(all: boolean): Observable<TEvent[]>;
  protected abstract _store<T>(
    item: Expireable<T>,
    matched?: (event: TEvent) => void
  ): Observable<Matcher<TEvent>>;
  protected abstract _unmarshall<T>(
    event: TEvent
  ): Streamed<Expireable<T>, unknown>;

  public init(): Observable<this> {
    return new Observable<this>((subscriber) => {
      if (!this._init$) {
        this.logger.debug?.(`[${this.id}] Initializing provider`);
        this._init$ = this._init().pipe(shareReplay(1));
      } else {
        this.logger.debug?.(`[${this.id}] Reusing existing init observable`);
      }

      const subscription = this._init$.subscribe(subscriber);

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  public snapshot<T>(): Observable<T[]> {
    return new Observable<T[]>((subscriber) => {
      const subscription = this._snapshot<T>().subscribe(subscriber);

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  public stream(all: boolean = false): Observable<TEvent> {
    return new Observable<TEvent>((subscriber) => {
      const observer: Observer<TEvent> = {
        next: (event) => {
          const unmarshalled = this._unmarshall(event);
          if (unmarshalled.__expires && Date.now() >= unmarshalled.__expires) {
            this._events.emit('expired', event);
            return;
          }
          subscriber.next(event);
        },
        error: (err) => {
          this.logger.warn?.(`[${this.id} all=${all}] Stream error:`, err);
          subscriber.error(err);
        },
        complete: () => {
          this.logger.debug?.(`[${this.id} all=${all}] Stream completed`);
          subscriber.complete();
        },
      };

      if (all) {
        // Don't use cached stream, always create a new one
        const subscription = this._stream(true)
          .pipe(concatAll())
          .subscribe(observer);

        return () => {
          subscription.unsubscribe();
        };
      }

      let started = false;

      if (!this._stream$) {
        this.logger.debug?.(`[${this.id}] Creating new 'latest' stream`);
        this._stream$ = this._stream(false).pipe(
          observeOn(asyncScheduler),
          shareReplay(1)
        );
      } else {
        this.logger.debug?.(`[${this.id}] Reusing existing 'latest' stream`);
      }

      this.logger.debug?.(`[${this.id}] Starting stream subscription`);
      const subscription = this._stream$
        .pipe(
          takeUntil(fromEvent(this._events, 'stop')),
          tap((events) => {
            if (events.length > 0) {
              this.logger.debug?.(
                `[${this.id}] Stream emitted ${events.length} events`
              );
            }

            if (!started) {
              started = true;
              this.logger.debug?.(`[${this.id}] Stream started`);
              this._events.emit('start');
            }
          }),
          concatAll()
        )
        .subscribe(observer);

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  public expired<T>(): Observable<T> {
    return new Observable<T>((subscriber) => {
      const subscription = fromEvent(this._events, 'expired')
        .pipe(
          map((event) => this._unmarshall<T>(event as TEvent)),
          filter((item) => !!item.__marker__),
          map((item) => {
            delete item.__marker__;
            delete item.__expires;
            return item as T;
          })
        )
        .subscribe({
          next: (item) => subscriber.next(item),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  public store<T>(item: Expireable<T>): Observable<T> {
    this.logger.debug?.(`[${this.id}] Starting store operation for:`, item);

    return new Observable<T>((subscriber) => {
      let stream: Subscription | undefined;
      let match: Subscription | undefined;
      const store = asyncScheduler.schedule(() => {
        const match$ = this._store(item).pipe(
          observeOn(asyncScheduler),
          take(1),
          shareReplay(1)
        );

        const stream$ = this.stream();

        this.logger.debug?.(`[${this.id}] Waiting for stream to start`);
        this._events.once('start', () => {
          this.logger.debug?.(
            `[${this.id}] Stream started, setting up matcher`
          );
          match = combineLatest([stream$, match$])
            .pipe(
              takeUntil(fromEvent(this._events, 'stop')),
              filter(([event, match]) => match(event)),
              map(([event]) => {
                const streamed = this._unmarshall(event) as Streamed<
                  T,
                  TMarker
                >;
                this.logger.debug?.(
                  `[${this.id}] Matched event, returning item:`,
                  streamed
                );
                delete streamed.__marker__;
                return streamed as T;
              })
            )
            .subscribe((item) => {
              this.logger.debug?.(`[${this.id}] Store operation completed`);
              subscriber.next(item);
              subscriber.complete();
            });
        });

        stream = stream$
          .pipe(takeUntil(fromEvent(this._events, 'start')))
          .subscribe();
      });

      return () => {
        store.unsubscribe();
        stream?.unsubscribe();
        match?.unsubscribe();
      };
    });
  }

  public unmarshall<T>(event: TEvent): T {
    const unmarshalled = this._unmarshall<T>(event);
    delete unmarshalled.__marker__;
    delete unmarshalled.__expires;
    return unmarshalled;
  }
}

export class RetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryError';
  }
}

export class FatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalError';
  }
}
