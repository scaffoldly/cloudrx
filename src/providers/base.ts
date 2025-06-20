import { _Record } from '@aws-sdk/client-dynamodb-streams';
import {
  asyncScheduler,
  combineLatest,
  delayWhen,
  filter,
  first,
  fromEvent,
  map,
  Observable,
  observeOn,
  of,
  share,
  switchMap,
  takeUntil,
  tap,
  timer,
} from 'rxjs';
import { EventEmitter } from 'events';
import { Logger, NoOpLogger } from '..';

export type CloudProviderOptions = {
  signal: AbortSignal;
  logger?: Logger;
  pollInterval?: number;
};

export interface StreamController {
  signal: AbortSignal;
  stop: (reason?: unknown) => Promise<void>;
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
  stream(): StreamController;
  store<T>(item: T, streamController?: StreamController): Observable<T>;
}

/**
 * Abstract base class for cloud providers that stream events.
 * Implementations must provide initialization and streaming logic.
 * @template TEvent The type of events this provider emits
 */
export abstract class CloudProvider<TEvent>
  extends EventEmitter<{
    streamEvent: [TEvent];
    streamStart: [];
    streamStop: [];
    streamError: [Error];
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
      CloudProvider.aborts[id]?.abort();
      // Cancel all streams for this provider
      if (CloudProvider.streams[id]) {
        CloudProvider.streams[id].stop('Provider aborted');
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
  public stream(): StreamController {
    // Return existing stream if it exists
    const existingStream = CloudProvider.streams[this.id];
    if (existingStream) {
      // Emit streamStart for existing streams using asyncScheduler with minimal delay
      asyncScheduler.schedule(() => this.emit('streamStart'), 50);
      return existingStream;
    }

    // Create new shared stream
    const streamAbort = new AbortController();
    let isStarted = false;

    const controller: StreamController = {
      signal: streamAbort.signal,
      stop: (reason?: unknown): Promise<void> => {
        return new Promise<void>((resolve) => {
          streamAbort.abort(reason);
          this.emit('streamStop');
          // Remove from streams registry
          delete CloudProvider.streams[this.id];
          resolve();
        });
      },
    };

    const sharedObservable = this._stream(controller).pipe(
      takeUntil(fromEvent(this.signal, 'abort')),
      takeUntil(fromEvent(streamAbort.signal, 'abort')),
      // Emit streamStart immediately on first event batch, then apply delay for empty arrays
      tap((_events) => {
        if (!isStarted) {
          isStarted = true;
          this.emit('streamStart');
        }
      }),
      // Delay empty arrays to avoid tight polling loops
      delayWhen((events) => (events.length === 0 ? timer(100) : of(events))),
      tap((events) => {
        // Emit individual events
        if (events.length > 0) {
          events.forEach((event) => {
            this.emit('streamEvent', event);
          });
        }
      }),
      share({
        resetOnError: false,
        resetOnComplete: false,
        resetOnRefCountZero: false,
      })
    );

    // Store in global registry
    CloudProvider.streams[this.id] = controller;

    // Subscribe to make it hot and handle lifecycle events
    sharedObservable.subscribe({
      error: (error) => {
        isStarted = false;
        streamAbort.abort(error);
        this.emit('streamError', error);
        // Remove from streams registry on error
        delete CloudProvider.streams[this.id];
      },
      complete: () => {
        isStarted = false;
        streamAbort.abort();
        this.emit('streamStop');
        // Remove from streams registry on completion
        delete CloudProvider.streams[this.id];
      },
    });

    return controller;
  }

  /**
   * Store an item and wait for it to appear in the stream.
   * @param item The item to store
   * @param streamController Optional stream controller to use for listening. If not provided, creates or reuses existing stream.
   * @returns Observable that emits the item when it appears in the stream
   */
  public store<T>(item: T, streamController?: StreamController): Observable<T> {
    this.logger.debug(`[${this.id}] Starting store() method for item:`, item);

    // Use provided stream controller or create/get one
    const controller = streamController || this.stream();

    return new Observable<T>((subscriber) => {
      // Always wait for stream to be ready before storing
      // This ensures the stream iterator is established and can capture the event
      const started$ = fromEvent(this, 'streamStart').pipe(
        first(),
        // Use asyncScheduler to ensure consistent timing with stream emission
        observeOn(asyncScheduler),
        tap(() =>
          this.logger.debug(`[${this.id}] Iterator ready, now storing item`)
        ),
        switchMap(() => this._store(item))
      );

      // Set up event listening
      const eventStream$ = (
        fromEvent(this, 'streamEvent') as Observable<TEvent>
      ).pipe(
        takeUntil(fromEvent(this, 'streamStop')),
        takeUntil(fromEvent(this, 'streamError')),
        takeUntil(fromEvent(controller.signal, 'abort'))
      );

      const storeAndWait$ = combineLatest([started$, eventStream$]).pipe(
        filter(([matcher, event]) => {
          const matches = matcher(event);
          if (matches) {
            this.logger.info(
              `[${this.id}] Event matched! Completing store operation`
            );
          } else {
            this.logger.debug(`[${this.id}] Event did not match stored item`);
          }
          return matches;
        }),
        first(), // Take only the first matching event
        map(() => item) // Return the original item
      );

      const subscription = storeAndWait$.subscribe({
        next: (result) => {
          subscriber.next(result);
        },
        complete: () => {
          this.logger.debug(`[${this.id}] Store operation complete:`, item);
          // Do not stop the stream controller - it's shared
          subscriber.complete();
        },
        error: (error) => {
          this.logger.error(`[${this.id}] Store operation failed:`, error);
          // Don't stop the shared stream controller on individual store errors
          subscriber.error(error);
        },
      });

      // Cleanup function
      return () => {
        // Do not stop the stream controller - it's shared
        subscription.unsubscribe();
      };
    });
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
