import {
  filter,
  firstValueFrom,
  lastValueFrom,
  Observable,
  ReplaySubject,
} from 'rxjs';
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
  beforeAll(() => {
    CloudProvider.DEFAULT_LOGGER = console;
  });

  afterAll(() => {
    CloudProvider.abort('Tests complete');
  });

  const seed = async (
    provider$: Observable<ICloudProvider<unknown>>
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

  const expired = async (
    provider: Observable<ICloudProvider<unknown>>
  ): Promise<void> => {
    const subject = new CloudReplaySubject<Data>(provider);

    const now = Date.now();
    const expiredItem = {
      message: 'expired-item',
      timestamp: now,
    };

    const expiredEvents = await new Promise<Data[]>((resolve) => {
      const incoming: Data[] = [];
      subject.on('expired', (value) => {
        incoming.push(value);
      });

      // Use the new expires parameter API
      const expiresDate = new Date(now + 1000);
      subject.next(expiredItem, expiresDate);

      setTimeout(() => {
        resolve(incoming);
      }, 5000);
    });

    expect(expiredEvents).toHaveLength(1);
    expect(expiredEvents[0]).toEqual({
      message: 'expired-item',
      timestamp: now,
    });
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

    test('expired', async () => {
      await expired(Memory.from(testId()));
    });
  });

  describe('dynamodb', () => {
    let container: DynamoDBLocalContainer;
    let options: DynamoDBOptions = {};

    beforeAll(async () => {
      container = new DynamoDBLocalContainer();
      await container.start();
      options.client = container.getClient();
    });

    afterAll(async () => {
      await container.stop();
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

    test('expired', async () => {
      await expired(DynamoDB.from(testId(), options));
    });
  });

  describe('readme', () => {
    describe('ddb', () => {
      let container: DynamoDBLocalContainer;
      beforeAll(async () => {
        container = new DynamoDBLocalContainer();
        await container.start();
      });
      afterAll(async () => {
        await container.stop();
      });

      // Verify readme examples
      test('cloud-replay', async () => {
        // Capture log events
        const logEvents: string[] = [];
        const console = {
          log(...args: unknown[]): void {
            logEvents.push(
              args
                .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
                .join(' ')
            );
          },
        };

        DynamoDB.DEFAULT_CLIENT = container.getClient();

        // ### BEGIN COPY PASTE FROM README ###
        type UserEvent = {
          action: 'login' | 'clicked' | 'purchase' | 'purchased';
          userId: number;
          productId?: number;
          transactionId?: number;
        };

        // Create cloud-backed replay subjects using the same DynamoDB table
        // - These can be on different machines, different processes, etc.
        const auth = new CloudReplaySubject<UserEvent>(
          DynamoDB.from('my-site')
        );
        const cart = new CloudReplaySubject<UserEvent>(
          DynamoDB.from('my-site')
        );
        const user = new CloudReplaySubject<UserEvent>(
          DynamoDB.from('my-site')
        );

        // Emit a 'login' event, which will broadcast to all subjects
        auth.next(
          {
            action: 'login',
            userId: 123,
          },
          new Date(Date.now() + 5000) // Emit an 'expire' event in 5 seconds
        );

        // Emit a 'pruchase' event, which will broadcast to all subjects
        cart.next({
          action: 'purchase',
          userId: 123,
          productId: 456,
        });

        // Emit a 'purchased' event, which will broadcast to all subjects
        user.next({
          action: 'purchased',
          userId: 123,
          transactionId: 789,
        });

        // All subjects receive all events
        auth
          // Only listen for 'login' events
          .pipe(filter((event) => event.action === 'login'))
          .subscribe((event) => {
            console.log('Auth received:', event);
          });

        cart.subscribe((event) => {
          console.log('Cart received:', event);
        });

        user.subscribe((event) => {
          console.log('User received:', event);
        });

        // (Optional) Listen for expired events for additional handling for each subject
        user.on('expired', (event) => {
          if (event.action === 'login') {
            console.log('User received expired login event:', event);
          }
        });

        // Auth Output:
        // - Note: Only 'login' events because of the filter
        // Auth received: { action: 'login', userId: 123 }

        // Cart Output:
        // Cart received: { action: 'login', userId: 123 }
        // Cart received: { action: 'purchase', userId: 123, productId: 456 }
        // Cart received: { action: 'purchased', userId: 123, transactionId: 789 }

        // User Output:
        // User received: { action: 'login', userId: 123 }
        // User received: { action: 'purchase', userId: 123, productId: 456 }
        // User received: { action: 'purchased', userId: 123, transactionId: 789 }
        // ... 5 seconds later:
        // User session received expired login event: { action: 'login', userId: 123 }
        // ### END COPY PASTE FROM README ###

        await new Promise<void>((resolve) =>
          setTimeout(() => resolve(), 10000)
        );

        const expectedLogs = [
          'Auth received: {"action":"login","userId":123}',

          'Cart received: {"action":"login","userId":123}',
          'Cart received: {"productId":456,"action":"purchase","userId":123}',
          'Cart received: {"action":"purchased","userId":123,"transactionId":789}',

          'User received: {"action":"login","userId":123}',
          'User received: {"productId":456,"action":"purchase","userId":123}',
          'User received: {"action":"purchased","userId":123,"transactionId":789}',

          'User received expired login event: {"action":"login","userId":123}',
        ];

        expectedLogs.forEach((log) => {
          expect(logEvents).toContain(log);
        });
      });
    });
  });
});
