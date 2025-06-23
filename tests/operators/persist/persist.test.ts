import {
  of,
  take,
  toArray,
  firstValueFrom,
  Subject,
  BehaviorSubject,
  ReplaySubject,
  AsyncSubject,
} from 'rxjs';
import { DynamoDBProvider, DynamoDBProviderOptions } from '../../../src';
import {
  persistTo,
  persistFrom,
  persistWith,
  Persistable,
} from '../../../src/operators/persist';
import { DynamoDBLocalContainer } from '../../providers/aws/dynamodb/local';
import { testId } from '../../setup';
import { createTestLogger } from '../../utils/logger';

type Data = { message: string; timestamp: number };

describe.skip('persist', () => {
  let container: DynamoDBLocalContainer;
  let abort: AbortController;
  const logger = createTestLogger();

  beforeAll(async () => {
    container = new DynamoDBLocalContainer(logger);
    await container.start();
  });

  beforeEach(() => {
    abort = new AbortController();
  });

  afterEach(() => {
    if (!abort.signal.aborted) {
      abort.abort();
    }
  });

  afterAll(async () => {
    if (container) {
      await container.stop();
    }
  });

  const createOptions = (): DynamoDBProviderOptions => ({
    client: container.getClient(),
    hashKey: 'hashKey',
    rangeKey: 'rangeKey',
    signal: abort.signal,
    logger,
  });

  describe('persist-to', () => {
    describe('hot', () => {
      test('subject', async () => {
        const options = createOptions();
        const data1: Data = { message: 'hot', timestamp: performance.now() };
        const data2: Data = {
          message: 'subject',
          timestamp: performance.now(),
        };

        // Create basic Subject (hot observable)
        const source$ = new Subject<Data>();
        const persistable$ = of<Persistable<Data>>({
          provider: DynamoDBProvider.from(testId(), options),
          source: source$,
        });
        const observable = persistable$.pipe(persistTo());

        // Start subscription
        const promise = firstValueFrom(observable.pipe(take(2), toArray()));

        // Emit values after subscription (hot observable pattern)
        setTimeout(() => {
          source$.next(data1);
          source$.next(data2);
        }, 100);

        const events = await promise;
        expect(events).toHaveLength(2);
        expect(events[0]).toEqual(data1);
        expect(events[1]).toEqual(data2);

        source$.complete();
      });
    });

    describe('cold', () => {
      test('observable', async () => {
        const options = createOptions();
        const data1: Data = { message: 'cold', timestamp: performance.now() };
        const data2: Data = {
          message: 'observe',
          timestamp: performance.now(),
        };

        // Create persistable object with provider and source
        const source$ = of(data1, data2);
        const persistable$ = of<Persistable<Data>>({
          provider: DynamoDBProvider.from(testId(), options),
          source: source$,
        });
        const observable = persistable$.pipe(persistTo());

        const events = await firstValueFrom(
          observable.pipe(take(2), toArray())
        );
        expect(events).toHaveLength(2);
        expect(events[0]).toEqual(data1);
        expect(events[1]).toEqual(data2);
      });
    });
  });

  describe('persist-from', () => {
    describe('hot', () => {
      test('subject', async () => {
        const options = createOptions();
        const data1: Data = {
          message: 'hot-from-1',
          timestamp: performance.now(),
        };
        const data2: Data = {
          message: 'hot-from-2',
          timestamp: performance.now(),
        };
        const provider$ = DynamoDBProvider.from(testId(), options);

        // Create hot Subject
        const source$ = new Subject<Data>();
        const persistable$ = source$.pipe(persistFrom(provider$, true));

        const promise = firstValueFrom(persistable$.pipe(take(2), toArray()));

        // Emit values after subscription (hot observable pattern)
        setTimeout(() => {
          source$.next(data1);
          source$.next(data2);
        }, 100);

        const persistables = await promise;
        expect(persistables).toHaveLength(2);

        // Verify the structure of first persistable
        expect(persistables[0]?.provider).toBeDefined();
        expect(persistables[0]?.source).toBeDefined();

        // Verify the sources emit the correct data
        const sourceData1 = await firstValueFrom(persistables[0]!.source);
        const sourceData2 = await firstValueFrom(persistables[1]!.source);
        expect(sourceData1).toEqual(data1);
        expect(sourceData2).toEqual(data2);

        source$.complete();
      });
    });

    describe('cold', () => {
      test('observable', async () => {
        const options = createOptions();
        const data1: Data = {
          message: 'cold-from-1',
          timestamp: performance.now(),
        };
        const data2: Data = {
          message: 'cold-from-2',
          timestamp: performance.now(),
        };
        const provider$ = DynamoDBProvider.from(testId(), options);

        // Test that persistFrom creates Persistable objects
        const source$ = of(data1, data2);
        const persistable$ = source$.pipe(persistFrom(provider$, true));

        const persistables = await firstValueFrom(
          persistable$.pipe(take(2), toArray())
        );
        expect(persistables).toHaveLength(2);

        // Verify the structure
        expect(persistables[0]?.provider).toBeDefined();
        expect(persistables[0]?.source).toBeDefined();

        // Verify the sources emit the correct data
        const sourceData1 = await firstValueFrom(persistables[0]!.source);
        const sourceData2 = await firstValueFrom(persistables[1]!.source);
        expect(sourceData1).toEqual(data1);
        expect(sourceData2).toEqual(data2);
      });
    });
  });

  describe('persist-with', () => {
    describe('hot', () => {
      test('subject', async () => {
        const options = createOptions();
        const data1: Data = {
          message: 'hot-persist-with-1',
          timestamp: performance.now(),
        };
        const data2: Data = {
          message: 'hot-persist-with-2',
          timestamp: performance.now(),
        };
        const provider$ = DynamoDBProvider.from(testId(), options);

        // Create hot Subject
        const source$ = new Subject<Data>();
        const result$ = source$.pipe(persistWith(provider$, true));

        const promise = firstValueFrom(result$.pipe(take(2), toArray()));

        // Emit values after subscription (hot observable pattern)
        setTimeout(() => {
          source$.next(data1);
          source$.next(data2);
        }, 100);

        const results = await promise;
        expect(results).toHaveLength(2);
        expect(results[0]).toEqual(data1);
        expect(results[1]).toEqual(data2);

        source$.complete();
      });
    });

    describe('cold', () => {
      test('observable', async () => {
        const options = createOptions();
        const data1: Data = {
          message: 'cold-persist-with-1',
          timestamp: performance.now(),
        };
        const data2: Data = {
          message: 'cold-persist-with-2',
          timestamp: performance.now(),
        };
        const provider$ = DynamoDBProvider.from(testId(), options);

        // Test that persistWith creates a complete flow
        const source$ = of(data1, data2);
        const result$ = source$.pipe(persistWith(provider$, true));

        const results = await firstValueFrom(result$.pipe(take(2), toArray()));
        expect(results).toHaveLength(2);
        expect(results[0]).toEqual(data1);
        expect(results[1]).toEqual(data2);
      });
    });

    describe('subjects', () => {
      test('behavior-subject', async () => {
        const options = createOptions();
        const data1: Data = {
          message: 'behavior-1',
          timestamp: performance.now(),
        };
        const data2: Data = {
          message: 'behavior-2',
          timestamp: performance.now(),
        };
        const provider$ = DynamoDBProvider.from(testId(), options);

        // Create BehaviorSubject with initial value
        const source$ = new BehaviorSubject(data1);
        const result$ = source$.pipe(persistWith(provider$, true));

        const promise = firstValueFrom(result$.pipe(take(2), toArray()));

        // Add second value after subscription
        setTimeout(() => source$.next(data2), 100);

        const events = await promise;
        expect(events).toHaveLength(2);
        expect(events[0]).toEqual(data1);
        expect(events[1]).toEqual(data2);

        source$.complete();
      });

      test('replay-subject', async () => {
        const options = createOptions();
        const data1: Data = {
          message: 'replay-1',
          timestamp: performance.now(),
        };
        const data2: Data = {
          message: 'replay-2',
          timestamp: performance.now(),
        };
        const provider$ = DynamoDBProvider.from(testId(), options);

        // Create ReplaySubject and emit values before subscription
        const source$ = new ReplaySubject<Data>(2);
        source$.next(data1);
        source$.next(data2);

        const result$ = source$.pipe(persistWith(provider$, true));

        const events = await firstValueFrom(result$.pipe(take(2), toArray()));
        expect(events).toHaveLength(2);
        expect(events[0]).toEqual(data1);
        expect(events[1]).toEqual(data2);

        source$.complete();
      });

      test('async-subject', async () => {
        const options = createOptions();
        const data1: Data = {
          message: 'async-1',
          timestamp: performance.now(),
        };
        const data2: Data = {
          message: 'async-2',
          timestamp: performance.now(),
        };
        const provider$ = DynamoDBProvider.from(testId(), options);

        // Create AsyncSubject - only emits the last value when completed
        const source$ = new AsyncSubject<Data>();
        const result$ = source$.pipe(persistWith(provider$, true));

        // Start subscription
        const promise = firstValueFrom(result$);

        // Emit values and complete
        setTimeout(() => {
          source$.next(data1);
          source$.next(data2); // This will be the only value emitted
          source$.complete();
        }, 100);

        const event = await promise;
        expect(event).toEqual(data2); // Only the last value (AsyncSubject behavior)
      });
    });
  });
});
