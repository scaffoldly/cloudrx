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
  stream(all?: boolean): Observable<TEvent>;
  store<T>(item: T): Observable<T>;
  unmarshall<T>(event: TEvent): Streamed<T, TMarker>;
}

export type CloudOptions = {
  signal?: AbortSignal;
  logger?: Logger;
};

export type Matcher<TEvent> = (event: TEvent) => boolean;

export class Abort extends AbortController {
  constructor(signal?: AbortSignal) {
    super();
    if (signal) {
      signal.addEventListener('abort', () => this.abort(signal.reason));
    } else {
      // Hook into standard Node.js process events
      ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'].forEach((signalType) => {
        process.on(signalType, () => {
          this.abort(new Error(`Aborted by ${signalType}`));
        });
      });

      // Hook into process exit events
      process.on('beforeExit', (code) => {
        this.abort(new Error(`Process exiting with code: ${code}`));
      });

      process.on('exit', (code) => {
        this.abort(new Error(`Process exit with code: ${code}`));
      });

      // Hook into error events
      process.on('uncaughtException', (error) => {
        this.abort(error);
      });

      process.on('unhandledRejection', (reason) => {
        this.abort(reason);
      });
    }
  }

  override abort(reason?: unknown): void {
    super.abort(reason);
  }
}

export class StreamEvent extends EventEmitter<{
  start: [];
  end: [];
}> {}

/**
 * Abstract base class for cloud providers that stream events.
 * Implementations must provide initialization and streaming logic.
 * @template TEvent The type of events this provider emits
 */
export abstract class CloudProvider<TEvent, TMarker>
  implements ICloudProvider<TEvent, TMarker>
{
  public static DEFAULT_ABORT = new Abort();
  public static DEFAULT_LOGGER = new InfoLogger();

  private static instances: Record<
    string,
    Observable<ICloudProvider<unknown, unknown>>
  > = {};

  private _events: StreamEvent = new StreamEvent();
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

  protected constructor(
    public readonly id: string,
    opts?: CloudOptions
  ) {
    this._events.setMaxListeners(100);

    this._logger = opts?.logger ?? CloudProvider.DEFAULT_LOGGER;
    this._signal = new Abort(
      opts?.signal ?? CloudProvider.DEFAULT_ABORT.signal
    ).signal;

    this._signal.addEventListener('abort', () => {
      this._events.emit('end');
      delete CloudProvider.instances[this.id];
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
  protected abstract _store<T>(item: T): Observable<Matcher<TEvent>>;
  protected abstract _unmarshall<T>(event: TEvent): Streamed<T, unknown>;

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
      if (all) {
        // Don't use cached stream, always create a new one
        const subscription = this._stream(true)
          .pipe(concatAll())
          .subscribe(subscriber);

        return () => {
          subscription.unsubscribe();
        };
      }

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
            this._events.emit('start');
          }),
          concatAll()
        )
        .subscribe({
          next: (event) => subscriber.next(event),
          error: (error) => {
            this.logger.debug?.(`[${this.id}] Stream error:`, error);
            subscriber.error(error);
          },
          complete: () => {
            this.logger.debug?.(`[${this.id}] Stream completed`);
            subscriber.complete();
          },
        });

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  public store<T>(item: T): Observable<T> {
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

  public unmarshall<T>(event: TEvent): Streamed<T, TMarker> {
    return this._unmarshall(event) as Streamed<T, TMarker>;
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
