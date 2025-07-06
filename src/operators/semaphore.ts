import {
  asyncScheduler,
  from,
  Observable,
  ObservableInput,
  ObservedValueOf,
  OperatorFunction,
  Subscription,
} from 'rxjs';

export function semaphore<T, O extends ObservableInput<unknown>>(
  project: (value: T, index: number) => O,
  concurrent: number
): OperatorFunction<T, ObservedValueOf<O>> {
  return (source: Observable<T>) => {
    return new Observable<ObservedValueOf<O>>((subscriber) => {
      const queue: { value: T; index: number }[] = [];
      let sourceCompleted = false;
      let activeCount = 0;
      let sourceIndex = 0;
      const activeSubs: Subscription[] = [];

      const processNext = (): void => {
        // Process items up to the concurrency limit
        while (activeCount < concurrent && queue.length > 0) {
          const item = queue.shift()!;
          const { value, index } = item;
          activeCount++;

          // Start the actual work - convert ObservableInput to Observable
          let result: O;
          try {
            result = project(value, index);
          } catch (err) {
            subscriber.error(err);
            return;
          }

          const inner$ = from(result);
          const innerSub = inner$.subscribe({
            next: (result) => {
              subscriber.next(result);
            },
            error: (err) => {
              subscriber.error(err);
            },
            complete: () => {
              activeCount--;

              // Schedule next processing on asyncScheduler to ensure proper timing
              asyncScheduler.schedule(() => {
                processNext();
              });
            },
          });

          activeSubs.push(innerSub);
        }

        if (sourceCompleted && activeCount === 0 && queue.length === 0) {
          subscriber.complete();
        }
      };

      const subscription = source.subscribe({
        next: (value) => {
          queue.push({ value, index: sourceIndex++ });
          processNext();
        },
        error: (err) => subscriber.error(err),
        complete: () => {
          sourceCompleted = true;
          processNext();
        },
      });

      return () => {
        subscription.unsubscribe();
        activeSubs.forEach((sub) => sub.unsubscribe());
      };
    });
  };
}

export function mutex<T, O extends ObservableInput<unknown>>(
  project: (value: T, index: number) => O
): OperatorFunction<T, ObservedValueOf<O>> {
  return semaphore(project, 1);
}
