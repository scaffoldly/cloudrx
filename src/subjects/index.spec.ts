/* global describe, it, beforeEach, afterEach, expect */
import { Observable, of } from 'rxjs';
import { Controller, ControllerEvent, ControllerOptions } from '../controllers';
import { Subject } from './index';

type TestEvent = ControllerEvent<string, string>;

class TestController extends Controller<TestEvent> {
  public putCalls: string[] = [];
  private readonly _id: string;

  constructor(id: string, options: ControllerOptions = {}) {
    super(`TestController:${id}`, options);
    this._id = id;
  }

  override get id(): string {
    return this._id;
  }

  protected override start(): void {}
  protected override stop(): void {}
  protected override onDispose(): void {}

  override put(value: string & string): Observable<void> {
    this.putCalls.push(value);
    this.allEvents$.next({ type: 'modified', key: value, value });
    return of(undefined as void);
  }

  override remove(key: string): Observable<void> {
    this.allEvents$.next({ type: 'removed', key, value: key });
    return of(undefined as void);
  }

  override get(_key: string): Observable<string | undefined> {
    return of(undefined);
  }

  emit(event: TestEvent): void {
    this.allEvents$.next(event);
  }
}

describe('Subject', () => {
  describe('without controller', () => {
    it('behaves like a normal RxJS Subject', () => {
      const subject = new Subject<string>();
      const values: string[] = [];

      subject.subscribe((v) => values.push(v));
      subject.next('a');
      subject.next('b');

      expect(values).toEqual(['a', 'b']);
    });

    it('supports observer objects', () => {
      const subject = new Subject<number>();
      const values: number[] = [];
      let completed = false;

      subject.subscribe({
        next: (v) => values.push(v),
        complete: () => {
          completed = true;
        },
      });

      subject.next(1);
      subject.next(2);
      subject.complete();

      expect(values).toEqual([1, 2]);
      expect(completed).toBe(true);
    });
  });

  describe('with controller', () => {
    let controller: TestController;

    beforeEach(() => {
      controller = new TestController('subject-test');
    });

    afterEach(() => {
      controller.dispose();
    });

    it('withController returns this for chaining', () => {
      const subject = new Subject<string>();
      const result = subject.withController(controller);

      expect(result).toBe(subject);
    });

    it('next() calls controller.put() and subscribes the returned Observable', () => {
      const subject = new Subject<string>();
      subject.withController(controller);

      // Need at least one subscriber on the controller for events to flow
      subject.subscribe();

      subject.next('hello');

      expect(controller.putCalls).toEqual(['hello']);
    });

    it('subscribe() delegates to fromEvent stream', () => {
      const subject = new Subject<string>();
      subject.withController(controller);

      const values: string[] = [];
      subject.subscribe((v) => values.push(v));

      // Emit through the controller (simulates data source events)
      controller.emit({ type: 'modified', key: 'k', value: 'from-controller' });

      expect(values).toEqual(['from-controller']);
    });

    it('subscribe() does not receive super.next() emissions', () => {
      const subject = new Subject<string>();
      subject.withController(controller);

      const values: string[] = [];
      subject.subscribe((v) => values.push(v));

      // Call super.next directly - subscriber should not see it
      // because subscribe delegates to controllerSource$
      Object.getPrototypeOf(Object.getPrototypeOf(subject)).next.call(
        subject,
        'direct'
      );

      expect(values).toEqual([]);
    });

    it('next() triggers controller event that flows to subscribers', () => {
      const subject = new Subject<string>();
      subject.withController(controller);

      const values: string[] = [];
      subject.subscribe((v) => values.push(v));

      subject.next('round-trip');

      expect(controller.putCalls).toEqual(['round-trip']);
      expect(values).toEqual(['round-trip']);
    });
  });
});
