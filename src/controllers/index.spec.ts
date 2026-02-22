/* global describe, it, beforeEach, afterEach, expect, jest */
import { Observable, of, Subscription } from 'rxjs';
import { fromEvent } from '../observables/fromEvent';
import { Abortable } from '../util/abortable';
import { Controller, ControllerEvent, ControllerOptions } from './index';

type TestEvent = ControllerEvent<string, string>;

/**
 * Concrete implementation of Controller for testing base class behavior
 */
class TestController extends Controller<TestEvent> {
  public startCalled = 0;
  public stopCalled = 0;
  public onDisposeCalled = 0;

  private static instances = new Map<string, TestController>();
  private readonly _id: string;

  constructor(id: string, options: ControllerOptions = {}) {
    super(`TestController:${id}`, options);
    this._id = id;
    TestController.instances.set(id, this);
  }

  override get id(): string {
    return this._id;
  }

  protected override start(): void {
    this.startCalled++;
  }

  protected override stop(): void {
    this.stopCalled++;
  }

  protected override onDispose(): void {
    this.onDisposeCalled++;
    TestController.instances.delete(this._id);
  }

  override put(value: string & string): Observable<void> {
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

  // Expose allEvents$ for testing
  emit(event: TestEvent): void {
    this.allEvents$.next(event);
  }

  static clearInstances(): void {
    TestController.instances.clear();
  }

  static getInstance(id: string): TestController | undefined {
    return TestController.instances.get(id);
  }
}

describe('Controller', () => {
  let controller: TestController;
  let subscriptions: Subscription[];

  beforeEach(() => {
    TestController.clearInstances();
    subscriptions = [];
    controller = new TestController('test-1');
  });

  afterEach(() => {
    subscriptions.forEach((sub) => sub.unsubscribe());
    controller?.dispose();
  });

  describe('lifecycle', () => {
    it('calls start() when first listener subscribes', () => {
      expect(controller.startCalled).toBe(0);

      const sub = fromEvent(controller, 'modified').subscribe();
      subscriptions.push(sub);

      expect(controller.startCalled).toBe(1);
    });

    it('does not call start() for subsequent listeners', () => {
      const sub1 = fromEvent(controller, 'modified').subscribe();
      const sub2 = fromEvent(controller, 'modified').subscribe();
      subscriptions.push(sub1, sub2);

      expect(controller.startCalled).toBe(1);
    });

    it('calls stop() when last listener unsubscribes', () => {
      const sub1 = fromEvent(controller, 'modified').subscribe();
      const sub2 = fromEvent(controller, 'modified').subscribe();

      expect(controller.stopCalled).toBe(0);

      sub1.unsubscribe();
      expect(controller.stopCalled).toBe(0);

      sub2.unsubscribe();
      expect(controller.stopCalled).toBe(1);
    });

    it('calls start() again after stop() when new listener subscribes', () => {
      const sub1 = fromEvent(controller, 'modified').subscribe();
      sub1.unsubscribe();

      expect(controller.startCalled).toBe(1);
      expect(controller.stopCalled).toBe(1);

      const sub2 = fromEvent(controller, 'modified').subscribe();
      subscriptions.push(sub2);

      expect(controller.startCalled).toBe(2);
    });

    it('calls onDispose() exactly once on dispose()', () => {
      controller.dispose();

      expect(controller.onDisposeCalled).toBe(1);
    });

    it('dispose() is idempotent', () => {
      controller.dispose();
      controller.dispose();
      controller.dispose();

      expect(controller.onDisposeCalled).toBe(1);
      expect(controller.stopCalled).toBe(1);
    });

    it('calls stop() on dispose() even if no listeners', () => {
      controller.dispose();

      expect(controller.stopCalled).toBe(1);
    });
  });

  describe('event routing', () => {
    it('routes modified events to modified listeners', () => {
      const events: TestEvent[] = [];
      const sub = fromEvent(controller, 'modified').subscribe((e) =>
        events.push(e)
      );
      subscriptions.push(sub);

      controller.emit({ type: 'modified', key: 'k', value: 'test' });
      controller.emit({ type: 'removed', key: 'k', value: 'test' });
      controller.emit({ type: 'expired', key: 'k', value: 'test' });

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('modified');
      expect(events[0]!.value).toBe('test');
    });

    it('routes removed events to removed listeners', () => {
      const events: TestEvent[] = [];
      const sub = fromEvent(controller, 'removed').subscribe((e) =>
        events.push(e)
      );
      subscriptions.push(sub);

      controller.emit({ type: 'modified', key: 'k', value: 'test' });
      controller.emit({ type: 'removed', key: 'k', value: 'test' });
      controller.emit({ type: 'expired', key: 'k', value: 'test' });

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('removed');
      expect(events[0]!.value).toBe('test');
    });

    it('routes expired events to expired listeners', () => {
      const events: TestEvent[] = [];
      const sub = fromEvent(controller, 'expired').subscribe((e) =>
        events.push(e)
      );
      subscriptions.push(sub);

      controller.emit({ type: 'modified', key: 'k', value: 'test' });
      controller.emit({ type: 'removed', key: 'k', value: 'test' });
      controller.emit({ type: 'expired', key: 'k', value: 'test' });

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('expired');
      expect(events[0]!.value).toBe('test');
    });

    it('delivers events to multiple subscribers', () => {
      const events1: TestEvent[] = [];
      const events2: TestEvent[] = [];

      const sub1 = fromEvent(controller, 'modified').subscribe((e) =>
        events1.push(e)
      );
      const sub2 = fromEvent(controller, 'modified').subscribe((e) =>
        events2.push(e)
      );
      subscriptions.push(sub1, sub2);

      controller.emit({ type: 'modified', key: 'k', value: 'shared' });

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(events1[0]!.value).toBe('shared');
      expect(events2[0]!.value).toBe('shared');
    });

    it('supports multiple event types simultaneously', () => {
      const modified: TestEvent[] = [];
      const removed: TestEvent[] = [];
      const expired: TestEvent[] = [];

      subscriptions.push(
        fromEvent(controller, 'modified').subscribe((e) => modified.push(e)),
        fromEvent(controller, 'removed').subscribe((e) => removed.push(e)),
        fromEvent(controller, 'expired').subscribe((e) => expired.push(e))
      );

      controller.emit({ type: 'modified', key: 'k', value: 'a' });
      controller.emit({ type: 'removed', key: 'k', value: 'b' });
      controller.emit({ type: 'expired', key: 'k', value: 'c' });

      expect(modified).toHaveLength(1);
      expect(removed).toHaveLength(1);
      expect(expired).toHaveLength(1);

      expect(modified[0]!.value).toBe('a');
      expect(removed[0]!.value).toBe('b');
      expect(expired[0]!.value).toBe('c');
    });
  });

  describe('signal and track', () => {
    it('exposes AbortSignal via signal getter', () => {
      expect(controller.signal).toBeInstanceOf(AbortSignal);
      expect(controller.signal.aborted).toBe(false);
    });

    it('signal is aborted after dispose', () => {
      controller.dispose();

      expect(controller.signal.aborted).toBe(true);
    });

    it('track() wraps observable to cancel on dispose', async () => {
      const { Subject } = await import('rxjs');
      const source$ = new Subject<number>();
      const tracked$ = controller.track(source$);

      const values: number[] = [];
      let completed = false;

      tracked$.subscribe({
        next: (v) => values.push(v),
        complete: () => {
          completed = true;
        },
      });

      source$.next(1);
      source$.next(2);
      expect(values).toEqual([1, 2]);
      expect(completed).toBe(false);

      controller.dispose();

      source$.next(3);
      expect(values).toEqual([1, 2]);
      expect(completed).toBe(true);
    });
  });

  describe('abortable integration', () => {
    it('forks from Abortable.root by default', () => {
      // Controller should be in the root's tree
      const tree = Abortable.root.tree;
      const controllerNode = tree.children.find(
        (child: { name: string }) => child.name === 'TestController:test-1'
      );
      expect(controllerNode).toBeDefined();
    });

    it('forks from provided abortable', () => {
      const parent = Abortable.root.fork('parent');
      const child = new TestController('child-1', { abortable: parent });

      const tree = parent.tree;
      const childNode = tree.children.find(
        (c: { name: string }) => c.name === 'TestController:child-1'
      );
      expect(childNode).toBeDefined();

      child.dispose();
      parent.dispose();
    });

    it('disposes when parent abortable is disposed', () => {
      const parent = Abortable.root.fork('parent-dispose');
      const child = new TestController('child-dispose', { abortable: parent });

      expect(child.onDisposeCalled).toBe(0);

      parent.dispose();

      expect(child.onDisposeCalled).toBe(1);
      expect(child.signal.aborted).toBe(true);
    });

    it('cascades dispose through nested hierarchy', () => {
      const grandparent = Abortable.root.fork('grandparent');
      const parent = grandparent.fork('parent');
      const child = new TestController('nested-child', { abortable: parent });

      grandparent.dispose();

      expect(child.onDisposeCalled).toBe(1);
      expect(child.signal.aborted).toBe(true);
    });
  });

  describe('addEventListener/removeEventListener', () => {
    it('addEventListener works like fromEvent subscription', () => {
      const events: TestEvent[] = [];
      const listener = (e: TestEvent): number => events.push(e);

      controller.addEventListener('modified', listener);
      expect(controller.startCalled).toBe(1);

      controller.emit({ type: 'modified', key: 'k', value: 'via-listener' });

      expect(events).toHaveLength(1);
      expect(events[0]!.value).toBe('via-listener');
    });

    it('removeEventListener stops receiving events', async () => {
      const events: TestEvent[] = [];
      const listener = (e: TestEvent): number => events.push(e);

      controller.addEventListener('modified', listener);
      controller.emit({ type: 'modified', key: 'k', value: 'first' });

      controller.removeEventListener('modified', listener);

      // Allow async cleanup
      await new Promise((resolve) => setTimeout(resolve, 10));

      controller.emit({ type: 'modified', key: 'k', value: 'second' });

      expect(events).toHaveLength(1);
      expect(events[0]!.value).toBe('first');
    });

    it('removeEventListener calls stop() when last listener removed', async () => {
      const listener = jest.fn();

      controller.addEventListener('modified', listener);
      expect(controller.stopCalled).toBe(0);

      controller.removeEventListener('modified', listener);

      // Allow async cleanup
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(controller.stopCalled).toBe(1);
    });

    it('supports EventListenerObject interface', () => {
      const events: TestEvent[] = [];
      const listenerObj = {
        handleEvent: (e: TestEvent): number => events.push(e),
      };

      controller.addEventListener('modified', listenerObj);
      controller.emit({ type: 'modified', key: 'k', value: 'object-listener' });

      expect(events).toHaveLength(1);
      expect(events[0]!.value).toBe('object-listener');

      controller.removeEventListener('modified', listenerObj);
    });
  });

  describe('isAbortError', () => {
    // Create a concrete test class that exposes isAbortError
    class ExposedController extends TestController {
      testIsAbortError(error: unknown): boolean {
        return this.isAbortError(error);
      }
    }

    it('returns true for AbortError', () => {
      const ctrl = new ExposedController('abort-test');
      const abortError = new DOMException('Aborted', 'AbortError');

      expect(ctrl.testIsAbortError(abortError)).toBe(true);

      ctrl.dispose();
    });

    it('returns false for other errors', () => {
      const ctrl = new ExposedController('abort-test-2');

      expect(ctrl.testIsAbortError(new Error('Regular error'))).toBe(false);
      expect(ctrl.testIsAbortError(new TypeError('Type error'))).toBe(false);
      expect(ctrl.testIsAbortError({ name: 'SomeOtherError' })).toBe(false);

      ctrl.dispose();
    });

    it('returns false for non-objects', () => {
      const ctrl = new ExposedController('abort-test-3');

      expect(ctrl.testIsAbortError(null)).toBe(false);
      expect(ctrl.testIsAbortError(undefined)).toBe(false);
      expect(ctrl.testIsAbortError('string')).toBe(false);
      expect(ctrl.testIsAbortError(123)).toBe(false);

      ctrl.dispose();
    });
  });
});
