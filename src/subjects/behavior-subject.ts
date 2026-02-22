import {
  BehaviorSubject as _BehaviorSubject,
  Observer,
  Subscription,
  concat,
  of,
} from 'rxjs';
import { Controller, ControllerEvent } from '../controllers';
import { Subject } from './subject';

/**
 * Drop-in RxJS BehaviorSubject replacement with optional Controller wiring.
 *
 * Without a controller, behaves identically to an RxJS BehaviorSubject.
 * When wired via {@link withController}:
 *
 * - {@link next} routes values through `controller.put()` (writes to the data source)
 * - {@link subscribe} receives events from `fromEvent(controller, 'modified')`
 * - {@link getValue} returns the cached value, kept up-to-date by an internal
 *   subscription to the controller stream (may be stale until first event arrives)
 *
 * @typeParam T - The value type emitted by the subject
 */
export class BehaviorSubject<T> extends _BehaviorSubject<T> {
  /** Internal Subject used for controller delegation (next/subscribe) */
  private readonly subject = new Subject<T>();

  /** Subscription that keeps the cached value in sync with controller events */
  private syncSub?: Subscription;

  constructor(initialValue: T) {
    super(initialValue);
  }

  /**
   * Wire this subject to a Controller.
   *
   * Once wired:
   * - {@link next} delegates to `controller.put()`
   * - {@link subscribe} reads from the controller's `modified` event stream
   * - {@link getValue} returns the last value received from the stream
   *   (initially the constructor value until the first event arrives)
   *
   * The internal sync subscription is tied to the controller's lifecycle
   * via {@link Controller.track} and is cleaned up on controller disposal.
   *
   * @param controller The controller to bridge
   * @returns `this` for chaining
   */
  public withController<E extends ControllerEvent>(
    controller: Controller<E>
  ): this {
    this.subject.withController(controller);

    // Keep the cached value updated from the controller stream.
    // Track with the controller so it's cleaned up on disposal.
    this.syncSub = controller
      .track(this.subject)
      .subscribe((value) => super.next(value));

    return this;
  }

  /**
   * Emit a value. When wired, delegates to the internal Subject
   * (which routes through `controller.put()`). Otherwise emits directly.
   */
  override next(value: T): void {
    if (this.syncSub) {
      this.subject.next(value);
    } else {
      super.next(value);
    }
  }

  /**
   * Subscribe to values. When wired, delegates to the internal Subject
   * (which reads from the controller stream). Otherwise behaves normally.
   */
  override subscribe(
    observerOrNext?: Partial<Observer<T>> | ((value: T) => void) | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    error?: ((error: any) => void) | null,
    complete?: (() => void) | null
  ): Subscription {
    const observer: Partial<Observer<T>> =
      typeof observerOrNext === 'function'
        ? {
            next: observerOrNext,
            ...(error != null && { error }),
            ...(complete != null && { complete }),
          }
        : (observerOrNext ?? {});
    if (this.syncSub) {
      // Emit the cached value first, then stream events (BehaviorSubject contract)
      return concat(of(this.getValue()), this.subject).subscribe(observer);
    }
    return super.subscribe(observer);
  }
}
