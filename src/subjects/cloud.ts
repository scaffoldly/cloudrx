import { persistReplay } from '@operators';
import { ICloudProvider } from '@providers';
import {
  Observable,
  Observer,
  Subject,
  Subscription,
  SubscriptionLike,
} from 'rxjs';

export class CloudSubject<T> extends Observable<T> implements SubscriptionLike {
  closed = false;
  private inner = new Subject<T>();
  private persisted: Observable<T>;

  constructor(private provider: Observable<ICloudProvider<unknown, unknown>>) {
    super();
    this.persisted = this.inner.pipe(persistReplay(this.provider));
  }

  protected _subscribe(subscriber: Observer<T>): Subscription {
    return this.persisted.subscribe(subscriber);
  }

  unsubscribe(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.inner.unsubscribe();
    this.complete();
  }

  next(value: T): void {
    this.inner.next(value);
  }

  error(err: unknown): void {
    this.inner.error(err);
  }

  complete(): void {
    this.inner.complete();
  }
}
