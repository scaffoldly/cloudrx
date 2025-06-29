import {
  take,
  toArray,
  firstValueFrom,
  Subject,
  MonoTypeOperatorFunction,
} from 'rxjs';
import { DynamoDBLocalContainer } from '../../providers/aws/dynamodb/local';
import { persist, persistReplay } from '@operators';
import { Memory } from '@providers';
import { testId } from '../../setup';

type Data = { message: string; timestamp: number };

describe('persist', () => {
  let container: DynamoDBLocalContainer;
  let abort: AbortController;

  beforeAll(async () => {
    container = new DynamoDBLocalContainer(console);
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
    ): Promise<{ events: Data[] }> => {
      const data1: Data = { message: 'data-1', timestamp: performance.now() };
      const data2: Data = { message: 'data-2', timestamp: performance.now() };
      const data3: Data = { message: 'data-3', timestamp: performance.now() };

      const producer = new Subject<Data>();
      const observable = producer.pipe(operator);

      let producedEventsP: Promise<Data[]>;
      let producedEvents: Data[];

      producedEventsP = firstValueFrom(observable.pipe(take(2), toArray()));
      producer.next(data1);
      producer.next(data2);

      producedEvents = await producedEventsP;

      expect(producedEvents).toHaveLength(2);
      expect(producedEvents[0]).toEqual(data1);
      expect(producedEvents[1]).toEqual(data2);

      producedEventsP = firstValueFrom(observable.pipe(take(1), toArray()));
      producer.next(data3);

      producedEvents = await producedEventsP;
      expect(producedEvents).toHaveLength(1);
      expect(producedEvents[0]).toEqual(data3);

      return { events: [data1, data2, data3] };
    };

    const replay = async (
      operator: MonoTypeOperatorFunction<Data>,
      expected: { events: Data[] }
    ): Promise<void> => {
      const producer = new Subject<Data>();
      const observable = producer.pipe(operator);

      let producedEventsP: Promise<Data[]>;
      let producedEvents: Data[];

      producedEventsP = firstValueFrom(
        observable.pipe(take(expected.events.length), toArray())
      );

      producedEvents = await producedEventsP;

      expect(producedEvents).toEqual(expected.events);
    };

    test('baseline', async () => {
      await run(persist());
    });

    test('memory', async () => {
      await run(persist(Memory.from(testId())));
    });

    test('memory-replay', async () => {
      const provider = Memory.from(testId());
      const actual = await run(persist(provider));
      await replay(persistReplay(provider), actual);
    });

    test('dynamodb', async () => {});
  });
});
