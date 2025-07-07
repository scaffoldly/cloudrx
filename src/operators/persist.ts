import {
  delay,
  first,
  map,
  MonoTypeOperatorFunction,
  Observable,
  of,
  switchMap,
} from 'rxjs';
import { ICloudProvider } from '@providers';

export const persist = <T>(
  provider?: Observable<ICloudProvider<unknown, unknown>>
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
      const persistSub = source.pipe(persist(provider)).subscribe(subscriber);

      const replaySub = provider
        ?.pipe(
          switchMap((p) =>
            p.stream(true).pipe(
              map((event) => {
                const unmarshalled = p.unmarshall<T>(event);
                delete unmarshalled.__marker__;
                return unmarshalled as T;
              })
            )
          )
        )
        .subscribe(subscriber);

      return () => {
        persistSub.unsubscribe();
        replaySub?.unsubscribe();
      };
    });
  };
};
