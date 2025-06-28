import {
  Observable,
  ReplaySubject,
  fromEvent,
  interval,
  map,
  timer,
} from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CloudProvider, CloudOptions, Streamed, Matcher } from '../base';

type MemoryDelays = {
  init?: number; // Initialization delay in milliseconds
  emission?: number; // Emission delay in milliseconds
  storage?: number; // Storage delay in milliseconds
};

export type MemoryOptions = CloudOptions & {
  delays?: MemoryDelays; // Optional delays for initialization, emission, and storage
};

type Data = {
  payload: string;
};

type Record = {
  id: string;
  data: Data;
};

export class Memory extends CloudProvider<Record, Record['id']> {
  private all = new ReplaySubject<Record[]>();
  private latest = new ReplaySubject<Record[]>(1);
  private initialized = false;

  private delays: Required<MemoryDelays> = {
    init: 2000, // Default initialization delay
    emission: 1000, // Default emission delay
    storage: 25, // Default storage delay
  };

  constructor(
    id: string,
    private options?: MemoryOptions
  ) {
    super(id, options);

    this.delays = {
      init: this.options?.delays?.init ?? this.delays.init,
      emission: this.options?.delays?.emission ?? this.delays.emission,
      storage: this.options?.delays?.storage ?? this.delays.storage,
    };
  }

  protected _init(): Observable<this> {
    return new Observable<this>((subscriber) => {
      if (this.signal.aborted) {
        subscriber.error(this.options?.signal?.reason);
        return;
      }

      if (this.initialized) {
        subscriber.next(this);
        subscriber.complete();
        return;
      }

      const initialization = timer(this.delays.init)
        .pipe(
          takeUntil(fromEvent(this.signal, 'abort')),
          map(() => {
            this.initialized = true;
            subscriber.next(this);
            subscriber.complete();
          })
        )
        .subscribe();

      const emission = interval(this.delays.emission)
        .pipe(
          takeUntil(fromEvent(this.signal, 'abort')),
          map(() => {
            this.all.next([]);
            this.latest.next([]);
          })
        )
        .subscribe();

      return () => {
        initialization.unsubscribe();
        emission.unsubscribe();
      };
    });
  }

  protected _stream(all: boolean): Observable<Record[]> {
    return new Observable<Record[]>((subscriber) => {
      if (!this.initialized) {
        subscriber.error(
          new Error('Provider not initialized - call init() first')
        );
        return;
      }

      const stream = all ? this.all : this.latest;
      const subscription = stream.subscribe(subscriber);

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  protected _store<T>(item: T): Observable<(event: Record) => boolean> {
    return new Observable<Matcher<Record>>((subscriber) => {
      if (!this.initialized) {
        subscriber.error(
          new Error('Provider not initialized - call init() first')
        );
        return;
      }

      const id = crypto.randomUUID();

      const data: Data = {
        payload: JSON.stringify(item),
      };

      const record: Record = {
        id,
        data,
      };

      const emission = timer(this.delays.storage)
        .pipe(
          takeUntil(fromEvent(this.signal, 'abort')),
          map(() => {
            this.all.next([record]);
            this.latest.next([record]);
            subscriber.next((event: Record) => event.id === id);
            subscriber.complete();
          })
        )
        .subscribe();

      return () => {
        emission.unsubscribe();
      };
    });
  }

  protected _unmarshall<T>(event: Record): Streamed<T, Record['id']> {
    const marker = event.id;
    const item = JSON.parse(event.data.payload) as T;

    return {
      ...item,
      __marker__: marker,
    };
  }
}
