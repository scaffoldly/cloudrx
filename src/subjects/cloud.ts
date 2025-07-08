import { persist } from '../operators';
import { ICloudProvider } from '../providers';
import {
  first,
  map,
  Observable,
  ReplaySubject,
  Subject,
  Subscription,
  switchMap,
} from 'rxjs';

export class CloudSubject<T> extends ReplaySubject<T> {
  private inner = new Subject<T>();

  private persist: Subscription;
  private stream: Subscription;

  constructor(private provider: Observable<ICloudProvider<unknown, unknown>>) {
    super();

    this.persist = this.inner.pipe(persist(this.provider)).subscribe({
      error: (err) => super.error(err),
      complete: () => super.complete(),
    });

    this.stream = this.provider
      .pipe(
        first(),
        switchMap((provider) =>
          // TODO make 'all' configurable
          provider.stream(true).pipe(
            map((event) => {
              const unmarshalled = provider.unmarshall<T>(event);
              delete unmarshalled.__marker__;
              return unmarshalled as T;
            })
          )
        )
      )
      .subscribe({
        next: (value) => super.next(value),
        error: (err) => this.error(err),
        complete: () => this.complete(),
      });
  }

  public snapshot(): Observable<T[]> {
    return this.provider.pipe(
      first(),
      switchMap((provider) => provider.snapshot<T>())
    );
  }

  override next(value: T): void {
    this.inner.next(value);
  }

  override error(err: unknown): void {
    this.inner.error(err);
  }

  override complete(): void {
    this.inner.complete();
  }

  override unsubscribe(): void {
    this.persist.unsubscribe();
    this.stream.unsubscribe();
    this.inner.unsubscribe();
    super.unsubscribe();
  }
}
