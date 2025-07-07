import { firstValueFrom, lastValueFrom, Observable } from 'rxjs';
import { DynamoDBLocalContainer } from '../providers/aws/dynamodb/local';
import { DynamoDB, DynamoDBOptions, ICloudProvider, Memory } from '@providers';
import { testId } from '../setup';
import { CloudSubject } from '@subjects';

type Data = { message: string; timestamp: number };

describe('subjects', () => {
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

  describe('memory', () => {
    let seedData: Data[];

    beforeAll(async () => {});

    beforeEach(async () => {
      seedData = await seed(Memory.from(testId()));
    });

    afterEach(() => {});

    afterAll(async () => {});

    test('snapshot', async () => {
      const subject = new CloudSubject<Data>(Memory.from(testId()));
      const snapshot = await lastValueFrom(subject.snapshot());

      expect(snapshot).toEqual(seedData);
    });

    test('cloud-subject', async () => {
      const subject = new CloudSubject<Data>(Memory.from(testId()));

      const data = await new Promise<Data[]>((resolve) => {
        const incoming: Data[] = [];
        subject.subscribe({
          next: (data) => {
            console.log('Received data:', data);
            incoming.push(data);
            if (incoming.length === seedData.length) {
              subject.complete();
            }
          },
          complete: () => {
            resolve(incoming);
          },
        });
      });

      // Verify that all seeded data was received
      expect(data.length).toBe(seedData.length);
      seedData.forEach((item) => {
        expect(data).toContainEqual(item);
      });
    });
  });

  describe('dynamodb', () => {
    let container: DynamoDBLocalContainer;
    let options: DynamoDBOptions = {};
    let seedData: Data[];

    beforeAll(async () => {
      container = new DynamoDBLocalContainer(console);
      await container.start();
      options.client = container.getClient();
    });

    beforeEach(async () => {
      seedData = await seed(DynamoDB.from(testId(), options));
    });

    afterEach(() => {});

    afterAll(async () => {
      if (container) {
        await container.stop();
      }
    });

    test('snapshot', async () => {
      const subject = new CloudSubject<Data>(DynamoDB.from(testId(), options));
      const snapshot = await lastValueFrom(subject.snapshot());

      expect(snapshot).toEqual(seedData);
    });

    test('cloud-subject', async () => {
      const subject = new CloudSubject<Data>(DynamoDB.from(testId(), options));

      const data = await new Promise<Data[]>((resolve) => {
        const incoming: Data[] = [];
        subject.subscribe({
          next: (data) => {
            console.log('Received data:', data);
            incoming.push(data);
            if (incoming.length === seedData.length) {
              subject.complete();
            }
          },
          complete: () => {
            resolve(incoming);
          },
        });
      });

      // Verify that all seeded data was received
      expect(data.length).toBe(seedData.length);
      seedData.forEach((item) => {
        expect(data).toContainEqual(item);
      });
    });
  });
});
