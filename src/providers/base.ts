import { _Record } from '@aws-sdk/client-dynamodb-streams';
import {
  asyncScheduler,
  combineLatest,
  filter,
  fromEvent,
  map,
  Observable,
  observeOn,
  Observer,
  OperatorFunction,
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

export interface ICloudProvider<TEvent> {
  get id(): string;
  get signal(): AbortSignal;
  get logger(): Logger;

  init(): Observable<this>;
  snapshot<T>(): Observable<T[]>;
  stream(all?: boolean): Observable<TEvent>;
  expired(): Observable<TEvent>;
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

export type StreamEvents<T> = { start: []; expired: [T]; end: [] };
export class StreamEvent<TEvent, TMarker> extends EventEmitter<
  StreamEvents<TEvent>
> {
  private expirations: Map<TMarker, Subscription> = new Map();

  constructor() {
    super({ captureRejections: true });
    this.setMaxListeners(Number.MAX_SAFE_INTEGER);

    this.once('end', () => {
      this.removeAllListeners('expired');
      this.expirations.forEach((sub) => sub.unsubscribe());
      this.expirations.clear();
    });
  }

  expire(marker: TMarker, event: TEvent, delaySec: number = 0): void {
    if (this.expirations.has(marker)) {
      return;
    }

    this.expirations.set(
      marker,
      asyncScheduler.schedule(() => {
        this.emit('expired', event);
        this.expirations.delete(marker);
      }, delaySec * 1000)
    );
  }
}

export abstract class CloudProvider<TEvent, TMarker>
  implements ICloudProvider<TEvent>
{
  private static aborts: AbortController[] = [];
  public static DEFAULT_LOGGER = new InfoLogger();
  public static TIME = (date = new Date()): number =>
    Math.floor(date.getTime() / 1000);

  protected events: StreamEvent<TEvent, TMarker> = new StreamEvent();

  private static instances: Record<
    string,
    Observable<ICloudProvider<unknown>>
  > = {};

  private _init$?: Observable<this>;
  private _stream$?: Observable<TEvent[]>;
  private _logger: Logger;
  private _signal: AbortSignal;

  private get stream$(): Observable<TEvent[]> {
    if (this._stream$) return this._stream$;

    this.logger.debug?.(`[${this.id}] Creating new 'latest' stream`);
    this._stream$ = this._stream(false).pipe(
      observeOn(asyncScheduler),
      shareReplay(1)
    );

    return this._stream$;
  }

  static from<
    Options extends CloudOptions,
    Provider extends ICloudProvider<unknown>,
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
    this._logger = opts?.logger ?? CloudProvider.DEFAULT_LOGGER;

    const abort = new AbortController();
    CloudProvider.aborts.push(abort);
    this._signal = abort.signal;

    this._signal.addEventListener('abort', () => {
      this.events.emit('end');
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
          subscriber.next(event);
        },
        error: (err) => {
          this.logger.warn?.(`[${this.id}] Stream error:`, err);
          subscriber.error(err);
        },
        complete: () => {
          this.logger.debug?.(`[${this.id}] Stream completed`);
          subscriber.complete();
        },
      };

      if (all) {
        // Don't use cached stream, always create a new one
        const subscription = this._stream(true)
          .pipe(this.concatAll())
          .subscribe(observer);

        return () => {
          subscription.unsubscribe();
        };
      }

      let started = false;

      this.logger.debug?.(`[${this.id}] Starting stream subscription`);
      const subscription = this.stream$
        .pipe(
          tap((events) => {
            if (events.length > 0) {
              this.logger.debug?.(
                `[${this.id}] Stream emitted ${events.length} events`
              );
            }

            if (!started) {
              started = true;
              this.logger.debug?.(`[${this.id}] Stream started`);
              this.events.emit('start');
            }
          }),
          this.concatAll()
        )
        .subscribe(observer);

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  public expired(): Observable<TEvent> {
    return new Observable<TEvent>((subscriber) => {
      const handler = (events: TEvent): void => {
        subscriber.next(events);
      };

      this.events.on('expired', handler);

      const subscription = this.stream$
        .pipe(this.concatAll(this.events))
        .subscribe();

      return () => {
        subscription.unsubscribe();
        this.events.off('expired', handler);
      };
    });
  }

  private concatAll(
    emitter?: StreamEvent<TEvent, TMarker>
  ): OperatorFunction<TEvent[], TEvent> {
    return (source: Observable<TEvent[]>): Observable<TEvent> => {
      return new Observable<TEvent>((subscriber) => {
        const subscription = source
          .pipe(
            map((events) =>
              events.filter((event) => {
                const unmarshalled = this._unmarshall(event);
                if (!unmarshalled.__expires) return true;

                const remaining = Math.max(
                  0,
                  unmarshalled.__expires - CloudProvider.TIME()
                );

                emitter?.expire(
                  unmarshalled.__marker__ as TMarker,
                  event,
                  remaining
                );

                return remaining > 0;
              })
            )
          )
          .subscribe({
            next: (events) => {
              events.forEach((event) => {
                subscriber.next(event);
              });
            },
            error: (err) => subscriber.error(err),
            complete: () => subscriber.complete(),
          });

        return () => {
          subscription.unsubscribe();
        };
      });
    };
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
        this.events.once('start', () => {
          this.logger.debug?.(
            `[${this.id}] Stream started, setting up matcher`
          );
          match = combineLatest([stream$, match$])
            .pipe(
              takeUntil(fromEvent(this.events, 'stop')),
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
          .pipe(takeUntil(fromEvent(this.events, 'start')))
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
