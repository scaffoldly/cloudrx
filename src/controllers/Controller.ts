import { Observable, Subscription } from 'rxjs';
import {
  AddEventListenerOptions,
  EventListenerObject,
  EventListenerOptions,
  HasEventTargetAddRemove,
} from 'rxjs/internal/observable/fromEvent';

export type EventType = 'modified' | 'removed' | 'expired';
export type EventListener<E> = ((evt: E) => void) | EventListenerObject<E>;

type TypedSubscription = {
  type: EventType;
  sub: Subscription;
};

export abstract class Controller<E> implements HasEventTargetAddRemove<E> {
  private subscriptions = new Map<EventListener<E>, TypedSubscription>();

  protected abstract on(
    type: EventType,
    listener: EventListener<E>
  ): Subscription;

  abstract off(sub: Subscription): Observable<void>;

  addEventListener(
    type: EventType,
    listener: EventListener<E>,
    _options?: boolean | AddEventListenerOptions
  ): void {
    const sub = this.on(type, listener);
    this.subscriptions.set(listener, { sub, type });
  }

  removeEventListener(
    type: EventType,
    listener: EventListener<E>,
    _options?: EventListenerOptions | boolean
  ): void {
    const subscription = this.subscriptions.get(listener);
    if (!subscription || subscription.type !== type) return;
    this.off(subscription.sub).subscribe(() => {
      this.subscriptions.delete(listener);
    });
  }
}
