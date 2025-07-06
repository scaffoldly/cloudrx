import { of, delay, throwError, Subject, EMPTY, Observable } from 'rxjs';
import { TestScheduler } from 'rxjs/testing';
import { semaphore } from '@operators';

describe('semaphore operator', () => {
  let testScheduler: TestScheduler;

  beforeEach(() => {
    testScheduler = new TestScheduler((actual, expected) => {
      expect(actual).toEqual(expected);
    });
  });

  afterEach(() => {
    testScheduler.flush();
  });

  it('processes items with concurrency limit', async () => {
    const source$ = of(1, 2, 3, 4, 5);
    const processingOrder: number[] = [];
    const completionOrder: number[] = [];

    const project = (value: number): Observable<number> => {
      processingOrder.push(value);
      return of(value * 2).pipe(
        delay(value * 10) // Different delays to test ordering
      );
    };

    const result$ = source$.pipe(semaphore(project, 2));

    const results: number[] = [];
    await new Promise<void>((resolve) => {
      result$.subscribe({
        next: (value) => {
          results.push(value as number);
          completionOrder.push((value as number) / 2);
        },
        complete: resolve,
      });
    });

    // Should process first 2 items immediately
    expect(processingOrder.slice(0, 2)).toEqual([1, 2]);
    // Results should complete in order based on delay (item 1 finishes first)
    expect(completionOrder[0]).toBe(1);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('handles single concurrency (sequential processing)', async () => {
    const source$ = of(1, 2, 3);
    const processingOrder: number[] = [];

    const project = (value: number): Observable<number> => {
      processingOrder.push(value);
      return of(value * 2).pipe(delay(10));
    };

    const result$ = source$.pipe(semaphore(project, 1));

    const results: number[] = [];
    await new Promise<void>((resolve) => {
      result$.subscribe({
        next: (value) => results.push(value as number),
        complete: resolve,
      });
    });

    // Should process items one at a time in order
    expect(processingOrder).toEqual([1, 2, 3]);
    expect(results).toEqual([2, 4, 6]);
  });

  it('handles high concurrency efficiently', async () => {
    const source$ = of(1, 2, 3, 4, 5);
    const processingOrder: number[] = [];

    const project = (value: number): Observable<number> => {
      processingOrder.push(value);
      return of(value * 2).pipe(delay(10));
    };

    const result$ = source$.pipe(semaphore(project, 10));

    const results: number[] = [];
    await new Promise<void>((resolve) => {
      result$.subscribe({
        next: (value) => results.push(value as number),
        complete: resolve,
      });
    });

    // Should process all items immediately (within concurrency limit)
    expect(processingOrder).toEqual([1, 2, 3, 4, 5]);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('propagates errors from project function', async () => {
    const source$ = of(1, 2, 3);
    const project = (value: number): Observable<number> => {
      if (value === 2) {
        throw new Error('Project error');
      }
      return of(value * 2);
    };

    const result$ = source$.pipe(semaphore(project, 2));

    await expect(
      new Promise<void>((resolve, reject) => {
        result$.subscribe({
          next: () => {},
          error: reject,
          complete: resolve,
        });
      })
    ).rejects.toThrow('Project error');
  });

  it('propagates errors from inner observables', async () => {
    const source$ = of(1, 2, 3);
    const project = (value: number): Observable<number> => {
      if (value === 2) {
        return throwError(() => new Error('Inner error'));
      }
      return of(value * 2);
    };

    const result$ = source$.pipe(semaphore(project, 2));

    await expect(
      new Promise<void>((resolve, reject) => {
        result$.subscribe({
          next: () => {},
          error: reject,
          complete: resolve,
        });
      })
    ).rejects.toThrow('Inner error');
  });

  it('handles empty source observable', async () => {
    const source$ = EMPTY;
    const project = (value: number): Observable<number> => of(value * 2);

    const result$ = source$.pipe(semaphore(project, 2));

    const results: number[] = [];
    await new Promise<void>((resolve) => {
      result$.subscribe({
        next: (value) => results.push(value as number),
        complete: resolve,
      });
    });

    expect(results).toEqual([]);
  });

  it('handles project function returning promises', async () => {
    const source$ = of(1, 2, 3);
    const project = (value: number): Promise<number> => {
      return Promise.resolve(value * 2);
    };

    const result$ = source$.pipe(semaphore(project, 2));

    const results: number[] = [];
    await new Promise<void>((resolve) => {
      result$.subscribe({
        next: (value) => results.push(value as number),
        complete: resolve,
      });
    });

    expect(results).toEqual([2, 4, 6]);
  });

  it('handles project function returning arrays', async () => {
    const source$ = of(1, 2);
    const project = (value: number): number[] => {
      return [value * 2, value * 3]; // Returns multiple values
    };

    const result$ = source$.pipe(semaphore(project, 2));

    const results: number[] = [];
    await new Promise<void>((resolve) => {
      result$.subscribe({
        next: (value) => results.push(value as number),
        complete: resolve,
      });
    });

    expect(results).toEqual([2, 3, 4, 6]);
  });

  it('maintains index parameter accuracy', async () => {
    const source$ = of('a', 'b', 'c');
    const indices: number[] = [];

    const project = (value: string, index: number): Observable<string> => {
      indices.push(index);
      return of(`${value}-${index}`);
    };

    const result$ = source$.pipe(semaphore(project, 2));

    const results: string[] = [];
    await new Promise<void>((resolve) => {
      result$.subscribe({
        next: (value) => results.push(value as string),
        complete: resolve,
      });
    });

    expect(indices).toEqual([0, 1, 2]);
    expect(results).toEqual(['a-0', 'b-1', 'c-2']);
  });

  it('handles hot observables properly', async () => {
    const source$ = new Subject<number>();
    const processingOrder: number[] = [];

    const project = (value: number): Observable<number> => {
      processingOrder.push(value);
      return of(value * 2).pipe(delay(10));
    };

    const result$ = source$.pipe(semaphore(project, 2));

    const results: number[] = [];
    const subscription = result$.subscribe({
      next: (value) => results.push(value as number),
    });

    // Emit values to hot observable
    source$.next(1);
    source$.next(2);
    source$.next(3);
    source$.complete();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(processingOrder).toEqual([1, 2, 3]);
    expect(results).toEqual([2, 4, 6]);
    subscription.unsubscribe();
  });

  it('properly cleans up subscriptions on unsubscribe', () => {
    const source$ = new Subject<number>();
    const project = (value: number): Observable<number> =>
      of(value * 2).pipe(delay(100));

    const result$ = source$.pipe(semaphore(project, 2));

    const subscription = result$.subscribe();

    // Emit some values
    source$.next(1);
    source$.next(2);

    // Unsubscribe before completion
    subscription.unsubscribe();

    // Should not throw or cause memory leaks
    expect(() => {
      source$.next(3);
      source$.complete();
    }).not.toThrow();
  });

  it('handles zero concurrency gracefully', async () => {
    const source$ = of(1, 2, 3);
    const project = (value: number): Observable<number> => of(value * 2);

    const result$ = source$.pipe(semaphore(project, 0));

    const results: number[] = [];
    await new Promise<void>((resolve) => {
      const subscription = result$.subscribe({
        next: (value) => results.push(value as number),
        complete: resolve,
      });

      // Should complete immediately with no results
      setTimeout(() => {
        subscription.unsubscribe();
        resolve();
      }, 100);
    });

    expect(results).toEqual([]);
  });
});
