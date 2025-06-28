import {
  combineLatest,
  concatMap,
  delay,
  first,
  // mergeMap,
  MonoTypeOperatorFunction,
  Observable,
  of,
  // OperatorFunction,
} from 'rxjs';
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
      const subscription = combineLatest([provider.pipe(first()), source])
        .pipe(
          concatMap(([provider, value]) => {
            if (!provider) {
              return of(value).pipe(delay(1000));
            }
            return provider.store(value);
          })
        )
        .subscribe({
          next: (data) => subscriber.next(data),
          error: (error) => subscriber.error(error),
          complete: () => subscriber.complete(),
        });

      return () => {
        subscription.unsubscribe();
      };
    });
  };
};

// export const persistWith = <T>(
//   _provider: Observable<ICloudProvider<unknown>>
// ): OperatorFunction<T, T> => {
//   throw new Error('Not implemented yet');
//   // return (source: Observable<T>): Observable<T> => {
//   //   if (!all) {
//   //     // Original behavior for all=false: just persist source items
//   //     return source.pipe(persistFrom(provider, all), persistTo());
//   //   }
//   //   // For all=true: merge source persistence with shared stream listening
//   //   const provider$ = provider.pipe(first());
//   //   // Stream for persisting source items (only when source emits)
//   //   const persistedSource$ = source.pipe(
//   //     persistFrom(provider, all),
//   //     persistTo()
//   //   );
//   //   // Shared stream for listening to ALL events (starts immediately, independent of source)
//   //   const sharedStream$ = provider$.pipe(
//   //     switchMap((providerInstance) => {
//   //       if (!sharedStreams.has(providerInstance)) {
//   //         const stream = providerInstance.stream().pipe(shareReplay(1));
//   //         sharedStreams.set(providerInstance, stream);
//   //       }
//   //       // Start the stream immediately and listen for events
//   //       const streamObs = sharedStreams.get(providerInstance)!;
//   //       streamObs.subscribe(); // Ensure the stream is active
//   //       return new Observable<T>((subscriber) => {
//   //         const handleEvent = (event: any): void => {
//   //           // Extract the stored data from the DynamoDB event
//   //           if (event.dynamodb?.NewImage?.data?.M) {
//   //             try {
//   //               // Convert DynamoDB Map format to plain object
//   //               const dataMap = event.dynamodb.NewImage.data.M;
//   //               const data: any = {};
//   //               for (const [key, value] of Object.entries(dataMap)) {
//   //                 const typedValue = value as any;
//   //                 if (typedValue.S !== undefined) {
//   //                   data[key] = typedValue.S;
//   //                 } else if (typedValue.N !== undefined) {
//   //                   data[key] = parseFloat(typedValue.N);
//   //                 } else if (typedValue.BOOL !== undefined) {
//   //                   data[key] = typedValue.BOOL;
//   //                 }
//   //                 // Add more type handlers as needed
//   //               }
//   //               subscriber.next(data);
//   //             } catch (_e) {
//   //               // Ignore parse errors
//   //             }
//   //           }
//   //         };
//   //         (providerInstance as any).on('event', handleEvent);
//   //         return (): void => {
//   //           (providerInstance as any).off('event', handleEvent);
//   //         };
//   //       });
//   //     })
//   //   );
//   //   // Start both streams - persisted source (when source emits) and shared stream (always)
//   //   const combined$ = new Observable<T>((subscriber) => {
//   //     // Subscribe to shared stream for all events
//   //     const sharedSub = sharedStream$.subscribe({
//   //       next: (data) => subscriber.next(data),
//   //       error: (error) => subscriber.error(error),
//   //     });
//   //     // Subscribe to persisted source for this source's items
//   //     const persistedSub = persistedSource$.subscribe({
//   //       next: (data) => subscriber.next(data),
//   //       error: (error) => subscriber.error(error),
//   //     });
//   //     return (): void => {
//   //       sharedSub.unsubscribe();
//   //       persistedSub.unsubscribe();
//   //     };
//   //   });
//   //   return combined$;
//   // };
// };

// export const persistTo = <T>(): OperatorFunction<Persistable<T>, T> => {
//   return (persistable: Observable<Persistable<T>>): Observable<T> => {
//     return persistable.pipe(
//       mergeMap((persistable) => {
//         // Process each emission from the source observable
//         return persistable.source.pipe(
//           mergeMap((value) => {
//             // Get provider and create store operation for each value
//             return persistable.provider.pipe(
//               first(),
//               mergeMap((provider) => provider.store(value))
//             );
//           })
//         );
//       })
//     );
//   };
// };

// export const persistFrom = <T>(
//   _provider: Observable<ICloudProvider<unknown>>,
//   _all?: boolean
// ): OperatorFunction<T, Persistable<T>> => {
//   throw new Error('Not implemented yet');
//   // return (source: Observable<T>): Observable<Persistable<T>> => {
//   //   return source.pipe(
//   //     mergeMap((value) => {
//   //       return new Observable<Persistable<T>>((subscriber) => {
//   //         const provider$ = provider.pipe(first());

//   //         let stream$: Observable<StreamController>;

//   //         if (all) {
//   //           // For all=true, share the same stream across all persistWith instances
//   //           stream$ = provider$.pipe(
//   //             switchMap((providerInstance) => {
//   //               if (!sharedStreams.has(providerInstance)) {
//   //                 const sharedStream = providerInstance
//   //                   .stream(all)
//   //                   .pipe(shareReplay(1));
//   //                 sharedStreams.set(providerInstance, sharedStream);
//   //               }
//   //               return sharedStreams.get(providerInstance)!;
//   //             })
//   //           );
//   //         } else {
//   //           // Create a fresh stream for each persistable to avoid sharing
//   //           stream$ = provider$.pipe(
//   //             switchMap((providerInstance) => providerInstance.stream(all))
//   //           );
//   //         }

//   //         subscriber.next({
//   //           provider,
//   //           source: new Observable<T>((sourceSubscriber) => {
//   //             sourceSubscriber.next(value);
//   //             sourceSubscriber.complete();
//   //           }),
//   //           stream: stream$,
//   //         });
//   //         subscriber.complete();
//   //       });
//   //     })
//   //   );
//   // };
// };
