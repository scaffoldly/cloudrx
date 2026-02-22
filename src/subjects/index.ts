import { Observable, Observer, Subject as _Subject, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { Controller, ControllerEvent } from '../controllers';
import { fromEvent } from '../observables';

export { CloudReplaySubject } from './cloud-replay';

export class Subject<T> extends _Subject<T> {
  private controllerPut?: (value: T) => Observable<void>;
  private controllerSource$?: Observable<T>;

  constructor() {
    super();
  }

  public withController<E extends ControllerEvent>(
    controller: Controller<E>
  ): this {
    this.controllerPut = (v: T): Observable<void> => controller.put(v as never);
    this.controllerSource$ = fromEvent(controller, 'modified').pipe(
      map((e) => e.value as T)
    );
    return this;
  }

  override next(value: T): void {
    if (this.controllerPut) {
      this.controllerPut(value).subscribe();
    } else {
      super.next(value);
    }
  }

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
}
