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
      const state = {
        buffer: [] as T[],
        isProviderReady: false,
        isSourceComplete: false,
        currentProvider: undefined as
          | ICloudProvider<unknown, unknown>
          | undefined,
      };

      const storeValue = (value: T): Observable<T> => {
        if (!state.currentProvider) {
          return of(value).pipe(delay(1000));
        }
        return state.currentProvider.store(value);
      };

      const checkCompletion = (): void => {
        if (state.isSourceComplete && state.buffer.length === 0) {
          subscriber.complete();
        }
      };

      const processBufferedValues = (): void => {
        if (state.buffer.length === 0) {
          checkCompletion();
          return;
        }

        const valuesToProcess = [...state.buffer];
        state.buffer = [];
        processValuesSequentially(valuesToProcess);
      };

      const processValuesSequentially = (values: T[]): void => {
        if (values.length === 0) {
          checkCompletion();
          return;
        }

        const [currentValue, ...remainingValues] = values;

        if (currentValue === undefined) {
          processValuesSequentially(remainingValues);
          return;
        }

        storeValue(currentValue).subscribe({
          next: (data) => subscriber.next(data),
          error: (error) => subscriber.error(error),
          complete: () => processValuesSequentially(remainingValues),
        });
      };

      const handleProviderReady = (
        providerInstance: ICloudProvider<unknown, unknown> | undefined
      ): void => {
        state.currentProvider = providerInstance;
        state.isProviderReady = true;
        processBufferedValues();
      };

      const handleSourceValue = (value: T): void => {
        if (state.isProviderReady) {
          storeValue(value).subscribe({
            next: (data) => subscriber.next(data),
            error: (error) => subscriber.error(error),
          });
        } else {
          state.buffer.push(value);
        }
      };

      const handleSourceComplete = (): void => {
        state.isSourceComplete = true;
        if (state.isProviderReady && state.buffer.length === 0) {
          subscriber.complete();
        }
      };

      // Subscribe to provider
      const providerSub = provider.pipe(first()).subscribe({
        next: handleProviderReady,
        error: (error) => subscriber.error(error),
      });

      // Subscribe to source
      const sourceSub = source.subscribe({
        next: handleSourceValue,
        error: (error) => subscriber.error(error),
        complete: handleSourceComplete,
      });

      return () => {
        providerSub.unsubscribe();
        sourceSub.unsubscribe();
      };
    });
  };
};
