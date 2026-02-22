/* global describe, it, beforeEach, afterEach, expect */
import { Observable, of } from 'rxjs';
import { Controller, ControllerEvent, ControllerOptions } from '../controllers';
import { BehaviorSubject, Subject } from './index';

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

describe('BehaviorSubject', () => {
  describe('without controller', () => {
    it('emits initial value to subscriber immediately', () => {
      const subject = new BehaviorSubject<string>('initial');
      const values: string[] = [];

      subject.subscribe((v) => values.push(v));

      expect(values).toEqual(['initial']);
    });

    it('getValue() returns initial value', () => {
      const subject = new BehaviorSubject<number>(42);

      expect(subject.getValue()).toBe(42);
    });

    it('next() updates getValue() and emits to subscribers', () => {
      const subject = new BehaviorSubject<string>('first');
      const values: string[] = [];

      subject.subscribe((v) => values.push(v));
      subject.next('second');
      subject.next('third');

      expect(values).toEqual(['first', 'second', 'third']);
      expect(subject.getValue()).toBe('third');
    });

    it('late subscriber receives current value then subsequent values', () => {
      const subject = new BehaviorSubject<string>('initial');

      subject.next('updated');

      const values: string[] = [];
      subject.subscribe((v) => values.push(v));

      subject.next('latest');

      expect(values).toEqual(['updated', 'latest']);
    });
  });

  describe('with controller', () => {
    let controller: TestController;

    beforeEach(() => {
      controller = new TestController('behavior-subject-test');
    });

    afterEach(() => {
      controller.dispose();
    });

    it('withController returns this for chaining', () => {
      const subject = new BehaviorSubject<string>('init');
      const result = subject.withController(controller);

      expect(result).toBe(subject);
    });

    it('getValue() returns initial value before any events', () => {
      const subject = new BehaviorSubject<string>('initial').withController(
        controller
      );

      expect(subject.getValue()).toBe('initial');
    });

    it('getValue() updates when controller emits', () => {
      const subject = new BehaviorSubject<string>('initial').withController(
        controller
      );

      controller.emit({ type: 'modified', key: 'k', value: 'from-stream' });

      expect(subject.getValue()).toBe('from-stream');
    });

    it('next() routes through controller.put()', () => {
      const subject = new BehaviorSubject<string>('init').withController(
        controller
      );

      subject.subscribe();
      subject.next('hello');

      expect(controller.putCalls).toEqual(['hello']);
    });

    it('next() updates getValue() via controller round-trip', () => {
      const subject = new BehaviorSubject<string>('init').withController(
        controller
      );

      subject.next('updated');

      expect(subject.getValue()).toBe('updated');
    });

    it('subscribe() receives controller events', () => {
      const subject = new BehaviorSubject<string>('init').withController(
        controller
      );

      const values: string[] = [];
      subject.subscribe((v) => values.push(v));

      controller.emit({ type: 'modified', key: 'k', value: 'event-1' });
      controller.emit({ type: 'modified', key: 'k', value: 'event-2' });

      expect(values).toEqual(['init', 'event-1', 'event-2']);
    });

    it('subscribe() receives both initial-via-next and stream events in order', () => {
      const subject = new BehaviorSubject<string>('init').withController(
        controller
      );

      const values: string[] = [];
      subject.subscribe((v) => values.push(v));

      // next() goes through controller.put() which synchronously emits modified
      subject.next('from-next');
      controller.emit({ type: 'modified', key: 'k', value: 'from-stream' });

      expect(values).toEqual(['init', 'from-next', 'from-stream']);
      expect(subject.getValue()).toBe('from-stream');
    });

    it('syncSub cleans up on controller disposal', () => {
      const subject = new BehaviorSubject<string>('init').withController(
        controller
      );

      controller.emit({ type: 'modified', key: 'k', value: 'before' });
      expect(subject.getValue()).toBe('before');

      controller.dispose();

      // getValue() retains last value, no error
      expect(subject.getValue()).toBe('before');
    });
  });
});
