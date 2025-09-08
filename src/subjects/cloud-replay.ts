import { EventEmitter } from 'stream';
import { persist } from '../operators';
import {
  CloudProvider,
  Expireable,
  Filter,
  ICloudProvider,
} from '../providers';
import {
  first,
  from,
  ignoreElements,
  map,
  merge,
  Observable,
  ObservableInput,
  of,
  ReplaySubject,
  shareReplay,
  Subscription,
  switchMap,
  tap,
} from 'rxjs';

export type SubjectEventType = 'expired';
export type CloudReplayOptions<T> = {
  hashFn?: (value: T) => string;
};

export class CloudReplaySubject<T> extends ReplaySubject<T> {
  private buffer = new ReplaySubject<Expireable<T>>();
  private emitter = new EventEmitter<{ [K in SubjectEventType]: [T] }>();
  private subscription: Subscription;
  private provider$: Observable<ICloudProvider<unknown>>;

  constructor(
    provider: ObservableInput<ICloudProvider<unknown>>,
    private options?: CloudReplayOptions<T>
  ) {
    super();
    this.provider$ = from(provider).pipe(first(), shareReplay(1));

    this.subscription = this.provider$
      .pipe(
        switchMap((provider) => {
          const persisted = this.buffer.pipe(
            persist(of(provider), this.options?.hashFn)
          );
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

  public snapshot(filter?: Filter<T>): Observable<T[]> {
    return this.provider$.pipe(
      switchMap((provider) => provider.snapshot<T>(filter || {}))
    );
  }

  override next(
    value: T,
    timing?: Date | number | { emitAt?: Date; expireAt?: Date } // TODO: implement emitAt
  ): void {
    if (!timing) {
      return this.buffer.next({
        ...value,
        hashFn: this.options?.hashFn,
      } as Expireable<T>);
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
        hashFn: this.options?.hashFn,
        __expires: CloudProvider.TIME(timing.expireAt),
      } as Expireable<T>);
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
