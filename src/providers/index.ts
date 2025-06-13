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
  protected constructor(protected readonly id: string) {
    super({ captureRejections: true });
    if (!id || typeof id !== 'string') {
      throw new Error('CloudProvider id must be a non-empty string');
    }
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
