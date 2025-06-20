import { map, Observable, ObservableInput, OperatorFunction } from 'rxjs';
import { ICloudProvider } from '../providers';

export const persistTo = <T>(
  _provider$: ObservableInput<ICloudProvider<unknown>>
): OperatorFunction<T, T> => {
  return (source: Observable<T>): Observable<T> => {
    return new Observable<T>((subscriber) => {
      const subscription = source.pipe(map((input) => input)).subscribe({
        next(output) {
          subscriber.next(output);
        },
        error(err) {
          subscriber.error(err);
        },
        complete() {
          subscriber.complete();
        },
      });

      return () => {
        subscription.unsubscribe();
      };
    });
  };
};
