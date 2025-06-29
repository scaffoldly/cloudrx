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
import { Logger } from '@util';
import { EventEmitter } from 'stream';

export type Streamed<T, TMarker> = T & {
  __marker__?: TMarker;
};

export interface ICloudProvider<TEvent, TMarker> {
  get id(): string;
  get signal(): AbortSignal;
  get logger(): Logger;

  init(): Observable<this>;
  all(): Observable<TEvent>;
  stream(): Observable<TEvent>;
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
    this._logger = opts?.logger ?? console;
    this._signal = opts?.signal ?? new Abort().signal;

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

  public all(): Observable<TEvent> {
    return new Observable<TEvent>((subscriber) => {
      const subscription = this._stream(true)
        .pipe(concatAll())
        .subscribe(subscriber);

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  public stream(): Observable<TEvent> {
    return new Observable<TEvent>((subscriber) => {
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

      const stream$ = this.stream();

      const matcher$ = this._store(item).pipe(
        observeOn(asyncScheduler),
        take(1),
        shareReplay(1)
      );

      this.logger.debug?.(`[${this.id}] Waiting for stream to start`);
      this._events.once('start', () => {
        this.logger.debug?.(`[${this.id}] Stream started, setting up matcher`);
        match = combineLatest([stream$, matcher$])
          .pipe(
            takeUntil(fromEvent(this._events, 'stop')),
            filter(([event, matcher]) => matcher(event)),
            map(([event]) => {
              const streamed = this._unmarshall(event) as Streamed<T, TMarker>;
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
