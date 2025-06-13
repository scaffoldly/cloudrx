import { _Record } from '@aws-sdk/client-dynamodb-streams';
import {
  combineLatest,
  concatAll,
  delayWhen,
  filter,
  first,
  fromEvent,
  map,
  Observable,
  of,
  switchMap,
  takeUntil,
  tap,
  timer,
} from 'rxjs';
import { EventEmitter } from 'events';
import { Logger } from '..';

export * from './aws';

export type Consistency = 'weak' | 'strong';
export type Since = 'oldest' | 'latest';

export type CloudProviderOptions = {
  signal: AbortSignal;
  logger?: Logger;
};

export interface StreamController {
  signal: AbortSignal;
  abort: () => void;
}

/**
 * Abstract base class for cloud providers that stream events.
 * Implementations must provide initialization and streaming logic.
 * @template TEvent The type of events this provider emits
 */
export abstract class CloudProvider<TEvent> extends EventEmitter<{
  event: [TEvent];
  error: [Error];
  started: [];
  stopped: [];
}> {
  protected constructor(
    protected readonly id: string,
    protected readonly opts: CloudProviderOptions
  ) {
    super({ captureRejections: true });
    if (!id || typeof id !== 'string') {
      throw new Error('CloudProvider id must be a non-empty string');
    }
  }

  protected get logger(): Logger {
    return this.opts.logger || console;
  }

  protected get signal(): AbortSignal {
    return this.opts.signal;
  }

  /**
   * Initialize the provider. Called once before streaming begins.
   * @returns Observable that emits this provider when ready
   */
  protected abstract init(): Observable<this>;

  /**
   * Stream events from the provider.
   * @param since Whether to start from oldest or latest events
   * @param signal AbortSignal to stop streaming
   * @returns Observable of event arrays. Empty arrays will be delayed automatically.
   */
  protected abstract _stream(
    since: Since,
    signal: AbortSignal
  ): Observable<TEvent[]>;

  /**
   * Store an item to the provider's backing store.
   * @param item The item to store
   * @returns Observable that emits a matcher function when the item is successfully stored
   */
  protected abstract _store<T>(item: T): Observable<(event: TEvent) => boolean>;

  /**
   * Start streaming events from this provider.
   * @param since Whether to start from oldest or latest events
   * @returns Controller to stop the stream
   */
  public stream(since: Since): StreamController {
    const abort = new AbortController();
    let isAborted = false;
    let isStarted = false;

    const subscription = this._stream(since, abort.signal)
      .pipe(
        takeUntil(fromEvent(abort.signal, 'abort')),
        // Delay empty arrays to avoid tight polling loops
        delayWhen((events) => (events.length === 0 ? timer(100) : of(events))),
        tap(() => {
          if (!isStarted) {
            isStarted = true;
            this.emit('started');
          }
        }),
        filter((events) => events.length > 0),
        concatAll()
      )
      .subscribe({
        next: (event) => {
          if (!isAborted) {
            this.emit('event', event);
          }
        },
        error: (error) => {
          isAborted = true;
          if (!abort.signal.aborted) {
            this.emit('error', error);
          }
        },
        complete: () => {
          isAborted = true;
          if (!abort.signal.aborted) {
            this.emit('stopped');
          }
        },
      });

    return {
      signal: abort.signal,
      abort: (): void => {
        isAborted = true;
        abort.abort();
        subscription.unsubscribe();
      },
    };
  }

  /**
   * Store an item and wait for it to appear in the stream.
   * @param item The item to store
   * @returns Observable that emits the item when it appears in the stream
   */
  public store<T>(item: T): Observable<T> {
    this.logger.debug(`[${this.id}] Starting store() method for item:`, item);

    return new Observable<T>((subscriber) => {
      // Start streaming first
      this.logger.debug(`[${this.id}] Starting stream from 'latest'`);
      const streamController = this.stream('latest');

      // Wait for stream to start, then store item
      const started$ = fromEvent(this, 'started').pipe(
        first(),
        tap(() =>
          this.logger.debug(`[${this.id}] Stream started, now storing item`)
        ),
        switchMap(() => this._store(item))
      );

      const eventStream$ = (
        fromEvent(this, 'event') as Observable<TEvent>
      ).pipe(
        takeUntil(fromEvent(this, 'error')), // Cancel on stream error
        takeUntil(fromEvent(this, 'complete')) // Cancel if stream completes
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
          streamController.abort();
          subscriber.next(result);
          subscriber.complete();
        },
        error: (error) => {
          this.logger.error(`[${this.id}] Store operation failed:`, error);
          streamController.abort();
          subscriber.error(error);
        },
      });

      // Cleanup function
      return () => {
        streamController.abort();
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
