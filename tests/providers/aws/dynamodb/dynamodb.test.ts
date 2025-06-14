import { Observable, Subject, firstValueFrom, lastValueFrom } from 'rxjs';
import { deepEqual } from 'fast-equals';
import { DynamoDBProviderOptions } from '../../../../src';
import DynamoDBProvider from '../../../../src/providers/aws/dynamodb';
import { DynamoDBLocalContainer } from './local';
import { Shard, _Record } from '@aws-sdk/client-dynamodb-streams';

function testId(): string {
  return expect
    .getState()
    .currentTestName!.replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/--+/g, '-');
}

// Helper to access private property
function getShardsProperty(
  provider: DynamoDBProvider
): Observable<Shard> | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (provider as any)._shards;
}

describe('aws-dynamodb', () => {
  let container: DynamoDBLocalContainer;
  let abort: AbortController;

  beforeAll(async () => {
    container = new DynamoDBLocalContainer();
    await container.start();
  });

  beforeEach(() => {
    abort = new AbortController();
  });

  afterEach(() => {
    abort.abort();
  });

  afterAll(async () => {
    if (container) {
      await container.stop();
    }
  });

  test('is-a-singleton', async () => {
    const options: DynamoDBProviderOptions = {
      client: container.getClient(),
      hashKey: 'hashKey',
      rangeKey: 'rangeKey',
      signal: abort.signal,
      logger: console,
    };

    const instance1$ = DynamoDBProvider.from(testId(), options);
    const instance2$ = DynamoDBProvider.from(testId(), options);

    const instance1 = await firstValueFrom(instance1$);
    const instance2 = await firstValueFrom(instance2$);

    expect(instance1).toBe(instance2);
    expect(instance1.tableName).toBe(`cloudrx-${testId()}`);
    expect(instance2.tableName).toBe(`cloudrx-${testId()}`);
  });

  test('sets-table-arn', async () => {
    const options: DynamoDBProviderOptions = {
      client: container.getClient(),
      hashKey: 'hashKey',
      rangeKey: 'rangeKey',
      signal: abort.signal,
      logger: console,
    };

    const instance = await firstValueFrom(
      DynamoDBProvider.from(testId(), options)
    );

    expect(instance.tableArn).toBeDefined();
  });

  test('sets-stream-arn', async () => {
    const options: DynamoDBProviderOptions = {
      client: container.getClient(),
      hashKey: 'hashKey',
      rangeKey: 'rangeKey',
      signal: abort.signal,
      logger: console,
    };

    const instance = await firstValueFrom(
      DynamoDBProvider.from(testId(), options)
    );

    expect(instance.streamArn).toBeDefined();
  });

  test('stores-item', async () => {
    const options: DynamoDBProviderOptions = {
      client: container.getClient(),
      hashKey: 'hashKey',
      rangeKey: 'rangeKey',
      signal: abort.signal,
      logger: console,
    };

    const instance = await firstValueFrom(
      DynamoDBProvider.from(testId(), options)
    );

    const testData = { message: 'test', timestamp: Date.now() };
    const storedData = await lastValueFrom(instance.store(testData));

    expect(storedData).toEqual(testData);
  });

  test('stores-items', async () => {
    const options: DynamoDBProviderOptions = {
      client: container.getClient(),
      hashKey: 'hashKey',
      rangeKey: 'rangeKey',
      signal: abort.signal,
      logger: console,
    };

    const instance = await firstValueFrom(
      DynamoDBProvider.from(testId(), options)
    );

    const testItems = [];
    for (let i = 0; i < 10; i++) {
      testItems.push({ message: `test-${i}`, timestamp: Date.now() + i });
    }

    // Store items sequentially to avoid potential race conditions
    const storedItems = [];
    for (const item of testItems) {
      const storedData = await lastValueFrom(instance.store(item));
      storedItems.push(storedData);
    }

    // Verify all items were stored correctly
    expect(storedItems.length).toEqual(10);
    for (let i = 0; i < 10; i++) {
      expect(storedItems[i]).toEqual(testItems[i]);
    }
  });

  test('streams-items', async () => {
    const options: DynamoDBProviderOptions = {
      client: container.getClient(),
      hashKey: 'hashKey',
      rangeKey: 'rangeKey',
      signal: abort.signal,
      logger: console,
    };

    // Create two providers with the same table name to test shared streams
    const tableId = testId();
    const provider1 = await firstValueFrom(
      DynamoDBProvider.from(tableId, options)
    );
    const provider2 = await firstValueFrom(
      DynamoDBProvider.from(tableId, options)
    );

    // Create event collectors for both providers
    const events1: _Record[] = [];
    const events2: _Record[] = [];

    // Set up event handlers for both providers
    provider1.on('event', (event) => {
      events1.push(event);
    });

    provider2.on('event', (event) => {
      events2.push(event);
    });

    // Setup streams for both providers
    // Only store items on the first provider
    const stream1 = provider1.stream('latest');
    const stream2 = provider2.stream('latest');

    // Store 5 items only using the first provider
    const testItems = Array.from({ length: 5 }).map((_, i) => ({
      message: `stream-test-${i}`,
      timestamp: Date.now() + i,
    }));

    // Use Promise.all with map to store all items in parallel
    await Promise.all(
      testItems.map((item) => lastValueFrom(provider1.store(item)))
    );

    // Use Promise.all with Array.from to gather all lastValueFrom calls
    // This eliminates the need for an arbitrary timeout
    const promises = testItems.map((_item) => {
      // Create a Promise that will resolve when the event is received by both providers
      return new Promise<void>((resolve) => {
        const checkEvents = (): void => {
          // Check if both event arrays have received all events
          if (
            events1.length >= testItems.length &&
            events2.length >= testItems.length
          ) {
            resolve();
          } else {
            setTimeout(checkEvents, 100); // Check again after a short delay
          }
        };
        checkEvents();
      });
    });

    // Wait for all events to be processed
    await Promise.all(promises);

    // Abort to complete the streams
    stream1.abort();
    stream2.abort();

    // Both streams should have received the same events
    expect(events1.length).toBeGreaterThan(0);
    expect(events2.length).toBeGreaterThan(0);
    expect(events1.length).toEqual(events2.length);

    // Events should be in the same order
    for (let i = 0; i < events1.length; i++) {
      // Since TypeScript doesn't understand the nested DynamoDB structure well,
      // we need to use type assertions and any type

      const dynamodb1 = events1[i]?.dynamodb;
      const dynamodb2 = events2[i]?.dynamodb;

      const data1 = DynamoDBProvider.unmarshal(dynamodb1?.NewImage?.data);
      const data2 = DynamoDBProvider.unmarshal(dynamodb2?.NewImage?.data);

      // Use deepEqual from fast-equals for comparison
      expect(deepEqual(data1, data2)).toBe(true);
    }
  });

  describe('shard-observation', () => {
    // Create a class that mimics the behavior of DynamoDBProvider's shards getter
    class SharedObservablePattern {
      // Private property to store the observable
      private _shards?: Observable<Shard>;

      // The property we want to test - implementation follows DynamoDBProvider's pattern
      get shards(): Observable<Shard> {
        // Return existing observable if it exists
        if (this._shards) {
          return this._shards;
        }

        // Create a new observable if it doesn't exist yet
        const subject = new Subject<Shard>();
        this._shards = subject.asObservable();
        return this._shards;
      }

      // Method to create a stream that uses the shared observable
      stream(id: string): { id: string; observable: Observable<Shard> } {
        // This stream shares the observable from the getter
        return {
          id,
          observable: this.shards,
        };
      }
    }

    test('multiple-streams', () => {
      // Create an instance of our pattern class
      const provider = new SharedObservablePattern();

      // Create multiple streams that use the shared observable
      const stream1 = provider.stream('stream-1');
      const stream2 = provider.stream('stream-2');
      const stream3 = provider.stream('stream-3');

      // All streams should have access to the same observable instance
      expect(stream1.observable).toBe(stream2.observable);
      expect(stream2.observable).toBe(stream3.observable);

      // The observable should be the same as the private property
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(stream1.observable).toBe((provider as any)._shards);
    });

    test('only-once', () => {
      const provider = new SharedObservablePattern();

      // Create a spy on the getter
      const getSpy = jest.spyOn(provider, 'shards', 'get');

      // Access the property multiple times
      const obs1 = provider.shards;
      const obs2 = provider.shards;
      const obs3 = provider.shards;

      // The getter should be called for each access
      expect(getSpy).toHaveBeenCalledTimes(3);

      // But it should return the same instance each time
      expect(obs1).toBe(obs2);
      expect(obs2).toBe(obs3);

      // The first call should have created the observable
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((provider as any)._shards).toBeDefined();

      // Further stream creations should use the existing observable
      const stream = provider.stream('new-stream');
      expect(stream.observable).toBe(obs1);
    });
  });

  describe('shard integration tests', () => {
    test('multiple-streams', async () => {
      const options: DynamoDBProviderOptions = {
        client: container.getClient(),
        hashKey: 'hashKey',
        rangeKey: 'rangeKey',
        signal: abort.signal,
        logger: console,
      };

      // Create a provider instance
      const provider = await firstValueFrom(
        DynamoDBProvider.from(testId(), options)
      );

      // Verify _shards is initially undefined
      const initial = getShardsProperty(provider);
      expect(initial).toBeUndefined();

      // Create two separate streams - this should initialize the shared observable
      const _stream1 = provider.stream('latest');
      const _stream2 = provider.stream('latest');

      // Now the _shards property should be defined
      const shards1 = getShardsProperty(provider);
      expect(shards1).toBeDefined();

      // Create a third stream and check it uses the same observable
      const _stream3 = provider.stream('latest');
      const shards2 = getShardsProperty(provider);

      // Verify the observable instance hasn't changed
      expect(shards2).toBe(shards1);
    });
  });
});
