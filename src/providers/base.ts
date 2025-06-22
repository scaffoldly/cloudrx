import { _Record } from '@aws-sdk/client-dynamodb-streams';
import {
  asyncScheduler,
  catchError,
  concatMap,
  EMPTY,
  fromEvent,
  map,
  Observable,
  observeOn,
  share,
  Subject,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';
import { EventEmitter } from 'events';
import { Logger, NoOpLogger } from '..';

export type CloudProviderOptions = {
  signal: AbortSignal;
  logger?: Logger;
  pollInterval?: number;
};

export class StreamController extends EventEmitter<{
  start: [];
  stop: [];
  error: [Error];
}> {
  public readonly signal: AbortSignal;

  constructor(private abort: AbortController) {
    super({ captureRejections: true });
    this.signal = abort.signal;
  }

  public stop(reason?: Error): Promise<void> {
    return new Promise<void>((resolve) => {
      this.signal.addEventListener('abort', () => {
        if (reason) {
          this.emit('error', reason);
        }
        this.emit('stop');
        resolve();
      });
      this.abort.abort(reason);
    });
  }
}

/**
 * Marker type for streamed events
 * @template T The type of the streamed object
 * @template Marker The type of the marker, to identify the location of the event in the stream
 */
export type Streamed<T, Marker> = T & {
  __marker__?: Marker;
};

export interface ICloudProvider<TEvent> {
  abort(reason?: unknown): void;
  unmarshall<T>(event: TEvent): Streamed<T, unknown>;
  stream(all?: boolean): Observable<StreamController>;
  store<T>(item: T, controller?: Observable<StreamController>): Observable<T>;
}

/**
 * Abstract base class for cloud providers that stream events.
 * Implementations must provide initialization and streaming logic.
 * @template TEvent The type of events this provider emits
 */
export abstract class CloudProvider<TEvent>
  extends EventEmitter<{
    event: [TEvent];
  }>
  implements ICloudProvider<TEvent>
{
  private _logger: Logger;
  public static readonly aborts: Record<string, AbortController> = {};
  private static readonly streams: Record<string, StreamController> = {};
  private store$ = new Subject<() => Observable<void>>();

  protected constructor(
    protected readonly id: string,
    protected readonly opts: CloudProviderOptions
  ) {
    super({ captureRejections: true });
    this._logger = opts.logger || new NoOpLogger();

    if (!id || typeof id !== 'string') {
      throw new Error('CloudProvider id must be a non-empty string');
    }

    CloudProvider.aborts[id] = new AbortController();

    // Set up the RxJS-based store queue processor
    const store = this.store$
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

    opts.signal.addEventListener('abort', () => {
      this.abort(opts.signal.reason);
      // Cancel all streams for this provider
      if (CloudProvider.streams[id]) {
        CloudProvider.streams[id].stop(opts.signal.reason);
        delete CloudProvider.streams[id];
      }
      store.unsubscribe();
    });

    // When provider aborts, abort any active streams
    CloudProvider.aborts[id].signal.addEventListener('abort', () => {
      if (CloudProvider.streams[id]) {
        CloudProvider.streams[id].stop(CloudProvider.aborts[id]?.signal.reason);
        delete CloudProvider.streams[id];
      }
    });
  }

  protected get logger(): Logger {
    return this._logger;
  }

  private get signal(): AbortSignal {
    return CloudProvider.aborts[this.id]!.signal;
  }

  public abort(reason?: unknown): void {
    CloudProvider.aborts[this.id]?.abort(reason);
  }

  /**
   * Initialize the provider. Called once before streaming begins.
   * @returns Observable that emits this provider when ready
   */
  protected abstract init(signal: AbortSignal): Observable<this>;

  /**
   * Stream events from the provider.
   * @param controller The controller to manage the stream
   * @param all Whether to start from oldest (TRIM_HORIZON) or latest (LATEST) events
   * @returns Observable of event arrays. Empty arrays will be delayed automatically.
   */
  protected abstract _stream(
    controller: StreamController,
    all?: boolean
  ): Observable<TEvent[]>;

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
  public stream(all: boolean = false): Observable<StreamController> {
    let controller = CloudProvider.streams[this.id];

    if (controller) {
      this.logger.debug(`[${this.id}] Reusing existing stream controller`);
      return new Observable<StreamController>((subscriber) => {
        subscriber.next(controller!);
        subscriber.complete();
        // For existing streams, emit start event after a microtask to indicate readiness
        // Promise.resolve().then(() => {
        //   this.logger.debug(
        //     `[${this.id}] Emitting start event for existing stream`
        //   );
        //   setTimeout(() => controller!.emit('start'), 100);
        // });
      });
    }

    this.logger.debug(`[${this.id}] Creating new stream controller`);
    const streamAbort = new AbortController();

    let started = false;

    controller = CloudProvider.streams[this.id] = new StreamController(
      streamAbort
    );

    controller.on('error', (error) => {
      // Don't log AbortError as they're part of normal shutdown
      if (error.name !== 'AbortError') {
        this.logger.error(`[${this.id}] Stream error:`, error);
      } else {
        this.logger.debug(`[${this.id}] Stream stopped due to abort signal`);
      }
    });

    controller.on('stop', () => {
      this.logger.debug(`[${this.id}] Stream stopped`);
      delete CloudProvider.streams[this.id];
    });

    const shared = this._stream(controller, all).pipe(
      observeOn(asyncScheduler),
      takeUntil(fromEvent(streamAbort.signal, 'abort')),
      tap((events) => {
        if (!started) {
          started = true;
          this.logger.debug(
            `[${this.id}] Stream first batch processed, scheduling start event`
          );
          // Emit start event after a microtask to ensure stream is positioned
          // This allows the underlying implementation to establish its position
          Promise.resolve().then(() => {
            this.logger.debug(
              `[${this.id}] Emitting start event for new stream`
            );
            setTimeout(() => controller!.emit('start'), 100);
          });
        }

        if (events.length > 0) {
          events.forEach((event) => {
            this.emit('event', event);
          });
        }
      }),
      share({
        resetOnError: true,
        resetOnComplete: true,
        resetOnRefCountZero: true,
      })
    );

    shared.subscribe({
      error: async (error) => {
        this.logger.error(`[${this.id}] Stream error:`, error);
        started = false;
        await controller.stop(error);
      },
      complete: async () => {
        this.logger.debug(`[${this.id}] Stream completed`);
        started = false;
        await controller.stop();
      },
    });

    return new Observable<StreamController>((subscriber) => {
      this.logger.debug(`[${this.id}] Emitting new stream controller`);
      subscriber.next(controller);
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
    controller?: Observable<StreamController>
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
              this.off('event', eventHandler);
            }
          };

          // Create the store operation as an Observable
          const storeOperation = (): Observable<void> => {
            return this._store(item).pipe(
              tap((matcherFn) => {
                if (!isCompleted) {
                  matcher = matcherFn;
                  this.on('event', eventHandler);
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
