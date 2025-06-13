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
import { EventEmitter } from 'stream';

export * from './aws';

export type Consistency = 'weak' | 'strong';
export type Since = 'oldest' | 'latest';

export abstract class CloudProvider<Event> extends EventEmitter<{
  event: [Event];
  error: [Error];
  complete: [];
}> {
  protected constructor(protected readonly id: string) {
    super({ captureRejections: true });
  }

  protected abstract init(): Observable<this>;
  protected abstract _stream(
    since: Since,
    signal: AbortSignal
  ): Observable<Event[]>;

  public stream(since: Since): AbortSignal {
    const abort = new AbortController();

    const subscription = this._stream(since, abort.signal)
      .pipe(
        takeUntil(fromEvent(abort.signal, 'abort')),
        delayWhen((events) => (events.length === 0 ? timer(100) : of(events))),
        filter((events) => events.length > 0),
        concatAll()
      )
      .subscribe({
        next: (event) => this.emit('event', event),
        error: (error) => {
          subscription.unsubscribe();
          if (abort.signal.aborted) return;
          this.emit('error', error);
        },
        complete: () => {
          subscription.unsubscribe();
          if (abort.signal.aborted) return;
          this.emit('complete');
        },
      });

    return abort.signal;
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
