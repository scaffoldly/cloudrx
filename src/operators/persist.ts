import {
  delay,
  first,
  map,
  MonoTypeOperatorFunction,
  Observable,
  of,
  Subscription,
  switchMap,
} from 'rxjs';
import { Expireable, ICloudProvider } from '../providers';

export const persist = <T>(
  provider?: Observable<ICloudProvider<unknown>>,
  hashFn?: (value: T) => string
): MonoTypeOperatorFunction<T> => {
  return (source: Observable<T>): Observable<T> => {
    return new Observable<T>((subscriber) => {
      const state = {
        buffer: [] as T[],
        ready: false,
        complete: false,
        disposed: false,
        provider: undefined as ICloudProvider<unknown> | undefined,
      };
      // Track all store subscriptions for cleanup
      const storeSubscriptions: Subscription[] = [];

      const storeValue = (value: T): Observable<T> => {
        if (!state.provider) {
          return of(value).pipe(delay(1000));
        }
        return state.provider.store({ ...value, hashFn } as Expireable<T>);
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
        if (state.disposed || values.length === 0) {
          checkCompletion();
          return;
        }

        const [currentValue, ...remainingValues] = values;

        if (currentValue === undefined) {
          processValuesSequentially(remainingValues);
          return;
        }

        const sub = storeValue(currentValue).subscribe({
          next: (data) => {
            if (!state.disposed) {
              subscriber.next(data);
            }
          },
          error: (error) => {
            if (!state.disposed) {
              subscriber.error(error);
            }
          },
          complete: () => processValuesSequentially(remainingValues),
        });
        storeSubscriptions.push(sub);
      };

      const handleProviderReady = (
        provider: ICloudProvider<unknown> | undefined
      ): void => {
        state.provider = provider;
        state.ready = true;
        processBufferedValues();
      };

      const handleSourceValue = (value: T): void => {
        if (state.disposed) {
          return;
        }
        if (state.ready) {
          const sub = storeValue(value).subscribe({
            next: (data) => {
              if (!state.disposed) {
                subscriber.next(data);
              }
            },
            error: (error) => {
              if (!state.disposed) {
                subscriber.error(error);
              }
            },
          });
          storeSubscriptions.push(sub);
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
        state.disposed = true;
        providerSub?.unsubscribe();
        sourceSub.unsubscribe();
        // Clean up all in-flight store subscriptions
        storeSubscriptions.forEach((sub) => sub.unsubscribe());
        storeSubscriptions.length = 0;
      };
    });
  };
};

export const persistReplay = <T>(
  provider?: Observable<ICloudProvider<unknown>>
): MonoTypeOperatorFunction<T> => {
  return (source: Observable<T>): Observable<T> => {
    return new Observable<T>((subscriber) => {
      const persistSub = source.pipe(persist(provider)).subscribe(subscriber);

      const replaySub = provider
        ?.pipe(
          switchMap((p) =>
            p.stream(true).pipe(map((event) => p.unmarshall<T>(event)))
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
