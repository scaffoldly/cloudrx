import {
  delay,
  from,
  fromEvent,
  map,
  Observable,
  ReplaySubject,
  Subject,
  takeUntil,
  tap,
  timer,
} from 'rxjs';
import { CloudProvider, CloudOptions, Streamed } from '../base';
import { Logger } from '@util';

export type MemoryOptions = CloudOptions & {};

type Data = {
  payload: string;
};

type Record = {
  id: string;
  data: Data;
};

class Database {
  public static MAX_LATENCY = 1000;

  private _abort = new AbortController();
  private _records: Record[] = [];
  private _all = new ReplaySubject<Record[]>();
  private _latest = new Subject<Record[]>();

  get all(): Observable<Record[]> {
    return this._all.pipe(delay(Database.latency()));
  }

  get latest(): Observable<Record[]> {
    return this._latest.pipe(delay(Database.latency()));
  }

  static latency(): number {
    const min = Math.ceil(Database.MAX_LATENCY / 10);
    return Math.floor(Math.random() * (min * 2 - min + 1)) + min;
  }

  constructor(
    private id: string,
    signal: AbortSignal,
    private logger?: Logger
  ) {
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

        setTimeout(() => {
          // Simulated delay async emission to streams
          this.logger?.debug(`[${this.id}] Streaming`, {
            record,
          });
          this._latest.next([record]);
          this._all.next([record]);
        }, Database.latency());

        resolve();
      }, Database.latency());
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

  init(signal: AbortSignal): Observable<this> {
    return timer(Database.latency()).pipe(
      takeUntil(fromEvent(signal, 'abort')),
      map(() => {
        this._database = new Database(this.id, signal, this.logger);
        return this;
      })
    );
  }

  protected _stream(all: boolean): Observable<Record[]> {
    return all ? this.database.all : this.database.latest;
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
    const id = crypto.randomUUID();
    return from(
      this.database.put({
        id,
        data: { payload: JSON.stringify(item) },
      })
    ).pipe(
      map(() => {
        return (event: Record): boolean => event.id === id;
      })
    );
  }
}
