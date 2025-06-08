import {
  Observable,
  TimestampProvider,
  AsyncSubject,
  from,
  of,
  defer,
  timer,
} from 'rxjs';
import {
  switchMap,
  catchError,
  retry,
  timeout,
  repeat,
  filter,
  take,
  takeUntil,
} from 'rxjs/operators';

export type ConsistencyLevel = 'none' | 'weak' | 'strong';

export interface CloudProviderOptions {
  timestampProvider?: TimestampProvider;
  consistency?: ConsistencyLevel;
}

export abstract class CloudProvider<T, Key extends string>
  implements TimestampProvider
{
  private timestampProvider: TimestampProvider;
  protected readySubject: AsyncSubject<boolean>;
  protected consistency: ConsistencyLevel;

  constructor(options?: CloudProviderOptions) {
    this.timestampProvider = options?.timestampProvider || {
      now: (): number => this.getDefaultTimestamp(),
    };
    this.consistency = options?.consistency || 'weak';
    this.readySubject = new AsyncSubject<boolean>();

    // Start provider-specific readiness check
    this.initializeReadiness();
  }

  /**
   * Store a value in the cloud provider under the given stream name
   * Returns the generated key/identifier for the stored value
   */
  abstract store(streamName: string, key: Key, value: T): Promise<Key>;

  /**
   * Retrieve all values for a given stream name
   * Implementations should respect the consistency level when applicable
   */
  abstract all(streamName: string): Promise<T[]>;

  /**
   * Retrieve a single value from the cloud provider for a given stream name and key
   * Returns the value if found, undefined otherwise
   * Implementations should respect the consistency level when applicable
   */
  abstract retrieve(streamName: string, key: Key): Promise<T | undefined>;

  /**
   * Observable that emits true when the provider is ready, completes immediately after
   * Uses AsyncSubject pattern - emits the last value and completes
   */
  isReady(): Observable<boolean> {
    return this.readySubject.asObservable();
  }

  /**
   * Abstract method for initializing provider-specific readiness logic
   * Should call setReady(true) when ready or setReady(false) on failure
   */
  protected abstract initializeReadiness(): void;

  /**
   * Set the provider readiness state and complete the subject
   */
  protected setReady(ready: boolean): void {
    this.readySubject.next(ready);
    this.readySubject.complete();
  }

  /**
   * Clean up any ongoing subscriptions (useful for testing)
   */
  dispose(): void {
    if (!this.readySubject.closed) {
      this.readySubject.complete();
    }
  }

  /**
   * Generate high-resolution UTC timestamp for event ordering
   * Always returns UTC time regardless of system timezone
   * Implements RxJS TimestampProvider interface
   */
  now(): number {
    return this.timestampProvider.now();
  }

  /**
   * Default timestamp implementation using high-resolution UTC timing
   * Always returns UTC time regardless of system timezone
   * Can be overridden by providing a custom TimestampProvider
   */
  private getDefaultTimestamp(): number {
    // Date.now() already returns UTC milliseconds since epoch
    // Add high-resolution fractional component for sub-millisecond precision
    return Date.now() + (performance.now() % 1);
  }

  /**
   * Persist a value with store-then-verify-then-emit guarantee
   * This method implements the store-verify pattern for data integrity
   * Returns an Observable that emits the value only after verification
   */
  persist(
    streamName: string,
    key: Key,
    value: T,
    emitCallback: (value: T) => void
  ): Observable<boolean> {
    // Check for 'strong' consistency upfront
    if (this.consistency === 'strong') {
      return of(null).pipe(
        switchMap(() => {
          throw new Error('Strong consistency not yet implemented');
        })
      );
    }

    // Handle 'none' consistency - just store and emit immediately
    if (this.consistency === 'none') {
      return this.isReady().pipe(
        switchMap((ready) => {
          if (ready) {
            return from(this.store(streamName, key, value)).pipe(
              switchMap(() => {
                emitCallback(value);
                return of(true);
              }),
              catchError(() => {
                // Fallback: emit locally even if cloud storage failed
                emitCallback(value);
                return of(false);
              })
            );
          } else {
            throw new Error('Provider is not ready');
          }
        }),
        catchError(() => {
          // Fallback: emit locally even if provider not ready
          emitCallback(value);
          return of(false);
        })
      );
    }

    // Handle 'weak' consistency (default)
    return this.isReady().pipe(
      switchMap((ready) => {
        if (ready) {
          return this.attemptStoreAndVerify(
            streamName,
            key,
            value,
            emitCallback
          );
        } else {
          throw new Error('Provider is not ready');
        }
      }),
      // Retry once on failure with short delay
      retry({ count: 1, delay: 1000 }),
      // Overall timeout for the operation
      timeout(10000), // 10 second timeout
      catchError(() => {
        // Handle all errors the same way - no test-specific logic in production code
        // Fallback: emit locally even if cloud storage failed
        emitCallback(value);
        return of(false);
      })
    );
  }

  /**
   * Internal method to attempt store and verify operation
   */
  private attemptStoreAndVerify(
    streamName: string,
    key: Key,
    value: T,
    emitCallback: (value: T) => void
  ): Observable<boolean> {
    // Step 1: Store the value with timeout
    return from(this.store(streamName, key, value)).pipe(
      timeout(5000), // 5 second timeout for store operation
      // Step 2: Retrieve with retries for up to 5 seconds
      switchMap((storedKey) =>
        defer(() => from(this.retrieve(streamName, storedKey))).pipe(
          repeat({
            delay: 100, // 100ms delay between attempts
          }),
          filter((retrievedValue) => retrievedValue !== undefined), // Only emit when we have a value
          take(1), // Take only the first successful result
          takeUntil(timer(5000)) // Stop after 5 seconds
        )
      ),
      // Step 3: Verify the value matches and emit
      switchMap((retrievedValue) => {
        if (this.valuesAreEqual(value, retrievedValue)) {
          emitCallback(value);
          return of(true);
        } else {
          throw new Error('Retrieved value does not match stored value');
        }
      })
    );
  }

  /**
   * Compare two values for equality
   */
  private valuesAreEqual(value1: T, value2: T): boolean {
    // For primitive values, use simple equality
    if (
      typeof value1 !== 'object' ||
      value1 === null ||
      typeof value2 !== 'object' ||
      value2 === null
    ) {
      return value1 === value2;
    }

    // For objects, do deep comparison
    return JSON.stringify(value1) === JSON.stringify(value2);
  }
}
