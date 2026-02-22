import {
  Observable,
  Observer,
  BehaviorSubject as _BehaviorSubject,
  Subscription,
  of,
} from 'rxjs';
import { map } from 'rxjs/operators';
import { Controller, ControllerEvent, ControllerKey } from '../controllers';
import { fromEvent } from '../observables';

/**
 * Drop-in RxJS BehaviorSubject replacement with optional Controller wiring.
 *
 * Without a controller, behaves identically to an RxJS BehaviorSubject.
 * When wired via {@link withController}:
 *
 * - {@link next} routes values through `controller.put()` (writes to the data source)
 * - {@link subscribe} receives events from `fromEvent(controller, 'modified')`
 * - {@link getValue} throws when wired (value is async); use {@link getValue$} instead
 * - {@link getValue$} fetches the current value from the controller via `controller.get()`
 *
 * @typeParam T - The value type emitted by the subject
 */
export class BehaviorSubject<T> extends _BehaviorSubject<T> {
  /** Bound put function from the wired controller */
  private controllerPut?: (value: T) => Observable<void>;

  /** Bound get function from the wired controller */
  private controllerGet?: () => Observable<T | undefined>;

  /** Observable sourced from controller 'modified' events, mapped to values */
  private controllerSource$?: Observable<T>;

  constructor(initialValue: T) {
    super(initialValue);
  }

  /**
   * Wire this subject to a Controller.
   *
   * Once wired, {@link next} delegates to `controller.put()`,
   * {@link subscribe} reads from the controller's `modified` event stream,
   * and {@link getValue$} fetches the current value via `controller.get()`.
   *
   * @param controller The controller to bridge
   * @param key The key identifying the record for `getValue$()`
   * @returns `this` for chaining
   */
  public withController<E extends ControllerEvent>(
    controller: Controller<E>,
    key: E['key']
  ): this {
    this.controllerPut = (v: T): Observable<void> => controller.put(v as never);
    this.controllerGet = (): Observable<T | undefined> =>
      controller.get(key as ControllerKey) as Observable<T | undefined>;
    this.controllerSource$ = fromEvent(controller, 'modified').pipe(
      map((e) => e.value as T)
    );
    return this;
  }

  /**
   * Emit a value. If wired to a controller, writes via `controller.put()`;
   * otherwise emits directly to subscribers.
   */
  override next(value: T): void {
    if (this.controllerPut) {
      this.controllerPut(value).subscribe();
    } else {
      super.next(value);
    }
  }

  /**
   * Subscribe to values. If wired to a controller, subscribes to the
   * controller's `modified` event stream; otherwise behaves like a
   * normal RxJS BehaviorSubject subscription.
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
    if (this.controllerSource$) {
      return this.controllerSource$.subscribe(observer);
    }
    return super.subscribe(observer);
  }

  /**
   * Synchronous getValue(). When wired to a controller, throws because
   * the current value must be fetched asynchronously. Use {@link getValue$} instead.
   */
  override getValue(): T {
    if (this.controllerGet) {
      throw new Error(
        'Cannot use getValue() on a controller-wired BehaviorSubject. Use getValue$() instead.'
      );
    }
    return super.getValue();
  }

  /**
   * Observable-based getValue. When wired to a controller, fetches the
   * current value via `controller.get(key)`. Otherwise returns the
   * in-memory value via `of(super.getValue())`.
   */
  getValue$(): Observable<T | undefined> {
    if (this.controllerGet) {
      return this.controllerGet();
    }
    return of(super.getValue());
  }
}
