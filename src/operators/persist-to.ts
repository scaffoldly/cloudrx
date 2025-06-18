import { ObservableInput, OperatorFunction } from 'rxjs';
import { ICloudProvider } from '../providers';

export const persistTo = <T>(
  _provider: ObservableInput<ICloudProvider<unknown>>
): OperatorFunction<T, T> => {
  throw new Error('Not implemented yet');
};
