import {
  fromEvent,
  map,
  Observable,
  OperatorFunction,
  share,
  shareReplay,
  Subscriber,
  takeUntil,
  TeardownLogic,
} from 'rxjs';

export interface AbortableNode {
  name: string;
  aborted: boolean;
  children: AbortableNode[];
}

export class Abortable<T = void> extends Observable<T> {
  static root: Abortable<void>;

  private controller: AbortController | null = null;
  private children = new Set<Abortable<unknown>>();
  private parent: Abortable<unknown> | null = null;
  private _aborted: Observable<void> | null = null;

  get signal(): AbortSignal {
    if (this.controller) return this.controller.signal;
    if (this.parent) return this.parent.signal;
    throw new Error('No signal available');
  }

  get aborted(): Observable<void> {
    if (this._aborted) return this._aborted;
    if (this.parent) return this.parent.aborted;
    throw new Error('No aborted observable available');
  }

  // Process node constructor (internal)
  private constructor(name: string, parent?: Abortable<unknown>);
  // Wrapped observable constructor (internal)
  private constructor(
    name: string,
    parent: Abortable<unknown>,
    subscribe: (subscriber: Subscriber<T>) => TeardownLogic
  );
  private constructor(
    readonly name: string,
    parent?: Abortable<unknown>,
    subscribe?: (subscriber: Subscriber<T>) => TeardownLogic
  ) {
    super(
      subscribe ??
        ((subscriber): TeardownLogic => {
          // Defer aborted access until subscription time
          const sub = this.aborted.subscribe(() => subscriber.complete());
          return (): void => sub.unsubscribe();
        })
    );

    if (parent) {
      this.parent = parent;
      parent.children.add(this);
    }

    // Only process nodes (not wrapped observables) get their own controller
    if (!subscribe) {
      this.controller = new AbortController();
      this._aborted = fromEvent(this.controller.signal, 'abort').pipe(
        map(() => undefined),
        share(),
        shareReplay({ bufferSize: 1, refCount: true })
      );

      if (parent) {
        parent.aborted.subscribe(() => this.abort());
      }
    }
  }

  fork(name: string): Abortable<void> {
    return new Abortable(name, this);
  }

  wrap<U>(source$: Observable<U>, name?: string): Abortable<U> {
    const aborted = this.aborted;
    return new Abortable<U>(
      name ?? `${this.name}:wrapped`,
      this,
      (subscriber): TeardownLogic => {
        const sub = source$.pipe(takeUntil(aborted)).subscribe(subscriber);
        return (): void => sub.unsubscribe();
      }
    );
  }

  track<U>(name?: string): OperatorFunction<U, U> {
    return (source$): Abortable<U> => this.wrap(source$, name);
  }

  abort(): void {
    if (!this.controller || this.controller.signal.aborted) return;
    this.controller.abort();
  }

  dispose(): void {
    this.abort();
    this.parent?.children.delete(this);
  }

  get tree(): AbortableNode {
    return {
      name: this.name,
      aborted: this.controller?.signal.aborted ?? false,
      children: Array.from(this.children).map((c) => c.tree),
    };
  }
}

// Initialize static root after class definition
Abortable.root = new (Abortable as unknown as new (
  name: string
) => Abortable<void>)('root');
