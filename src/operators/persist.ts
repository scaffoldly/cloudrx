import { first, mergeMap, Observable, OperatorFunction } from 'rxjs';
import { ICloudProvider } from '../providers';

export const persistTo = <T>(
  provider: Observable<ICloudProvider<unknown>>
): OperatorFunction<T, T> => {
  return (source: Observable<T>): Observable<T> => {
    return source.pipe(
      mergeMap((value) =>
        provider.pipe(
          first(),
          mergeMap((providerInstance) => {
            // Create a stream controller for this persist operation
            const streamController$ = providerInstance.stream();
            return providerInstance.store(value, streamController$);
          })
        )
      )
    );
  };
};
