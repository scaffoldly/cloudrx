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

  beforeAll(async () => {
    container = new DynamoDBLocalContainer(console);
    await container.start();
  });

  beforeEach(() => {});

  afterEach(() => {});

  afterAll(async () => {
    if (container) {
      await container.stop();
    }
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

    test('baseline', async () => {
      await run(persist());
      // Providerless persistReplay has no historical data to replay
      await replay(persistReplay(), { events: [] });
    });

    test('memory', async () => {
      const provider = Memory.from(testId());
      const events = await run(persist(provider));
      await replay(persistReplay(provider), events);
    });

    test('dynamodb', async () => {});
  });
});
