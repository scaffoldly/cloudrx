import {
  Observable,
  ReplaySubject,
  fromEvent,
  interval,
  map,
  of,
  timer,
} from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  CloudProvider,
  Streamed,
  Matcher,
  CloudOptions,
  Expireable,
} from '../base';
import { random } from 'timeflake';

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
  private _all = new ReplaySubject<Record[]>();
  private _latest = new ReplaySubject<Record[]>(1);
  private _initialized = false;

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
      if (this._initialized) {
        this.logger.debug?.(`[${this.id}] Already initialized`);
        subscriber.next(this);
        subscriber.complete();
        return;
      }

      this.logger.debug?.(
        `[${this.id}] Starting initialization with ${this.delays.init}ms delay`
      );
      const initialization = timer(this.delays.init)
        .pipe(
          takeUntil(fromEvent(this.signal, 'abort')),
          map(() => {
            this.logger.debug?.(`[${this.id}] Initialization complete`);
            this._initialized = true;
            subscriber.next(this);
            subscriber.complete();
          })
        )
        .subscribe();

      this.logger.debug?.(
        `[${this.id}] Starting emission interval every ${this.delays.emission}ms`
      );
      const emission = interval(this.delays.emission)
        .pipe(
          takeUntil(fromEvent(this.signal, 'abort')),
          map(() => {
            this._all.next([]);
            this._latest.next([]);
          })
        )
        .subscribe();

      return () => {
        this.logger.debug?.(`[${this.id}] Init cleanup`);
        initialization.unsubscribe();
        emission.unsubscribe();
      };
    });
  }

  protected _stream(all: boolean): Observable<Record[]> {
    return new Observable<Record[]>((subscriber) => {
      if (!this._initialized) {
        this.logger.debug?.(
          `[${this.id}] Stream requested but not initialized`
        );
        subscriber.error(
          new Error('Provider not initialized - call init() first')
        );
        return;
      }

      const streamType = all ? 'all' : 'latest';
      const stream = all ? this._all : this._latest;

      const subscription = stream.subscribe({
        next: (records) => {
          this.logger.debug?.(
            `[${this.id}] ${streamType} stream emitted ${records.length} records: ${records.map((r) => r.id).join(', ')}`
          );
          subscriber.next(records);
        },
        error: (error) => {
          this.logger.debug?.(
            `[${this.id}] ${streamType} stream error:`,
            error
          );
          subscriber.error(error);
        },
        complete: () => subscriber.complete(),
      });

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  protected _snapshot<T>(): Observable<T[]> {
    // HACK: get _all._buffer directly
    const all = this._all as unknown as { _buffer: Record[][] };

    return of(
      all._buffer.reverse().flatMap((records) =>
        records.map((record) => {
          const unmarshalled = this._unmarshall(record);
          delete unmarshalled.__marker__;
          delete unmarshalled.__expires;
          return unmarshalled as T;
        })
      )
    );
  }

  protected _store<T>(
    item: Expireable<T>,
    hashFn: (value: T) => string = () => random().base62,
    matched?: (event: Record) => void
  ): Observable<(event: Record) => boolean> {
    return new Observable<Matcher<Record>>((subscriber) => {
      if (!this._initialized) {
        this.logger.debug?.(`[${this.id}] Store requested but not initialized`);
        subscriber.error(
          new Error('Provider not initialized - call init() first')
        );
        return;
      }

      const id = hashFn(item);
      this.logger.debug?.(`[${this.id}] Storing item with id ${id}:`, item);

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
            this.logger.debug?.(
              `[${this.id}] Emitting record ${id} to ReplaySubjects`
            );
            this._all.next([record]);
            this._latest.next([record]);

            const matcher = (event: Record): boolean => {
              if (event.id === id) {
                matched?.(event);
                return true;
              }
              return false;
            };
            subscriber.next(matcher);
            subscriber.complete();
          })
        )
        .subscribe();

      return () => {
        emission.unsubscribe();
      };
    });
  }

  protected _unmarshall<T>(
    event: Record
  ): Streamed<Expireable<T>, Record['id']> {
    const marker = event.id;
    const item = JSON.parse(event.data.payload) as Expireable<T>;

    return {
      ...item,
      __marker__: marker,
    };
  }
}
