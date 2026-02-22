import { Observable, Observer, Subject as _Subject, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { Controller, ControllerEvent } from '../controllers';
import { fromEvent } from '../observables';

/**
 * Drop-in RxJS Subject replacement with optional Controller wiring.
 *
 * Without a controller, behaves identically to an RxJS Subject.
 * When wired via {@link withController}:
 *
 * - {@link next} routes values through `controller.put()` (writes to the data source)
 * - {@link subscribe} receives events from `fromEvent(controller, 'modified')`
 *   (reads from the stream, not from `next` directly)
 *
 * @typeParam T - The value type emitted by the subject
 *
 * @example
 * ```typescript
 * // Without controller — normal RxJS Subject
 * const subject = new Subject<string>();
 * subject.subscribe(v => console.log(v));
 * subject.next('hello'); // logs 'hello'
 *
 * // With controller — bridged to a data source
 * const controller = DynamoDBController.from<MyType>(table);
 * const subject = new Subject<MyType>().withController(controller);
 *
 * subject.subscribe(item => console.log('Modified:', item));
 * subject.next({ id: '1', name: 'Alice' }); // writes via controller.put()
 * ```
 */
export class Subject<T> extends _Subject<T> {
  /** Bound put function from the wired controller */
  private controllerPut?: (value: T) => Observable<void>;

  /** Observable sourced from controller 'modified' events, mapped to values */
  private controllerSource$?: Observable<T>;

  constructor() {
    super();
  }

  /**
   * Wire this subject to a Controller.
   *
   * Once wired, {@link next} delegates to `controller.put()` and
   * {@link subscribe} reads from the controller's `modified` event stream.
   *
   * @param controller The controller to bridge
   * @returns `this` for chaining
   */
  public withController<E extends ControllerEvent>(
    controller: Controller<E>
  ): this {
    this.controllerPut = (v: T): Observable<void> => controller.put(v as never);
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
   * normal RxJS Subject subscription.
   */
  override subscribe(
    observerOrNext?: Partial<Observer<T>> | ((value: T) => void) | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    error?: ((error: any) => void) | null,
    complete?: (() => void) | null
  ): Subscription {
    // Normalize overloaded args into a single observer object
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
}
