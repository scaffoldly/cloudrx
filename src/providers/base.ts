import { _Record } from '@aws-sdk/client-dynamodb-streams';
import EventEmitter from 'events';
import {
  asyncScheduler,
  catchError,
  concatMap,
  EMPTY,
  fromEvent,
  map,
  Observable,
  observeOn,
  of,
  share,
  shareReplay,
  Subject,
  Subscription,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';
import { Logger, NoOpLogger } from '@util';

/**
 * Marker type for streamed events
 * @template T The type of the streamed object
 * @template Marker The type of the marker, to identify the location of the event in the stream
 */
export type Streamed<T, Marker> = T & {
  __marker__?: Marker;
};

export interface ICloudProvider<TEvent> {
  get id(): string;
  get signal(): AbortSignal;
  get logger(): Logger;

  init(signal: AbortSignal): Observable<this>;
  abort(reason?: unknown): void;
  unmarshall<T>(event: TEvent): Streamed<T, unknown>;
  stream(): Observable<StreamController<TEvent>>;
  store<T>(
    item: T,
    controller?: Observable<StreamController<TEvent>>
  ): Observable<T>;
}

export class StreamController<TEvent> extends EventEmitter<{
  start: [];
  stop: [];
  error: [Error];
  event: [TEvent];
}> {
  private _subscription?: Subscription;
  private readonly logger: Logger;
  private readonly id: string;
  private abortController: AbortController = new AbortController();

  constructor(provider: ICloudProvider<TEvent>) {
    super({ captureRejections: true });
    this.id = `${provider.id}-stream`;
    this.logger = provider.logger;

    provider.signal.addEventListener('abort', async () => {
      this.abortController.abort(provider.signal.reason);
      this.emit('error', provider.signal.reason);
    });

    this.on('error', async (error) => {
      await this.stop();
      const isAbortError =
        (error as Error)?.name === 'AbortError' ||
        (typeof error === 'string' && (error as string).includes('aborted'));

      if (isAbortError) {
        this.logger.debug(
          `[${this.id}] Stream controller stopped due to abort`
        );
      } else {
        this.logger.error(`[${this.id}] Stream controller error:`, error);
      }
    });
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  public start(subscription: Subscription): Promise<void> {
    this._subscription = subscription;
    return new Promise((resolve) => {
      this.once('start', () => {
        this.logger.debug(`[${this.id}] Stream controller started`);
        resolve();
      });
      this.emit('start');
    });
  }

  public stop(): Promise<void> {
    this._subscription?.unsubscribe();
    delete this._subscription;
    this.abortController.abort('Stream stopped');
    return new Promise((resolve) => {
      this.once('stop', () => {
        this.logger.debug(`[${this.id}] Stream controller stopped`);
        resolve();
      });
      this.emit('stop');
    });
  }
}

export type CloudOptions = {
  signal: AbortSignal;
  logger?: Logger;
  replay?: boolean;
  pollInterval?: number;
};

/**
 * Abstract base class for cloud providers that stream events.
 * Implementations must provide initialization and streaming logic.
 * @template TEvent The type of events this provider emits
 */
export abstract class CloudProvider<TEvent> implements ICloudProvider<TEvent> {
  private static instances = new Map<string, Observable<unknown>>();

  private _logger: Logger;
  private streamController?: StreamController<TEvent>;
  private abortController = new AbortController();

  private store$ = new Subject<() => Observable<void>>();
  private storeSubscription?: Subscription;

  static from<
    Options extends CloudOptions,
    Provider extends ICloudProvider<unknown>,
  >(
    this: new (id: string, options: Options) => Provider,
    id: string,
    options: Options
  ): Observable<Provider> {
    if (!CloudProvider.instances.has(id)) {
      const instance$ = new this(id, options)
        .init(options.signal)
        .pipe(shareReplay(1));
      CloudProvider.instances.set(id, instance$);
    }

    return CloudProvider.instances.get(id) as Observable<Provider>;
  }

  constructor(
    public readonly id: string,
    protected readonly opts: CloudOptions
  ) {
    this._logger = opts.logger || new NoOpLogger();

    if (!id || typeof id !== 'string') {
      throw new Error('CloudProvider id must be a non-empty string');
    }

    opts.signal.addEventListener('abort', () => {
      this.abort(opts.signal.reason);
    });

    // Set up the RxJS-based store queue processor
    this.storeSubscription = this.store$
      .pipe(
        concatMap((operation) =>
          operation().pipe(
            catchError((error) => {
              this.logger.error(`[${this.id}] Store operation failed:`, error);
              return EMPTY; // Continue processing other operations
            })
          )
        ),
        takeUntil(fromEvent(opts.signal, 'abort'))
      )
      .subscribe();
  }

  get logger(): Logger {
    return this._logger;
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  public abort(reason: unknown): void {
    this.abortController.abort(reason);
    this.storeSubscription?.unsubscribe();
    delete this.storeSubscription;
    this.streamController?.stop().then(() => {
      this.logger.debug(`[${this.id}] Stream controller stopped due to abort`);
    });
    delete this.streamController;
  }

  /**
   * Initialize the provider. Called once before streaming begins.
   * @returns Observable that emits this provider when ready
   */
  abstract init(signal: AbortSignal): Observable<this>;

  /**
   * Stream events from the provider.
   * @param controller The controller to manage the stream
   * @param all Whether to start from oldest (TRIM_HORIZON) or latest (LATEST) events
   * @returns Observable of event arrays. Empty arrays will be delayed automatically.
   */
  protected abstract _stream(all: boolean): Observable<TEvent[]>;

  /**
   * Unmarshall a raw event into a typed object.
   * @param event The raw event data
   * @returns The unmarshalled object
   * @template T The type of the unmarshalled object
   * @throws {Error} If unmarshalling fails
   */
  public abstract unmarshall<T>(event: TEvent): Streamed<T, unknown>;

  /**
   * Store an item to the provider's backing store.
   * @param item The item to store
   * @returns Observable that emits a matcher function when the item is successfully stored
   */
  protected abstract _store<T>(item: T): Observable<(event: TEvent) => boolean>;

  /**
   * Get or create a shared stream for this provider.
   * Streams are lazily created and shared across all callers.
   * @param all Whether to stream all events from the beginning (TRIM_HORIZON) or only new events (LATEST)
   * @returns Controller for the shared stream
   */
  public stream(): Observable<StreamController<TEvent>> {
    if (this.streamController) {
      this.logger.debug(`[${this.id}] Reusing existing stream controller`);
      return of(this.streamController);
    }

    this.logger.debug(`[${this.id}] Creating new stream controller`);

    let started = false;
    let subscription: Subscription | undefined;

    this.streamController = new StreamController(this);
    const all = this.opts.replay ?? false;

    const sharedStream = this._stream(all).pipe(
      takeUntil(fromEvent(this.signal, 'abort')),
      observeOn(asyncScheduler),
      tap(() => {
        if (!started) {
          started = true;
          this.streamController?.start(subscription!);
        }
      }),
      share({
        resetOnError: true,
        resetOnComplete: true,
        resetOnRefCountZero: true,
      })
    );

    subscription = sharedStream.subscribe({
      next: (events) => {
        this.logger.debug(
          `[${this.id}] Stream emitted ${events.length} events`
        );
        events.forEach((event) => {
          this.streamController?.emit('event', event);
        });
      },
      error: async (error) => {
        this.logger.error(`[${this.id}] Stream subscription error:`, error);
        started = false;
        this.streamController?.stop().then(() => {
          this.logger.debug(
            `[${this.id}] Stream controller stopped due to stream error`
          );
        });
        delete this.streamController;
      },
      complete: async () => {
        this.logger.debug(`[${this.id}] Stream subscription completed`);
        started = false;
        this.streamController?.stop().then(() => {
          this.logger.debug(
            `[${this.id}] Stream controller stopped on stream completion`
          );
        });
        delete this.streamController;
      },
    });

    return new Observable<StreamController<TEvent>>((subscriber) => {
      this.logger.debug(`[${this.id}] Emitting new stream controller`);
      subscriber.next(this.streamController!);
      subscriber.complete();
    });
  }

  /**
   * Store an item and wait for it to appear in the stream.
   * @param item The item to store
   * @param controller Optional stream controller to use for listening. If not provided, creates or reuses existing stream.
   * @returns Observable that emits the item when it appears in the stream
   */
  public store<T>(
    item: T,
    controller?: Observable<StreamController<TEvent>>
  ): Observable<T> {
    // Use provided stream controller or create/get one
    const controller$ = controller || this.stream();

    return controller$.pipe(
      switchMap((controller) => {
        return new Observable<T>((subscriber) => {
          let matcher: (event: TEvent) => boolean;
          let isCompleted = false;
          let eventHandler: (event: TEvent) => void;

          const cleanup = (): void => {
            if (eventHandler) {
              controller.off('event', eventHandler);
            }
          };

          // Create the store operation as an Observable
          const storeOperation = (): Observable<void> => {
            return this._store(item).pipe(
              tap((matcherFn) => {
                if (!isCompleted) {
                  matcher = matcherFn;
                  controller.on('event', eventHandler);
                }
              }),
              map(() => void 0), // Convert to Observable<void>
              catchError((err) => {
                cleanup();
                subscriber.error(err);
                throw err; // Re-throw to let the queue error handler catch it
              })
            );
          };

          // Add event handler
          eventHandler = (event: TEvent): void => {
            if (isCompleted || !matcher) return;

            if (matcher(event)) {
              isCompleted = true;
              cleanup();

              const streamed = this.unmarshall(event) as Streamed<T, unknown>;
              const marker = streamed.__marker__;
              this.logger.debug(
                `[${this.id}][${marker}] Item matched and retrieved:`,
                item
              );
              delete streamed.__marker__;

              subscriber.next(streamed as T);
              subscriber.complete();
            }
          };

          // Wait for start, then queue the operation
          controller.once('start', () => {
            this.store$.next(storeOperation);
          });

          // Cleanup function for subscription disposal
          return cleanup;
        });
      })
    );
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
