import { EventEmitter } from 'stream';
import { persist } from '../operators';
import { Expireable, ICloudProvider } from '../providers';
import {
  first,
  map,
  Observable,
  ReplaySubject,
  Subject,
  Subscription,
  switchMap,
} from 'rxjs';

export class CloudReplaySubject<T> extends ReplaySubject<T> {
  private inner = new Subject<T>();
  private emitter = new EventEmitter<{ expired: [T] }>();

  private persist: Subscription;
  private stream: Subscription;
  private expired: Subscription;

  constructor(private provider: Observable<ICloudProvider<unknown, unknown>>) {
    super();

    this.persist = this.inner.pipe(persist(this.provider)).subscribe({
      error: (err) => this.error(err),
      complete: () => this.complete(),
    });

    this.stream = this.provider
      .pipe(
        first(),
        switchMap((provider) =>
          // TODO make 'all' configurable
          provider
            .stream(true)
            .pipe(map((event) => provider.unmarshall<T>(event)))
        )
      )
      .subscribe({
        next: (value) => super.next(value),
        error: (err) => this.error(err),
        complete: () => this.complete(),
      });

    this.expired = this.provider
      .pipe(
        first(),
        switchMap((provider) => provider.expired<T>())
      )
      .subscribe({
        next: (value) => this.emitter.emit('expired', value),
        error: (err) => this.error(err),
        complete: () => {},
      });
  }

  public snapshot(): Observable<T[]> {
    return this.provider.pipe(
      first(),
      switchMap((provider) => provider.snapshot<T>())
    );
  }

  override next(value: T | Expireable<T>): void {
    this.inner.next(value);
  }

  override error(err: unknown): void {
    this.persist.unsubscribe();
    this.stream.unsubscribe();
    this.expired.unsubscribe();
    this.removeAllListeners('expired');
    this.inner.error(err);
    super.error(err);
  }

  override complete(): void {
    this.persist.unsubscribe();
    this.stream.unsubscribe();
    this.expired.unsubscribe();
    this.removeAllListeners('expired');
    this.inner.complete();
    super.complete();
  }

  override unsubscribe(): void {
    this.persist.unsubscribe();
    this.stream.unsubscribe();
    this.expired.unsubscribe();
    this.removeAllListeners('expired');
    this.inner.unsubscribe();
    super.unsubscribe();
  }

  on(event: 'expired', listener: (value: T) => void): this {
    this.emitter.on(event, listener as (...args: [T]) => void);
    return this;
  }

  off(event: 'expired', listener: (value: T) => void): this {
    this.emitter.off(event, listener as (...args: [T]) => void);
    return this;
  }

  removeAllListeners(event: 'expired'): this {
    this.emitter.removeAllListeners(event);
    return this;
  }
}
