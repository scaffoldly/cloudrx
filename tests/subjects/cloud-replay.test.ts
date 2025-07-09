import { firstValueFrom, lastValueFrom, Observable, ReplaySubject } from 'rxjs';
import { DynamoDBLocalContainer } from '../providers/aws/dynamodb/local';
import {
  CloudProvider,
  DynamoDB,
  DynamoDBOptions,
  ICloudProvider,
  Memory,
} from 'cloudrx';
import { testId } from '../setup';
import { CloudReplaySubject } from 'cloudrx';

type Data = { message: string; timestamp: number };

describe('cloud-replay', () => {
  const abort = new AbortController();

  beforeAll(() => {
    CloudProvider.DEFAULT_ABORT = abort;
    CloudProvider.DEFAULT_LOGGER = console;
  });

  afterAll(() => {
    abort.abort();
  });

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
    seedData: Data[],
    subject: CloudReplaySubject<Data>
  ): Promise<void> => {
    const snapshot = await lastValueFrom(subject.snapshot());

    expect(snapshot.length).toBe(seedData.length);
    seedData.forEach((item) => {
      expect(snapshot).toContainEqual(item);
    });
  };

  const backfill = async (
    seedData: Data[],
    subject: ReplaySubject<Data>
  ): Promise<void> => {
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
    seedData: Data[],
    subject: ReplaySubject<Data>
  ): Promise<Data[]> => {
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

    return [...seedData, ...moreData];
  };

  const shadowed = async (
    seedData: Data[],
    subjects: CloudReplaySubject<Data>[]
  ): Promise<void> => {
    const primary = subjects[0];

    const allData = await additive(seedData, primary!);
    await Promise.all(
      subjects.slice(1).map((subject) => snapshot(allData, subject))
    );
  };

  describe('memory', () => {
    test('snapshot', async () => {
      const provider = Memory.from(testId());
      const seedData = await seed(provider);
      const subject = new CloudReplaySubject<Data>(provider);
      await snapshot(seedData, subject);
    });

    test('backfill', async () => {
      const provider = Memory.from(testId());
      const seedData = await seed(provider);
      const subject = new CloudReplaySubject<Data>(provider);
      await backfill(seedData, subject);
    });

    test('additive', async () => {
      const provider = Memory.from(testId());
      const seedData = await seed(provider);
      const subject = new CloudReplaySubject<Data>(provider);
      await additive(seedData, subject);
    });

    test('shadowed', async () => {
      const provider = Memory.from(testId());
      const seedData = await seed(provider);
      const subjects: CloudReplaySubject<Data>[] = [
        new CloudReplaySubject<Data>(provider),
        new CloudReplaySubject<Data>(provider),
        new CloudReplaySubject<Data>(provider),
      ];
      await shadowed(seedData, subjects);
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

    afterAll(async () => {
      abort.abort();
    });

    test('snapshot', async () => {
      const provider = DynamoDB.from(testId(), options);
      const seedData = await seed(provider);
      const subject = new CloudReplaySubject<Data>(provider);
      await snapshot(seedData, subject);
    });

    test('backfill', async () => {
      const provider = DynamoDB.from(testId(), options);
      const seedData = await seed(provider);
      const subject = new CloudReplaySubject<Data>(provider);
      await backfill(seedData, subject);
    });

    test('additive', async () => {
      const provider = DynamoDB.from(testId(), options);
      const seedData = await seed(provider);
      const subject = new CloudReplaySubject<Data>(provider);
      await additive(seedData, subject);
    });

    test('shadowed', async () => {
      const provider = DynamoDB.from(testId(), options);
      const seedData = await seed(provider);
      const subjects: CloudReplaySubject<Data>[] = [
        new CloudReplaySubject<Data>(provider),
        new CloudReplaySubject<Data>(provider),
        new CloudReplaySubject<Data>(provider),
      ];
      await shadowed(seedData, subjects);
    });
  });
});
