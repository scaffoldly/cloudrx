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
import { DynamoDBProvider, DynamoDBProviderOptions } from '../../src';
import { persistWith } from '../../src/operators/persist';
import { DynamoDBLocalContainer } from '../providers/aws/dynamodb/local';
import { testId } from '../setup';
import { createTestLogger } from '../utils/logger';

type Data = { message: string; timestamp: number };

describe('persist-with', () => {
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
