import { EventEmitter } from 'stream';
import { persist } from '../operators';
import { CloudProvider, Expireable, ICloudProvider } from '../providers';
import {
  first,
  ignoreElements,
  map,
  merge,
  Observable,
  of,
  ReplaySubject,
  Subscription,
  switchMap,
  tap,
} from 'rxjs';

export type SubjectEventType = 'expired';

export class CloudReplaySubject<T> extends ReplaySubject<T> {
  private buffer = new ReplaySubject<Expireable<T>>();
  private emitter = new EventEmitter<{ [K in SubjectEventType]: [T] }>();
  private subscription: Subscription;

  constructor(private provider$: Observable<ICloudProvider<unknown>>) {
    super();

    this.subscription = provider$
      .pipe(
        first(),
        switchMap((provider) => {
          const persisted = this.buffer.pipe(persist(of(provider)));
          const streamed = provider
            .stream(true)
            .pipe(map((event) => provider.unmarshall<T>(event)));
          const expired = provider
            .expired()
            .pipe(map((event) => provider.unmarshall<T>(event)));

          return merge(
            persisted.pipe(
              tap(() => {}),
              ignoreElements()
            ),
            streamed.pipe(tap((event) => super.next(event))),
            expired.pipe(
              tap((event) => this.emitter.emit('expired', event)),
              ignoreElements()
            )
          );
        })
      )
      .subscribe({
        error: (err) => this.error(err),
        complete: () => this.complete(),
      });
  }

  public snapshot(): Observable<T[]> {
    return this.provider$.pipe(
      first(),
      switchMap((provider) => provider.snapshot<T>())
    );
  }

  override next(
    value: T,
    timing?: Date | number | { emitAt?: Date; expireAt?: Date } // TODO: implement emitAt
  ): void {
    if (!timing) {
      return this.buffer.next(value as Expireable<T>);
    }

    if (typeof timing === 'number') {
      timing = new Date(timing);
      if (timing.getUTCFullYear() === 1970) {
        // convert to milliseconds: second-based granularity resolves to 1970
        timing = new Date(timing.getTime() * 1000);
      }
    }

    if (timing instanceof Date) {
      timing = { expireAt: timing };
    }

    if (timing.expireAt && !timing.emitAt) {
      return this.buffer.next({
        ...value,
        __expires: CloudProvider.TIME(timing.expireAt),
      });
    }

    if (!timing.expireAt && timing.emitAt) {
      throw new Error('emitAt not implemented');
    }

    if (timing.expireAt && timing.emitAt) {
      throw new Error('expireAt + emitAt not implemented');
    }

    throw new Error('Invalid timing provided');
  }

  override error(err: unknown): void {
    this._unsubscribe();
    this.buffer.error(err);
    super.error(err);
  }

  override complete(): void {
    this._unsubscribe();
    this.buffer.complete();
    super.complete();
  }

  override unsubscribe(): void {
    this._unsubscribe();
    this.buffer.unsubscribe();
    super.unsubscribe();
  }

  private _unsubscribe(): void {
    this.subscription.unsubscribe();
    this.emitter.removeAllListeners();
  }

  on(type: SubjectEventType, listener: (value: T) => void): this {
    this.emitter.on(type, listener);
    return this;
  }

  off(type: SubjectEventType, listener: (value: T) => void): this {
    this.emitter.off(type, listener);
    return this;
  }

  removeAllListeners(event: SubjectEventType): this {
    this.emitter.removeAllListeners(event);
    return this;
  }
}
