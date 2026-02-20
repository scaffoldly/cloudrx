/* global describe, it, beforeEach, afterEach, expect */
import { Subject, interval, of, toArray } from 'rxjs';
import { Abortable } from './abortable';

describe('Abortable', () => {
  let process: Abortable<void>;

  beforeEach(() => {
    process = Abortable.root.fork('test');
  });

  afterEach(() => {
    process.dispose();
  });

  describe('static root', () => {
    it('exists and is named root', () => {
      expect(Abortable.root).toBeDefined();
      expect(Abortable.root.name).toBe('root');
    });

    it('has a signal', () => {
      expect(Abortable.root.signal).toBeInstanceOf(AbortSignal);
    });

    it('has an aborted observable', () => {
      expect(Abortable.root.aborted).toBeDefined();
    });
  });

  describe('fork()', () => {
    it('creates a child process', () => {
      const child = process.fork('child');
      expect(child).toBeInstanceOf(Abortable);
      expect(child.name).toBe('child');
      child.dispose();
    });

    it('child appears in parent tree', () => {
      const child = process.fork('child');
      const tree = process.tree;
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0]?.name).toBe('child');
      child.dispose();
    });

    it('supports nested forking', () => {
      const child = process.fork('child');
      const grandchild = child.fork('grandchild');
      expect(process.tree.children[0]?.children[0]?.name).toBe('grandchild');
      grandchild.dispose();
      child.dispose();
    });
  });

  describe('wrap()', () => {
    it('returns an Abortable with the source type', () => {
      const source$ = of(1, 2, 3);
      const wrapped = process.wrap(source$);
      expect(wrapped).toBeInstanceOf(Abortable);
    });

    it('emits values from the source', async () => {
      const source$ = of(1, 2, 3);
      const wrapped = process.wrap(source$);
      const values: number[] = [];

      await new Promise<void>((resolve) => {
        wrapped.subscribe({
          next: (v) => values.push(v),
          complete: resolve,
        });
      });

      expect(values).toEqual([1, 2, 3]);
    });

    it('completes when process is aborted', async () => {
      const source$ = new Subject<number>();
      const wrapped = process.wrap(source$);
      const values: number[] = [];
      let completed = false;

      wrapped.subscribe({
        next: (v) => values.push(v),
        complete: () => {
          completed = true;
        },
      });

      source$.next(1);
      source$.next(2);
      process.abort();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(values).toEqual([1, 2]);
      expect(completed).toBe(true);
    });

    it('uses custom name when provided', () => {
      const source$ = of(1);
      const wrapped = process.wrap(source$, 'custom-name');
      expect(wrapped.name).toBe('custom-name');
    });

    it('uses default name when not provided', () => {
      const source$ = of(1);
      const wrapped = process.wrap(source$);
      expect(wrapped.name).toBe('test:wrapped');
    });

    it('wrapped observable appears in tree', () => {
      const source$ = of(1);
      const wrapped = process.wrap(source$, 'my-stream');
      expect(process.tree.children.some((c) => c.name === 'my-stream')).toBe(
        true
      );
      // Clean up by letting it complete
      wrapped.subscribe();
    });
  });

  describe('track()', () => {
    it('works as a pipeable operator', async () => {
      const values: number[] = [];

      await new Promise<void>((resolve) => {
        of(1, 2, 3)
          .pipe(process.track())
          .subscribe({
            next: (v) => values.push(v),
            complete: resolve,
          });
      });

      expect(values).toEqual([1, 2, 3]);
    });

    it('returns an Abortable', () => {
      const result = of(1, 2, 3).pipe(process.track());
      expect(result).toBeInstanceOf(Abortable);
    });

    it('accepts optional name', () => {
      const result = of(1).pipe(process.track('tracked')) as Abortable<number>;
      expect(result.name).toBe('tracked');
    });
  });

  describe('abort()', () => {
    it('sets signal.aborted to true', () => {
      expect(process.signal.aborted).toBe(false);
      process.abort();
      expect(process.signal.aborted).toBe(true);
    });

    it('is idempotent', () => {
      process.abort();
      expect(() => process.abort()).not.toThrow();
      expect(process.signal.aborted).toBe(true);
    });

    it('cascades to children', async () => {
      const child = process.fork('child');
      expect(child.signal.aborted).toBe(false);

      process.abort();

      // Allow async propagation
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(child.signal.aborted).toBe(true);
    });

    it('cascades to grandchildren', async () => {
      const child = process.fork('child');
      const grandchild = child.fork('grandchild');

      process.abort();

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(child.signal.aborted).toBe(true);
      expect(grandchild.signal.aborted).toBe(true);
    });

    it('emits on aborted observable', async () => {
      let abortEmitted = false;

      process.aborted.subscribe(() => {
        abortEmitted = true;
      });

      process.abort();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(abortEmitted).toBe(true);
    });
  });

  describe('dispose()', () => {
    it('aborts the process', () => {
      const child = process.fork('child');
      child.dispose();
      expect(child.signal.aborted).toBe(true);
    });

    it('removes from parent children', () => {
      const child = process.fork('child');
      expect(process.tree.children).toHaveLength(1);

      child.dispose();
      expect(process.tree.children).toHaveLength(0);
    });
  });

  describe('tree', () => {
    it('returns correct structure', () => {
      const tree = process.tree;
      expect(tree).toEqual({
        name: 'test',
        aborted: false,
        children: [],
      });
    });

    it('reflects aborted state', () => {
      process.abort();
      expect(process.tree.aborted).toBe(true);
    });

    it('includes all descendants', () => {
      const child1 = process.fork('child1');
      const child2 = process.fork('child2');
      const grandchild = child1.fork('grandchild');

      const tree = process.tree;
      expect(tree.children).toHaveLength(2);
      expect(tree.children.find((c) => c.name === 'child1')?.children).toEqual([
        { name: 'grandchild', aborted: false, children: [] },
      ]);

      grandchild.dispose();
      child1.dispose();
      child2.dispose();
    });
  });

  describe('signal inheritance', () => {
    it('wrapped observables inherit parent signal', () => {
      const wrapped = process.wrap(of(1));
      expect(wrapped.signal).toBe(process.signal);
    });

    it('wrapped observables inherit parent aborted', () => {
      const wrapped = process.wrap(of(1));
      expect(wrapped.aborted).toBe(process.aborted);
    });
  });

  describe('subscription cleanup', () => {
    it('unsubscribing from wrapped observable cleans up', () => {
      const source$ = new Subject<number>();
      const wrapped = process.wrap(source$);

      const subscription = wrapped.subscribe();
      subscription.unsubscribe();

      expect(() => source$.next(1)).not.toThrow();
    });

    it('wrapped observable completes subscribers on abort', async () => {
      const source$ = interval(10);
      const wrapped = process.wrap(source$);
      const values: number[] = [];
      let completed = false;

      wrapped.subscribe({
        next: (v) => values.push(v),
        complete: () => {
          completed = true;
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 35));
      process.abort();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(values.length).toBeGreaterThan(0);
      expect(completed).toBe(true);
    });
  });

  describe('process as observable', () => {
    it('completes when aborted', async () => {
      let completed = false;

      process.subscribe({
        complete: () => {
          completed = true;
        },
      });

      process.abort();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(completed).toBe(true);
    });

    it('can be used with toArray', async () => {
      const child = process.fork('child');

      setTimeout(() => child.abort(), 10);

      const result = await new Promise<void[]>((resolve) => {
        child.pipe(toArray()).subscribe((arr) => resolve(arr));
      });

      expect(result).toEqual([]);
    });
  });
});
