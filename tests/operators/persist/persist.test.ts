import {
  take,
  toArray,
  firstValueFrom,
  Subject,
  map,
  of,
  MonoTypeOperatorFunction,
} from 'rxjs';
import { DynamoDBLocalContainer } from '../../providers/aws/dynamodb/local';
import { createTestLogger } from '../../utils/logger';
import { ICloudProvider } from '@providers';
import { persist } from '@operators';
// Import Memory provider for in-memory latency tests
import { Memory } from '@providers';
import { testId } from '../../setup';

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

  //   const createOptions = (): DynamoDBProviderOptions => ({
  //     client: container.getClient(),
  //     hashKey: 'hashKey',
  //     rangeKey: 'rangeKey',
  //     signal: abort.signal,
  //     logger,
  //   });

  //   test('hot', async () => {
  //     const options = createOptions();
  //     const data1: Data = { message: 'hot-1', timestamp: performance.now() };
  //     const data2: Data = { message: 'hot-2', timestamp: performance.now() };

  //     // Create basic Subject (hot observable)
  //     const source$ = new Subject<Data>();
  //     const persistable$ = of<Persistable<Data>>({
  //       provider: DynamoDBProvider.from(testId(), options),
  //       source: source$,
  //     });
  //     const observable = persistable$.pipe(persistTo());

  //     // Start subscription
  //     const promise = firstValueFrom(observable.pipe(take(2), toArray()));

  //     // Emit values after subscription (hot observable pattern)
  //     setTimeout(() => {
  //       source$.next(data1);
  //       source$.next(data2);
  //     }, 100);

  //     const events = await promise;
  //     expect(events).toHaveLength(2);
  //     expect(events[0]).toEqual(data1);
  //     expect(events[1]).toEqual(data2);

  //     source$.complete();
  //   });

  //   test('cold', async () => {
  //     const options = createOptions();
  //     const data1: Data = { message: 'cold-1', timestamp: performance.now() };
  //     const data2: Data = { message: 'cold-2', timestamp: performance.now() };

  //     // Create persistable object with provider and source
  //     const source$ = of(data1, data2);
  //     const persistable$ = of<Persistable<Data>>({
  //       provider: DynamoDBProvider.from(testId(), options),
  //       source: source$,
  //     });
  //     const observable = persistable$.pipe(persistTo());

  //     const events = await firstValueFrom(observable.pipe(take(2), toArray()));
  //     expect(events).toHaveLength(2);
  //     expect(events[0]).toEqual(data1);
  //     expect(events[1]).toEqual(data2);
  //   });

  describe('hot', () => {
    const run = async (
      operator: MonoTypeOperatorFunction<Data>
    ): Promise<void> => {
      const data1: Data = { message: 'data-1', timestamp: performance.now() };
      const data2: Data = { message: 'data-2', timestamp: performance.now() };
      const data3: Data = { message: 'data-3', timestamp: performance.now() };

      const producer = new Subject<Data>();
      const observable = producer.pipe(operator);

      let producedEventsP: Promise<Data[]>;
      let producedEvents: Data[];

      console.log('Setting up producer...');
      producedEventsP = firstValueFrom(observable.pipe(take(2), toArray()));
      console.log('Producing 2 events:', data1, data2);
      producer.next(data1);
      producer.next(data2);

      console.log('Waiting for produced events...');
      producedEvents = await producedEventsP;
      console.log('Produced events:', producedEvents);

      expect(producedEvents).toHaveLength(2);
      expect(producedEvents[0]).toEqual(data1);
      expect(producedEvents[1]).toEqual(data2);

      console.log('Setting up for next event...');
      producedEventsP = firstValueFrom(observable.pipe(take(1), toArray()));
      console.log('Producing 1 more event:', data3);
      producer.next(data3);

      console.log('Waiting for next produced event...');
      producedEvents = await producedEventsP;
      console.log('Next produced event:', producedEvents);
      expect(producedEvents).toHaveLength(1);
      expect(producedEvents[0]).toEqual(data3);

      // Complete the producer to properly clean up resources
      producer.complete();
    };

    test('baseline', async () => {
      const operator: MonoTypeOperatorFunction<Data> = map((data) => data);
      await run(operator);
    });

    test('in-memory-mock', async () => {
      // Create a mock memory provider for testing
      const memoryProvider = {
        store: <T>(value: T) => of(value),
      } as unknown as ICloudProvider<unknown>;

      // Use the persist operator with our mock provider
      await run(persist(of(memoryProvider)));
    });

    test('in-memory-zero-latency', async () => {
      // Zero latency test doesn't need timeout adjustment
      // Create a memory provider with 0ms latency
      const abortController = new AbortController();
      const provider = new Memory(testId(), {
        signal: abortController.signal,
        logger,
        latency: 0,
      });

      try {
        // Use the persist operator with real provider but 0ms latency
        await run(persist(provider.init(abortController.signal)));
      } finally {
        abortController.abort();
      }
    });

    test('in-memory-with-latency', async () => {
      // Using a global timeout of 90s set in package.json
      // Create a memory provider with 1000ms latency for realistic testing
      const abortController = new AbortController();
      const provider = new Memory(testId(), {
        signal: abortController.signal,
        logger,
        latency: 1000,
      });

      try {
        // Use the persist operator with real provider and 1000ms latency
        await run(persist(provider.init(abortController.signal)));
      } finally {
        abortController.abort();
      }
    });

    test('aws-dynamodb', async () => {});
  });
});
