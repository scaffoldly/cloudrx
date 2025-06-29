import {
  delay,
  first,
  MonoTypeOperatorFunction,
  Observable,
  of,
  Subscription,
} from 'rxjs';
import { ICloudProvider } from '@providers';

export const persist = <T>(
  provider?: Observable<ICloudProvider<unknown, unknown>>,
  onProvider?: (provider?: ICloudProvider<unknown, unknown>) => void
): MonoTypeOperatorFunction<T> => {
  return (source: Observable<T>): Observable<T> => {
    return new Observable<T>((subscriber) => {
      const state = {
        buffer: [] as T[],
        ready: false,
        complete: false,
        provider: undefined as ICloudProvider<unknown, unknown> | undefined,
      };

      const storeValue = (value: T): Observable<T> => {
        if (!state.provider) {
          return of(value).pipe(delay(1000));
        }
        return state.provider.store(value);
      };

      const checkCompletion = (): void => {
        if (state.complete && state.buffer.length === 0) {
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
        provider: ICloudProvider<unknown, unknown> | undefined
      ): void => {
        state.provider = provider;
        state.ready = true;
        onProvider?.(provider);
        processBufferedValues();
      };

      const handleSourceValue = (value: T): void => {
        if (state.ready) {
          storeValue(value).subscribe({
            next: (data) => subscriber.next(data),
            error: (error) => subscriber.error(error),
          });
        } else {
          state.buffer.push(value);
        }
      };

      const handleSourceComplete = (): void => {
        state.complete = true;
        if (state.ready && state.buffer.length === 0) {
          subscriber.complete();
        }
      };

      // Subscribe to provider
      const providerSub = provider
        ? provider.pipe(first()).subscribe({
            next: handleProviderReady,
            error: (error) => subscriber.error(error),
          })
        : (handleProviderReady(undefined), undefined);

      // Subscribe to source
      const sourceSub = source.subscribe({
        next: handleSourceValue,
        error: (error) => subscriber.error(error),
        complete: handleSourceComplete,
      });

      return () => {
        providerSub?.unsubscribe();
        sourceSub.unsubscribe();
      };
    });
  };
};

export const persistReplay = <T>(
  provider?: Observable<ICloudProvider<unknown, unknown>>
): MonoTypeOperatorFunction<T> => {
  return (source: Observable<T>): Observable<T> => {
    return new Observable<T>((subscriber) => {
      let historicalSub: Subscription | undefined;

      // Use persist with inline onProvider callback to handle both live data and historical replay
      const persistSub = source
        .pipe(
          persist(provider, (p?: ICloudProvider<unknown, unknown>) => {
            // Provider supports replay - emit historical data first
            historicalSub = p?.all().subscribe({
              next: (historicalEvent: unknown) => {
                const unmarshalled = p.unmarshall<T>(historicalEvent);
                delete unmarshalled.__marker__;
                subscriber.next(unmarshalled as T);
              },
              error: (error: unknown) => subscriber.error(error),
              complete: () => {
                // Historical data emission complete
              },
            });
          })
        )
        .subscribe(subscriber);

      return () => {
        historicalSub?.unsubscribe();
        persistSub.unsubscribe();
      };
    });
  };
};
