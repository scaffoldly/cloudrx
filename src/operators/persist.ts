import { delay, first, MonoTypeOperatorFunction, Observable, of } from 'rxjs';
import { ICloudProvider } from '@providers';

export type Persistable<T> = {
  provider: Observable<ICloudProvider<unknown, unknown>>;
  source: Observable<T>;
};

export const persist = <T>(
  provider: Observable<ICloudProvider<unknown, unknown> | undefined>
): MonoTypeOperatorFunction<T> => {
  return (source: Observable<T>): Observable<T> => {
    return new Observable<T>((subscriber) => {
      const buffer: T[] = [];
      let providerReady = false;
      let sourceComplete = false;
      let currentProvider: ICloudProvider<unknown, unknown> | undefined;

      // Subscribe to provider
      const providerSub = provider.pipe(first()).subscribe({
        next: (providerInstance) => {
          currentProvider = providerInstance;
          providerReady = true;
          processBuffer();
        },
        error: (error) => subscriber.error(error),
      });

      // Subscribe to source
      const sourceSub = source.subscribe({
        next: (value) => {
          if (providerReady) {
            processValue(value);
          } else {
            buffer.push(value);
          }
        },
        error: (error) => subscriber.error(error),
        complete: () => {
          sourceComplete = true;
          if (providerReady && buffer.length === 0) {
            subscriber.complete();
          }
        },
      });

      function processBuffer(): void {
        if (buffer.length > 0) {
          const values = [...buffer];
          buffer.length = 0;
          processValues(values);
        } else if (sourceComplete) {
          subscriber.complete();
        }
      }

      function processValues(values: T[]): void {
        if (values.length === 0) return;

        const value = values[0];
        if (value === undefined) return;
        const remaining = values.slice(1);

        processValue(value, () => {
          if (remaining.length > 0) {
            processValues(remaining);
          } else if (sourceComplete) {
            subscriber.complete();
          }
        });
      }

      function processValue(value: T, onComplete?: () => void): void {
        if (!currentProvider) {
          // No provider - just delay and emit
          of(value)
            .pipe(delay(1000))
            .subscribe({
              next: (data) => subscriber.next(data),
              error: (error) => subscriber.error(error),
              complete: onComplete || ((): void => {}),
            });
        } else {
          // Use provider to store
          currentProvider.store(value).subscribe({
            next: (data) => subscriber.next(data),
            error: (error) => subscriber.error(error),
            complete: () => {
              if (onComplete) {
                onComplete();
              }
            },
          });
        }
      }

      return () => {
        providerSub.unsubscribe();
        sourceSub.unsubscribe();
      };
    });
  };
};
