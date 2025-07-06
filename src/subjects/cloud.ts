import { persistReplay } from '@operators';
import { ICloudProvider } from '@providers';
import {
  Observable,
  Observer,
  Subject,
  Subscribable,
  Subscription,
  Unsubscribable,
} from 'rxjs';

export class CloudSubject<T> implements Subscribable<T>, Unsubscribable {
  private inner = new Subject<T>();
  private persisted: Observable<T>;

  constructor(private provider: Observable<ICloudProvider<unknown, unknown>>) {
    this.persisted = this.inner.pipe(persistReplay(this.provider));
  }

  subscribe(observer: Partial<Observer<T>>): Subscription {
    return this.persisted.subscribe(observer);
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

  unsubscribe(): void {
    this.inner.complete();
  }
}
