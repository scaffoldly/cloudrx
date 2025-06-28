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
import { ErrorLogger, Logger } from '@util';
import { EventEmitter } from 'stream';

export type Streamed<T, TMarker> = T & {
  __marker__?: TMarker;
};

export interface ICloudProvider<TEvent, TMarker> {
  get id(): string;
  get signal(): AbortSignal;
  get logger(): Logger;

  init(): Observable<this>;
  stream(all?: boolean): Observable<TEvent>;
  store<T>(item: T): Observable<T>;
  unmarshall<T>(event: TEvent): Streamed<T, TMarker>;
}

type RequiredCloudOptions = {
  signal: AbortSignal;
  logger: Logger;
};

export type CloudOptions = Partial<RequiredCloudOptions>;

export type Matcher<TEvent> = (event: TEvent) => boolean;

export class Abort extends AbortController {
  constructor(signal?: AbortSignal) {
    super();
    if (signal) {
      signal.addEventListener('abort', () => this.abort());
    } else {
      process.once('uncaughtException', (err) =>
        process.nextTick(() => this.abort(err))
      );
      process.once('unhandledRejection', (reason) =>
        process.nextTick(() => this.abort(reason))
      );
      process.once('SIGINT', () =>
        process.nextTick(() => this.abort('SIGINT received'))
      );
      process.once('SIGTERM', () =>
        process.nextTick(() => this.abort('SIGTERM received'))
      );
    }
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
  private static instances: Record<
    string,
    Observable<ICloudProvider<unknown, unknown>>
  > = {};

  private opts: RequiredCloudOptions;
  private init$?: Observable<this>;
  private latest$?: Observable<TEvent[]>;
  private all$?: Observable<TEvent[]>;
  private events: StreamEvent = new StreamEvent();

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
    this.opts = {
      logger: opts?.logger || new ErrorLogger(console),
      signal: opts?.signal || new Abort().signal,
      ...opts,
    };
    this.opts.signal.addEventListener('abort', () => {
      this.events.emit('end');
      delete CloudProvider.instances[this.id];
    });
  }

  get logger(): Logger {
    return this.opts.logger;
  }

  get signal(): AbortSignal {
    return this.opts.signal;
  }

  protected abstract _init(): Observable<this>;
  protected abstract _stream(all: boolean): Observable<TEvent[]>;
  protected abstract _store<T>(item: T): Observable<Matcher<TEvent>>;
  protected abstract _unmarshall<T>(event: TEvent): Streamed<T, unknown>;

  public init(): Observable<this> {
    return new Observable<this>((subscriber) => {
      if (!this.init$) {
        this.init$ = this._init().pipe(shareReplay(1));
      }

      const subscription = this.init$.subscribe(subscriber);

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  public stream(all?: boolean): Observable<TEvent> {
    return new Observable<TEvent>((subscriber) => {
      let stream$: Observable<TEvent[]>;

      if (all) {
        if (!this.all$) {
          this.all$ = this._stream(true).pipe(
            observeOn(asyncScheduler),
            shareReplay(1)
          );
        }
        stream$ = this.all$;
      } else {
        if (!this.latest$) {
          this.latest$ = this._stream(false).pipe(
            observeOn(asyncScheduler),
            shareReplay(1)
          );
        }
        stream$ = this.latest$;
      }

      const subscription = stream$
        .pipe(
          takeUntil(fromEvent(this.events, 'stop')),
          tap(() => {
            this.events.emit('start');
          }),
          concatAll()
        )
        .subscribe(subscriber);

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  public store<T>(item: T): Observable<T> {
    return new Observable<T>((subscriber) => {
      let stream: Subscription | undefined;
      let match: Subscription | undefined;

      const stream$ = this.stream(false);

      const matcher$ = this._store(item).pipe(
        observeOn(asyncScheduler),
        take(1),
        shareReplay(1)
      );

      this.events.once('start', () => {
        match = combineLatest([stream$, matcher$])
          .pipe(
            takeUntil(fromEvent(this.events, 'stop')),
            filter(([event, matcher]) => matcher(event)),
            map(([event]) => {
              const streamed = this._unmarshall(event) as Streamed<T, TMarker>;
              this.logger.debug(`[${this.id}] Item streamed:`, streamed);
              delete streamed.__marker__;
              return streamed as T;
            })
          )
          .subscribe(subscriber);
      });

      stream = stream$
        .pipe(takeUntil(fromEvent(this.events, 'start')))
        .subscribe();

      return () => {
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
