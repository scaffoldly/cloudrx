import { first, mergeMap, Observable, OperatorFunction, switchMap } from 'rxjs';
import { ICloudProvider, StreamController } from '../providers';

export type Persistable<T> = {
  provider: Observable<ICloudProvider<unknown>>;
  source: Observable<T>;
  stream?: Observable<StreamController>;
};

export const persistWith = <T>(
  provider: Observable<ICloudProvider<unknown>>,
  all?: boolean
): OperatorFunction<T, T> => {
  return (source: Observable<T>): Observable<T> => {
    return source.pipe(persistFrom(provider, all), persistTo());
  };
};

export const persistTo = <T>(): OperatorFunction<Persistable<T>, T> => {
  return (persistable: Observable<Persistable<T>>): Observable<T> => {
    return persistable.pipe(
      mergeMap((persistable) => {
        const provider$ = persistable.provider.pipe(first());

        const stream$ =
          persistable.stream ||
          provider$.pipe(switchMap((provider) => provider.stream()));

        return persistable.source.pipe(
          mergeMap((value) =>
            provider$.pipe(
              mergeMap((provider) => provider.store(value, stream$))
            )
          )
        );
      })
    );
  };
};

export const persistFrom = <T>(
  provider: Observable<ICloudProvider<unknown>>,
  all?: boolean
): OperatorFunction<T, Persistable<T>> => {
  return (source: Observable<T>): Observable<Persistable<T>> => {
    return source.pipe(
      mergeMap((value) => {
        return new Observable<Persistable<T>>((subscriber) => {
          // Create a fresh stream for each persistable to avoid sharing
          const provider$ = provider.pipe(first());
          const stream$ = provider$.pipe(
            switchMap((providerInstance) => providerInstance.stream(all))
          );

          subscriber.next({
            provider,
            source: new Observable<T>((sourceSubscriber) => {
              sourceSubscriber.next(value);
              sourceSubscriber.complete();
            }),
            stream: stream$,
          });
          subscriber.complete();
        });
      })
    );
  };
};
