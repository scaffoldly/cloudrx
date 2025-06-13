import { _Record } from '@aws-sdk/client-dynamodb-streams';
import {
  concatAll,
  delayWhen,
  filter,
  fromEvent,
  Observable,
  of,
  takeUntil,
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
  complete: [];
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

    const subscription = this._stream(since, abort.signal)
      .pipe(
        takeUntil(fromEvent(abort.signal, 'abort')),
        // Delay empty arrays to avoid tight polling loops
        delayWhen((events) => (events.length === 0 ? timer(100) : of(events))),
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
            this.emit('complete');
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
    let streamController: StreamController | undefined;

    return new Observable<T>((subscriber) => {
      // Start streaming from latest to catch the stored item
      streamController = this.stream('latest');
      let matcher: ((event: TEvent) => boolean) | undefined;

      // Store the item
      const storeSubscription = this._store(item).subscribe({
        next: (matcherFn) => {
          // Item stored successfully, now wait for it to appear in stream
          matcher = matcherFn;
        },
        error: (error) => {
          streamController?.abort();
          subscriber.error(error);
        },
      });

      // Listen for events that match our stored item
      const eventHandler = (event: TEvent): void => {
        if (matcher && matcher(event)) {
          streamController?.abort();
          storeSubscription.unsubscribe();
          subscriber.next(item);
          subscriber.complete();
        }
      };

      const errorHandler = (error: Error): void => {
        streamController?.abort();
        storeSubscription.unsubscribe();
        subscriber.error(error);
      };

      const completeHandler = (): void => {
        streamController?.abort();
        storeSubscription.unsubscribe();
        subscriber.error(new Error('Stream completed before item appeared'));
      };

      this.on('event', eventHandler);
      this.on('error', errorHandler);
      this.on('complete', completeHandler);

      // Cleanup function
      return () => {
        this.off('event', eventHandler);
        this.off('error', errorHandler);
        this.off('complete', completeHandler);
        streamController?.abort();
        storeSubscription.unsubscribe();
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
