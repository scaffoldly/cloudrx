import {
  take,
  toArray,
  firstValueFrom,
  Subject,
  MonoTypeOperatorFunction,
} from 'rxjs';
import { DynamoDBLocalContainer } from '../providers/aws/dynamodb/local';
import { CloudProvider, persist, persistReplay } from 'cloudrx';
import { DynamoDB, DynamoDBOptions, Memory } from 'cloudrx';
import { testId } from '../setup';

type Data = { message: string; timestamp: number };

describe('persist', () => {
  const abort = new AbortController();

  beforeAll(() => {
    CloudProvider.DEFAULT_ABORT = abort;
    CloudProvider.DEFAULT_LOGGER = console;
  });

  afterAll(() => {
    abort.abort();
  });

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
      const data4: Data = { message: 'data-4', timestamp: performance.now() };

      const producer = new Subject<Data>();
      const observable = producer.pipe(operator);

      let producedEventsP: Promise<Data[]>;
      let producedEvents: Data[];

      producedEventsP = firstValueFrom(
        observable.pipe(take(expected.events.length), toArray())
      );

      producedEvents = await producedEventsP;
      expect(producedEvents).toEqual(expected.events);

      producedEventsP = firstValueFrom(
        observable.pipe(take(expected.events.length + 1), toArray())
      );
      producer.next(data4);

      producedEvents = await producedEventsP;
      expect(producedEvents).toHaveLength(expected.events.length + 1);
      expect(producedEvents[producedEvents.length - 1]).toEqual(data4);
    };

    const observe = async (
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
      // Providerless persistReplay has no historical data to replay
      await replay(persistReplay(), { events: [] });
      await observe(persistReplay(), { events: [] });
    });

    describe('memory', () => {
      test('persist', async () => {
        const provider = Memory.from(testId())
          .withLogger(console);
        await run(persist(provider));
      });

      test('persist-replay', async () => {
        const provider = Memory.from(testId())
          .withLogger(console);
        const events = await run(persist(provider));
        await replay(persistReplay(provider), events);
      });

      test('persist-observe', async () => {
        const provider = Memory.from(testId())
          .withLogger(console);
        const events = await run(persist(provider));
        await observe(persistReplay(provider), events);
      });

      test('persist-replay-observe', async () => {
        const provider = Memory.from(testId())
          .withLogger(console);
        const events = await run(persist(provider));
        await replay(persistReplay(provider), events);
        await observe(persistReplay(provider), events);
      });
    });

    describe('dynamodb', () => {
      let container: DynamoDBLocalContainer;
      let options: DynamoDBOptions = {};

      beforeAll(async () => {
        container = new DynamoDBLocalContainer();
        await container.start(abort.signal);
        options.client = container.getClient();
      });

      beforeEach(() => {});

      afterEach(() => {});

      afterAll(async () => {
        if (container) {
          await container.stop();
        }
      });

      test('persist', async () => {
        const provider = DynamoDB.from(testId())
          .withClient(options.client!);

        await run(persist(provider));
      });

      test('persist-replay', async () => {
        const provider = DynamoDB.from(testId())
          .withClient(options.client!);

        const events = await run(persist(provider));
        await replay(persistReplay(provider), events);
      });

      test('persist-observe', async () => {
        const provider = DynamoDB.from(testId())
          .withClient(options.client!);

        const events = await run(persist(provider));
        await observe(persistReplay(provider), events);
      });

      test('persist-replay-observe', async () => {
        const provider = DynamoDB.from(testId())
          .withClient(options.client!);

        const events = await run(persist(provider));
        await replay(persistReplay(provider), events);
        await observe(persistReplay(provider), events);
      });
    });
  });
});
