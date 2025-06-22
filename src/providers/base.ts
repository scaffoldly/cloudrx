import { _Record } from '@aws-sdk/client-dynamodb-streams';
import {
  asyncScheduler,
  combineLatest,
  filter,
  from,
  fromEvent,
  map,
  Observable,
  observeOn,
  share,
  switchMap,
  take,
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
  stream(): Observable<StreamController>;
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

    opts.signal.addEventListener('abort', () => {
      this.abort(new Error('Provider aborted from global signal'));
      // Cancel all streams for this provider
      if (CloudProvider.streams[id]) {
        CloudProvider.streams[id].stop(new Error('Provider aborted'));
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
   * @param since Whether to start from oldest or latest events
   * @param controller The controller to manage the stream
   * @returns Observable of event arrays. Empty arrays will be delayed automatically.
   */
  protected abstract _stream(
    controller: StreamController
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
   * @returns Controller for the shared stream
   */
  public stream(): Observable<StreamController> {
    let controller = CloudProvider.streams[this.id];

    if (controller) {
      this.logger.debug(`[${this.id}] Reusing existing stream controller`);
      return new Observable<StreamController>((subscriber) => {
        subscriber.next(controller!);
        subscriber.complete();
        Promise.resolve().then(() => {
          // Emit start event immediately if stream already exists
          setTimeout(() => controller!.emit('start'), 10);
        });
      });
    }

    this.logger.debug(`[${this.id}] Creating new stream controller`);
    const streamAbort = new AbortController();
    let started = false;

    controller = CloudProvider.streams[this.id] = new StreamController(
      streamAbort
    );

    controller.on('error', (error) => {
      this.logger.error(`[${this.id}] Stream error:`, error);
    });

    controller.on('stop', () => {
      this.logger.debug(`[${this.id}] Stream stopped`);
      delete CloudProvider.streams[this.id];
    });

    const shared = this._stream(controller).pipe(
      observeOn(asyncScheduler),
      takeUntil(fromEvent(this.signal, 'abort')),
      takeUntil(fromEvent(streamAbort.signal, 'abort')),
      tap((events) => {
        if (!started) {
          started = true;
          this.logger.debug(`[${this.id}] Stream started`);
          controller.emit('start');
        }
        if (events.length > 0) {
          this.logger.debug(`[${this.id}] Streamed ${events.length} events`);
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
    this.logger.debug(`[${this.id}] Starting store() method for item:`, item);

    // Use provided stream controller or create/get one
    const controller$ = controller || this.stream();

    return controller$.pipe(
      switchMap((controller) => {
        const matcher$ = fromEvent(controller, 'start').pipe(
          tap(() => {
            this.logger.debug(`[${this.id}] Stream started, now storing item`);
          }),
          take(1),
          switchMap(() => from(this._store(item)))
        );

        const streamed$ = (fromEvent(this, 'event') as Observable<TEvent>).pipe(
          tap((event) => {
            this.logger.debug(`[${this.id}] Received event:`, event);
          }),
          takeUntil(fromEvent(controller.signal, 'abort')),
          takeUntil(fromEvent(controller, 'stop')),
          takeUntil(fromEvent(controller, 'error'))
        );

        return combineLatest([matcher$, streamed$]).pipe(
          filter(([matcher, event]) => {
            return matcher(event);
          }),
          take(1),
          map(([, event]) => this.unmarshall(event) as Streamed<T, unknown>),
          map((streamed) => {
            const marker = streamed.__marker__;
            this.logger.debug(`[${this.id}][${marker}] Item stored:`, item);
            delete streamed.__marker__;
            return streamed as T;
          })
        );
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
