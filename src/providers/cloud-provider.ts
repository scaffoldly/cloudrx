import {
  Observable,
  TimestampProvider,
  AsyncSubject,
  from,
  of,
  defer,
  timer,
  throwError,
} from 'rxjs';
import pino from 'pino';
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
  logger?: pino.Logger;
}

export abstract class CloudProvider<T, Key extends string>
  implements TimestampProvider
{
  private timestampProvider: TimestampProvider;
  protected readySubject?: AsyncSubject<boolean> | undefined;
  protected consistency: ConsistencyLevel;
  protected logger: pino.Logger;
  private lastInitError?: Error;

  constructor(options?: CloudProviderOptions) {
    this.timestampProvider = options?.timestampProvider || {
      now: (): number => this.getDefaultTimestamp(),
    };
    this.consistency = options?.consistency || 'weak';
    this.logger = options?.logger || pino({ level: 'info' });
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
   * Calls init() if not already initialized
   */
  isReady(): Observable<boolean> {
    // If not already initialized, start initialization
    if (!this.readySubject) {
      this.readySubject = new AsyncSubject<boolean>();
      this.init().subscribe({
        next: (ready) => {
          if (this.readySubject) {
            this.readySubject.next(ready);
            this.readySubject.complete();
            if (ready) {
              this.logger.info('CloudProvider initialized successfully');
            } else {
              this.logger.warn('CloudProvider initialization returned false');
            }
          }
        },
        error: (error) => {
          this.logger.error({ error }, 'CloudProvider initialization failed');
          this.lastInitError = error;
          if (this.readySubject) {
            this.readySubject.next(false);
            this.readySubject.complete();
            // Unset readySubject so future calls to isReady() can retry
            this.readySubject = undefined;
          }
        },
      });
    }

    return this.readySubject.asObservable();
  }

  /**
   * Abstract method for initializing provider-specific readiness logic
   * Returns Observable<boolean> indicating if provider is ready
   */
  protected abstract init(): Observable<boolean>;

  /**
   * Clean up any ongoing subscriptions (useful for testing)
   */
  dispose(): void {
    if (this.readySubject && !this.readySubject.closed) {
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
  persist(streamName: string, key: Key, value: T): Observable<T> {
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
                return of(value);
              }),
              catchError((error) => {
                this.logger.error(
                  { error },
                  'CloudProvider store operation failed (none consistency)'
                );
                return throwError(() => error);
              })
            );
          } else {
            throw this.lastInitError || new Error('Provider is not ready');
          }
        }),
        catchError((error) => {
          this.logger.error(
            { error },
            'CloudProvider readiness check failed (none consistency)'
          );
          return throwError(() => error);
        })
      );
    }

    // Handle 'weak' consistency (default)
    return this.isReady().pipe(
      switchMap((ready) => {
        if (ready) {
          return this.attemptStoreAndVerify(streamName, key, value);
        } else {
          throw this.lastInitError || new Error('Provider is not ready');
        }
      }),
      // Retry once on failure with short delay
      retry({ count: 1, delay: 1000 }),
      // Overall timeout for the operation
      timeout(10000), // 10 second timeout
      catchError((error) => {
        this.logger.error(
          { error },
          'CloudProvider persist operation failed (weak consistency)'
        );
        return throwError(() => error);
      })
    );
  }

  /**
   * Internal method to attempt store and verify operation
   */
  private attemptStoreAndVerify(
    streamName: string,
    key: Key,
    value: T
  ): Observable<T> {
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
      // Step 3: Verify the value matches and return it
      switchMap((retrievedValue) => {
        if (this.valuesAreEqual(value, retrievedValue)) {
          return of(value);
        } else {
          throw new Error('Retrieved value does not match stored value');
        }
      })
    );
  }

  /**
   * Compare two values for equality using proper deep comparison
   */
  private valuesAreEqual(value1: T, value2: T): boolean {
    return this.deepEqual(value1, value2);
  }

  /**
   * Deep equality comparison that handles property order differences
   */
  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;

    if (a == null || b == null) return a === b;

    if (typeof a !== typeof b) return false;

    if (typeof a !== 'object') return a === b;

    // Handle arrays
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!this.deepEqual(a[i], b[i])) return false;
      }
      return true;
    }

    if (Array.isArray(a) || Array.isArray(b)) return false;

    // Handle objects
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;

    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;

    for (const key of aKeys) {
      if (!bKeys.includes(key)) return false;
      if (!this.deepEqual(aObj[key], bObj[key])) return false;
    }

    return true;
  }
}
