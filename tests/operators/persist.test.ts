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
import {
  persistTo,
  persistFrom,
  persistWith,
  Persistable,
} from '../../src/operators/persist';
import { DynamoDBLocalContainer } from '../providers/aws/dynamodb/local';
import { testId } from '../setup';
import { createTestLogger } from '../utils/logger';

type Data = { message: string; timestamp: number };

describe('persist', () => {
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
        const data: Data = {
          message: 'hot-from',
          timestamp: performance.now(),
        };
        const provider$ = DynamoDBProvider.from(testId(), options);

        // Create hot Subject
        const source$ = new Subject<Data>();
        const persistable$ = source$.pipe(persistFrom(provider$, true));

        const promise = firstValueFrom(persistable$);

        // Emit value after subscription (hot observable pattern)
        setTimeout(() => {
          source$.next(data);
        }, 100);

        const persistable = await promise;

        // Verify the structure
        expect(persistable.provider).toBeDefined();
        expect(persistable.source).toBeDefined();
        expect(persistable.stream).toBeDefined();

        // Verify the source emits the correct data
        const sourceData = await firstValueFrom(persistable.source);
        expect(sourceData).toEqual(data);

        source$.complete();
      });
    });

    describe('cold', () => {
      test('observable', async () => {
        const options = createOptions();
        const data: Data = {
          message: 'cold-from',
          timestamp: performance.now(),
        };
        const provider$ = DynamoDBProvider.from(testId(), options);

        // Test that persistFrom creates a Persistable object
        const source$ = of(data);
        const persistable$ = source$.pipe(persistFrom(provider$, true));

        const persistable = await firstValueFrom(persistable$);

        // Verify the structure
        expect(persistable.provider).toBeDefined();
        expect(persistable.source).toBeDefined();
        expect(persistable.stream).toBeDefined();

        // Verify the source emits the correct data
        const sourceData = await firstValueFrom(persistable.source);
        expect(sourceData).toEqual(data);
      });
    });
  });

  describe('persist-with', () => {
    describe('hot', () => {
      test('subject', async () => {
        const options = createOptions();
        const data: Data = {
          message: 'hot-persist-with',
          timestamp: performance.now(),
        };
        const provider$ = DynamoDBProvider.from(testId(), options);

        // Create hot Subject
        const source$ = new Subject<Data>();
        const result$ = source$.pipe(persistWith(provider$, true));

        const promise = firstValueFrom(result$);

        // Emit value after subscription (hot observable pattern)
        setTimeout(() => {
          source$.next(data);
        }, 100);

        const result = await promise;
        expect(result).toEqual(data);

        source$.complete();
      });
    });

    describe('cold', () => {
      test('observable', async () => {
        const options = createOptions();
        const data: Data = {
          message: 'cold-persist-with',
          timestamp: performance.now(),
        };
        const provider$ = DynamoDBProvider.from(testId(), options);

        // Test that persistWith creates a complete flow
        const source$ = of(data);
        const result$ = source$.pipe(persistWith(provider$, true));

        const result = await firstValueFrom(result$);
        expect(result).toEqual(data);
      });
    });

    describe('subjects', () => {
      test('behavior-subject', async () => {
        const options = createOptions();
        const data: Data = {
          message: 'behavior',
          timestamp: performance.now(),
        };
        const provider$ = DynamoDBProvider.from(testId(), options);

        // Create BehaviorSubject with initial value
        const source$ = new BehaviorSubject(data);
        const result$ = source$.pipe(persistWith(provider$, true));

        const event = await firstValueFrom(result$);
        expect(event).toEqual(data);

        source$.complete();
      });

      test('replay-subject', async () => {
        const options = createOptions();
        const data: Data = { message: 'replay', timestamp: performance.now() };
        const provider$ = DynamoDBProvider.from(testId(), options);

        // Create ReplaySubject and emit value before subscription
        const source$ = new ReplaySubject<Data>(1);
        source$.next(data);

        const result$ = source$.pipe(persistWith(provider$, true));

        const event = await firstValueFrom(result$);
        expect(event).toEqual(data);

        source$.complete();
      });

      test('async-subject', async () => {
        const options = createOptions();
        const data1: Data = { message: 'async', timestamp: performance.now() };
        const data2: Data = {
          message: 'subject',
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
        expect(event).toEqual(data2); // Only the last value
      });
    });
  });
});
