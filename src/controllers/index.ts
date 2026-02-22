import { Observable, Subject, Subscription } from 'rxjs';
import { filter, shareReplay, takeUntil } from 'rxjs/operators';
import {
  AddEventListenerOptions,
  EventListenerObject,
  EventListenerOptions,
  HasEventTargetAddRemove,
} from 'rxjs/internal/observable/fromEvent';
import { Abortable } from '../util/abortable';

/** Event classification for controller state changes */
export type EventType = 'modified' | 'removed' | 'expired';

/** Callback or object-based event listener compatible with RxJS fromEvent */
export type EventListener<E> = ((evt: E) => void) | EventListenerObject<E>;

/** @internal Tracks a listener's subscription and associated event type */
type TypedSubscription = {
  type: EventType;
  sub: Subscription;
};

/**
 * Allowed key types for controller values.
 *
 * - `string` or `number` for simple identifiers
 * - `Record<string, unknown>` for composite keys (e.g., DynamoDB hash/range)
 */
export type ControllerKey = string | number | Record<string, unknown>;

/**
 * Event emitted by a controller on state changes.
 *
 * @typeParam K - The key type (must extend {@link ControllerKey})
 * @typeParam V - The value type
 */
export type ControllerEvent<
  K extends ControllerKey = ControllerKey,
  V = unknown,
> = { type: EventType; key: K; value: V };

/**
 * Base options for all controllers
 */
export interface ControllerOptions {
  /** External Abortable to chain lifecycle */
  abortable?: Abortable<unknown>;
}

/**
 * Abstract base class for event-emitting controllers.
 *
 * Provides:
 * - Event bus with three event types: modified, removed, expired
 * - Lifecycle management via Abortable
 * - Ref-counted streaming (starts/stops based on listeners)
 * - HasEventTargetAddRemove interface for RxJS fromEvent compatibility
 *
 * Subclasses must implement:
 * - `id`: unique identifier for the controller instance
 * - `start()`: begin producing events
 * - `stop()`: stop producing events
 * - `onDispose()`: cleanup specific to the subclass
 */
export abstract class Controller<
  E extends ControllerEvent<ControllerKey, unknown> = ControllerEvent,
> implements HasEventTargetAddRemove<E>
{
  // Listener tracking for addEventListener/removeEventListener
  private subscriptions = new Map<EventListener<E>, TypedSubscription>();

  // Lifecycle management
  protected readonly abortable: Abortable<void>;

  // Event bus - single subject for all events
  protected readonly allEvents$ = new Subject<E>();

  // Filtered observables for each event type (shared)
  protected readonly modified$: Observable<E>;
  protected readonly removed$: Observable<E>;
  protected readonly expired$: Observable<E>;

  // Stream management
  protected streamSubscription: Subscription | undefined;
  protected listenerCount = 0;

  // Disposal guard
  private disposed = false;

  /**
   * Unique identifier for this controller instance (used for singleton caching)
   */
  abstract get id(): string;

  constructor(name: string, options: ControllerOptions = {}) {
    // Fork from provided abortable or Abortable.root for lifecycle
    const parent = options.abortable ?? Abortable.root;
    this.abortable = parent.fork(name);

    // Wire up disposal when abortable is aborted (e.g., parent disposed)
    this.abortable.aborted.subscribe(() => this.dispose());

    // Create filtered observables for each event type (shared across listeners)
    const shared$ = this.allEvents$.pipe(
      shareReplay({ bufferSize: 0, refCount: true })
    );
    this.modified$ = shared$.pipe(filter((e) => e.type === 'modified'));
    this.removed$ = shared$.pipe(filter((e) => e.type === 'removed'));
    this.expired$ = shared$.pipe(filter((e) => e.type === 'expired'));
  }

  /**
   * Start producing events (called when first listener subscribes).
   * May be called multiple times over the controller's lifetime as
   * listeners subscribe after periods of inactivity.
   */
  protected abstract start(): void;

  /**
   * Stop producing events (called when last listener unsubscribes).
   * May be called multiple times over the controller's lifetime.
   * The controller remains alive and cached - new listeners can
   * trigger start() again. Use onDispose() for final cleanup.
   */
  protected abstract stop(): void;

  /**
   * Subclass-specific final cleanup (called once during dispose).
   * Use this for cleanup that should only happen when the controller
   * is permanently disposed (e.g., removing from singleton cache).
   * Unlike stop(), this is called exactly once.
   */
  protected abstract onDispose(): void;

  /**
   * Subscribe to events of a specific type
   */
  protected on(type: EventType, listener: EventListener<E>): Subscription {
    const source$ = this.getObservableForType(type);

    // Increment listener count and start streaming if needed
    this.listenerCount++;
    if (this.listenerCount === 1) {
      this.start();
    }

    // Create subscription that calls the listener
    const subscription = source$
      .pipe(takeUntil(this.abortable.aborted))
      .subscribe({
        next: (event) => {
          if (typeof listener === 'function') {
            listener(event);
          } else if (listener && typeof listener.handleEvent === 'function') {
            listener.handleEvent(event);
          }
        },
      });

    return subscription;
  }

  /**
   * Unsubscribe from events
   */
  off(sub: Subscription): Observable<void> {
    return new Observable((subscriber) => {
      sub.unsubscribe();

      // Decrement listener count and stop streaming if no listeners
      this.listenerCount--;
      if (this.listenerCount === 0) {
        this.stop();
      }

      subscriber.next();
      subscriber.complete();
    });
  }

  private getObservableForType(type: EventType): Observable<E> {
    switch (type) {
      case 'modified':
        return this.modified$;
      case 'removed':
        return this.removed$;
      case 'expired':
        return this.expired$;
      default:
        throw new Error(`Unknown event type: ${type}`);
    }
  }

  addEventListener(
    type: EventType,
    listener: EventListener<E>,
    _options?: boolean | AddEventListenerOptions
  ): void {
    const sub = this.on(type, listener);
    this.subscriptions.set(listener, { sub, type });
  }

  removeEventListener(
    type: EventType,
    listener: EventListener<E>,
    _options?: EventListenerOptions | boolean
  ): void {
    const subscription = this.subscriptions.get(listener);
    if (!subscription || subscription.type !== type) return;
    this.off(subscription.sub).subscribe(() => {
      this.subscriptions.delete(listener);
    });
  }

  /**
   * Get the AbortSignal for external cancellation
   */
  get signal(): AbortSignal {
    return this.abortable.signal;
  }

  /**
   * Wrap an observable to automatically cancel on controller disposal
   */
  track<U>(source$: Observable<U>): Observable<U> {
    return this.abortable.wrap(source$);
  }

  /**
   * Dispose the controller and clean up resources
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Subclass-specific cleanup (e.g., remove from cache)
    this.onDispose();

    // Stop streaming
    this.stop();

    // Complete subjects
    this.allEvents$.complete();

    // Abort the lifecycle node
    this.abortable.dispose();
  }

  /**
   * Check if an error is an AbortError (normal cancellation)
   */
  protected isAbortError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const err = error as { name?: string };
    return err.name === 'AbortError';
  }
}

export {
  DynamoDBController,
  DynamoDBControllerOptions,
  DynamoDBEvent,
} from './aws/dynamodb';
