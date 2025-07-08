import { firstValueFrom, lastValueFrom, Observable } from 'rxjs';
import { DynamoDBLocalContainer } from '../providers/aws/dynamodb/local';
import { DynamoDB, DynamoDBOptions, ICloudProvider, Memory } from 'cloudrx';
import { testId } from '../setup';
import { CloudSubject } from 'cloudrx';

type Data = { message: string; timestamp: number };

describe('cloud-subject', () => {
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
    provider: Observable<ICloudProvider<unknown, unknown>>
  ): Promise<void> => {
    const seedData = await seed(provider);
    const subject = new CloudSubject<Data>(provider);
    const snapshot = await lastValueFrom(subject.snapshot());

    expect(snapshot.length).toBe(seedData.length);
    seedData.forEach((item) => {
      expect(snapshot).toContainEqual(item);
    });
  };

  const backfill = async (
    provider: Observable<ICloudProvider<unknown, unknown>>
  ): Promise<void> => {
    const seedData = await seed(provider);
    const subject = new CloudSubject<Data>(provider);

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

  describe('memory', () => {
    test('snapshot', async () => {
      await snapshot(Memory.from(testId()));
    });

    test('backfill', async () => {
      await backfill(Memory.from(testId()));
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
      await snapshot(DynamoDB.from(testId(), options));
    });

    test('backfill', async () => {
      await backfill(DynamoDB.from(testId(), options));
    });
  });
});
