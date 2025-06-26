import {
  from,
  fromEvent,
  map,
  Observable,
  ReplaySubject,
  Subject,
  takeUntil,
  tap,
  timer,
  concatMap,
} from 'rxjs';
import { CloudProvider, CloudOptions, Streamed } from '../base';
import { Logger } from '@util';

export type MemoryOptions = CloudOptions & {
  /**
   * Optional latency in milliseconds for simulated operations.
   * Default is dynamic latency based on MAX_LATENCY.
   */
  latency?: number;
};

type Data = {
  payload: string;
};

type Record = {
  id: string;
  data: Data;
};

class Database {
  public static MAX_LATENCY = 100; // Reduced latency to speed up tests

  private _abort = new AbortController();
  private _records: Record[] = [];
  private _all = new ReplaySubject<Record[]>();
  private _latest = new Subject<Record[]>();
  private _latency: number | undefined;

  get all(): Observable<Record[]> {
    return this._all;
  }

  get latest(): Observable<Record[]> {
    return this._latest;
  }

  static latency(configuredLatency?: number): number {
    if (configuredLatency !== undefined) {
      return configuredLatency;
    }
    
    const min = Math.ceil(Database.MAX_LATENCY / 10);
    return Math.floor(Math.random() * (min * 2 - min + 1)) + min;
  }

  constructor(
    private id: string,
    signal: AbortSignal,
    private logger?: Logger,
    latency?: number
  ) {
    this._latency = latency;
    signal.addEventListener('abort', () => {
      this._abort.abort();
    });

    const simulation = timer(0, 50)
      .pipe(
        tap(() => {
          // Random emit empty arrays to simulate background activity
          this._latest.next([]);
          this._all.next([]);
        })
      )
      .subscribe();

    this._abort.signal.addEventListener('abort', () => {
      simulation.unsubscribe();
      this._all.complete();
      this._latest.complete();
    });
  }

  async put(record: Record): Promise<void> {
    // Simulated async writing to a database
    this.logger?.debug(`[${this.id}] Putting`, {
      record,
    });
    return new Promise((resolve) => {
      setTimeout(() => {
        this._records.push(record);
        this.logger?.debug(`[${this.id}] Put`, {
          record,
        });

        // Immediately emit to streams to prevent test timeouts
        this.logger?.debug(`[${this.id}] Streaming`, {
          record,
        });
        this._latest.next([record]);
        this._all.next([record]);

        resolve();
      }, Database.latency(this._latency));
    });
  }
}

export class Memory extends CloudProvider<Record> {
  // A simulated database
  private _database?: Database;

  get database(): Database {
    if (!this._database) {
      throw new Error('Database is not initialized. Please call init() first.');
    }
    return this._database;
  }

  constructor(id: string, options: MemoryOptions) {
    super(id, options);
  }
  
  /**
   * Get configured latency from options or undefined for dynamic latency
   */
  private get latency(): number | undefined {
    return this.options.latency;
  }

  init(signal: AbortSignal): Observable<this> {
    // Always use timer even with 0 latency to maintain async behavior
    return timer(Database.latency(this.latency)).pipe(
      takeUntil(fromEvent(signal, 'abort')),
      map(() => {
        this._database = new Database(this.id, signal, this.logger, this.latency);
        return this;
      })
    );
  }

  protected _stream(all: boolean): Observable<Record[]> {
    // Use timer to introduce latency before streaming
    return timer(Database.latency(this.latency)).pipe(
      map(() => all ? this.database.all : this.database.latest),
      // Flatten the observable-of-observable
      concatMap(obs => obs)
    );
  }

  public unmarshall<T>(event: Record): Streamed<T, string> {
    const marker = event.id;
    const item = JSON.parse(event.data.payload) as T;

    return {
      ...item,
      __marker__: marker,
    };
  }

  protected _store<T>(item: T): Observable<(event: Record) => boolean> {
    // Generate a UUID using a simpler method
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

    // For simple in-memory tests, just immediately emit the event to the stream
    const record = {
      id,
      data: { payload: JSON.stringify(item) },
    };

    this.logger.debug(`[${this.id}] Storing item with id: ${id}`);

    return from(this.database.put(record)).pipe(
      map(() => {
        return (event: Record): boolean => event.id === id;
      })
    );
  }
}
