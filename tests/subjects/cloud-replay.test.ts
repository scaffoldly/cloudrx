import { firstValueFrom, lastValueFrom, Observable, ReplaySubject } from 'rxjs';
import { DynamoDBLocalContainer } from '../providers/aws/dynamodb/local';
import { DynamoDB, DynamoDBOptions, ICloudProvider, Memory } from 'cloudrx';
import { testId } from '../setup';
import { CloudReplaySubject } from 'cloudrx';

type Data = { message: string; timestamp: number };

describe('cloud-replay', () => {
  const seed = async (
    provider$: Observable<ICloudProvider<unknown, unknown>>
  ): Promise<Data[]> => {
    const provider = await firstValueFrom(provider$);

    const data: Data[] = [
      { message: 'data-1', timestamp: performance.now() },
      { message: 'data-2', timestamp: performance.now() },
      { message: 'data-3', timestamp: performance.now() },
    ];

    const items = await Promise.all(
      data.map((item) => firstValueFrom(provider.store(item)))
    );

    console.log('Seeded data:', items);
    return items;
  };

  const snapshot = async (
    provider: Observable<ICloudProvider<unknown, unknown>>,
    subject: CloudReplaySubject<Data>
  ): Promise<void> => {
    const seedData = await seed(provider);
    const snapshot = await lastValueFrom(subject.snapshot());

    expect(snapshot.length).toBe(seedData.length);
    seedData.forEach((item) => {
      expect(snapshot).toContainEqual(item);
    });
  };

  const backfill = async (
    provider: Observable<ICloudProvider<unknown, unknown>>,
    subject: ReplaySubject<Data>
  ): Promise<void> => {
    const seedData = await seed(provider);

    const data = await new Promise<Data[]>((resolve) => {
      const incoming: Data[] = [];
      subject.subscribe({
        next: (data) => {
          incoming.push(data);
        },
      });

      setTimeout(() => {
        resolve(incoming);
      }, 5000);
    });

    // Verify that all seeded data was received
    expect(data.length).toBe(seedData.length);
    seedData.forEach((item) => {
      expect(data).toContainEqual(item);
    });
  };

  const additive = async (
    provider: Observable<ICloudProvider<unknown, unknown>>,
    subject: ReplaySubject<Data>
  ): Promise<void> => {
    const seedData = await seed(provider);

    const moreData: Data[] = [
      { message: 'data-4', timestamp: performance.now() },
      { message: 'data-5', timestamp: performance.now() },
    ];

    const data = await new Promise<Data[]>((resolve) => {
      const incoming: Data[] = [];
      subject.subscribe({
        next: (data) => {
          incoming.push(data);
        },
      });

      moreData.forEach((d) => subject.next(d));

      setTimeout(() => {
        resolve(incoming);
      }, 5000);
    });

    // Verify that all seeded data was received
    expect(data.length).toBe(seedData.length + moreData.length);
    [...seedData, ...moreData].forEach((item) => {
      expect(data).toContainEqual(item);
    });
  };

  describe('memory', () => {
    test('snapshot', async () => {
      const provider = Memory.from(testId());
      const subject = new CloudReplaySubject<Data>(provider);
      await snapshot(provider, subject);
    });

    test('backfill', async () => {
      const provider = Memory.from(testId());
      const subject = new CloudReplaySubject<Data>(provider);
      await backfill(provider, subject);
    });

    test('additive', async () => {
      const provider = Memory.from(testId());
      const subject = new CloudReplaySubject<Data>(provider);
      await additive(provider, subject);
    });
  });

  describe('dynamodb', () => {
    let container: DynamoDBLocalContainer;
    let options: DynamoDBOptions = {};

    beforeAll(async () => {
      container = new DynamoDBLocalContainer(console);
      await container.start();
      options.client = container.getClient();
    });

    afterAll(async () => {
      if (container) {
        await container.stop();
      }
    });

    test('snapshot', async () => {
      const provider = DynamoDB.from(testId(), options);
      const subject = new CloudReplaySubject<Data>(provider);
      await snapshot(provider, subject);
    });

    test('backfill', async () => {
      const provider = DynamoDB.from(testId(), options);
      const subject = new CloudReplaySubject<Data>(provider);
      await backfill(provider, subject);
    });

    test('additive', async () => {
      const provider = DynamoDB.from(testId(), options);
      const subject = new CloudReplaySubject<Data>(provider);
      await additive(provider, subject);
    });
  });
});
