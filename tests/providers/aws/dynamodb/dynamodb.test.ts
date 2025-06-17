import { firstValueFrom, lastValueFrom } from 'rxjs';
// import { deepEqual } from 'fast-equals';
import { DynamoDBProviderOptions } from '../../../../src';
import DynamoDBProvider from '../../../../src/providers/aws/dynamodb';
import { DynamoDBLocalContainer } from './local';
import { _Record } from '@aws-sdk/client-dynamodb-streams';

function testId(): string {
  return expect
    .getState()
    .currentTestName!.replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/--+/g, '-');
}

// Helper to access private property
// function getShardsProperty(provider: unknown): Observable<Shard> | undefined {
//   return (provider as { _shards?: Observable<Shard> })._shards;
// }

describe('aws-dynamodb', () => {
  let container: DynamoDBLocalContainer;
  let abort: AbortController = new AbortController();

  type Data = { message: string; timestamp: number };

  beforeAll(async () => {
    container = new DynamoDBLocalContainer();
    await container.start();
  });

  // beforeEach(() => {
  //   abort = new AbortController();
  // });

  // afterEach(() => {
  //   abort.abort();
  // });

  afterAll(async () => {
    abort.abort();
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

  test('stores-an-item', async () => {
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

    const testData: Data = { message: 'test', timestamp: performance.now() };
    const storedData = await lastValueFrom(instance.store(testData));

    expect(storedData).toEqual(testData);
  });

  test('streams-an-item', async () => {
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
    const stream = instance.stream('latest');

    const events: _Record[] = [];
    instance.on('event', (event) => {
      events.push(event);
    });

    const testData: Data = { message: 'test', timestamp: performance.now() };
    const storedData = await lastValueFrom(instance.store(testData));
    expect(storedData).toEqual(testData);

    await stream.stop();

    expect(events.length).toBe(1);
    expect(events[0]).toBeDefined();

    const unmarshalled = instance.unmarshall<Data>(events[0]!);

    expect(unmarshalled.message).toEqual(testData.message);
    expect(unmarshalled.timestamp).toEqual(testData.timestamp);
  });

  test('streams-an-item-shadowed', async () => {
    const options: DynamoDBProviderOptions = {
      client: container.getClient(),
      hashKey: 'hashKey',
      rangeKey: 'rangeKey',
      signal: abort.signal,
      logger: console,
    };

    const instance1 = await firstValueFrom(
      DynamoDBProvider.from(testId(), options)
    );
    const stream1 = instance1.stream('latest');

    const instance2 = await firstValueFrom(
      DynamoDBProvider.from(testId(), options)
    );
    const stream2 = instance2.stream('latest');

    const events1: _Record[] = [];
    instance1.on('event', (event) => {
      events1.push(event);
    });

    const events2: _Record[] = [];
    instance2.on('event', (event) => {
      events2.push(event);
    });

    const testData: Data = { message: 'test', timestamp: performance.now() };
    const storedData = await lastValueFrom(instance1.store(testData));
    expect(storedData).toEqual(testData);

    await stream1.stop();
    await stream2.stop();

    expect(events1).toEqual(events2);

    const unmarshalled1 = instance1.unmarshall<Data>(events1[0]!);
    const unmarshalled2 = instance1.unmarshall<Data>(events2[0]!);

    expect(unmarshalled1).toEqual(unmarshalled2);
  });

  // test('stores-items', async () => {
  //   const NUM_ITEMS = 10;

  //   const options: DynamoDBProviderOptions = {
  //     client: container.getClient(),
  //     hashKey: 'hashKey',
  //     rangeKey: 'rangeKey',
  //     signal: abort.signal,
  //     logger: console,
  //   };

  //   const instance = await firstValueFrom(
  //     DynamoDBProvider.from(testId(), options)
  //   );

  //   const testItems: Data[] = [];
  //   for (let i = 0; i < NUM_ITEMS; i++) {
  //     testItems.push({
  //       message: `test-${i}`,
  //       timestamp: performance.now() + i,
  //     });
  //   }

  //   const storedItems = await Promise.all(
  //     testItems.map((item) => lastValueFrom(instance.store(item)))
  //   );

  //   expect(storedItems.length).toEqual(testItems.length);
  //   for (let i = 0; i < NUM_ITEMS; i++) {
  //     expect(storedItems[i]).toEqual(testItems[i]);
  //   }
  // });

  // test('streams-latest-items', async () => {
  //   const NUM_ITEMS = 10;

  //   const options: DynamoDBProviderOptions = {
  //     client: container.getClient(),
  //     hashKey: 'hashKey',
  //     rangeKey: 'rangeKey',
  //     signal: abort.signal,
  //     logger: console,
  //   };

  //   const instance = await firstValueFrom(
  //     DynamoDBProvider.from(testId(), options)
  //   );
  //   const stream = instance.stream('latest');
  //   const events: _Record[] = [];

  //   instance.on('event', (event) => {
  //     console.log('!!! Event received', event);
  //     events.push(event);
  //   });

  //   const testItems: Data[] = [];
  //   for (let i = 0; i < NUM_ITEMS; i++) {
  //     testItems.push({
  //       message: `test-${i}`,
  //       timestamp: performance.now() + i,
  //     });
  //   }

  //   const storedItems = await Promise.all(
  //     testItems.map((item) => lastValueFrom(instance.store(item)))
  //   );

  //   expect(storedItems.length).toEqual(testItems.length);
  //   for (let i = 0; i < NUM_ITEMS; i++) {
  //     expect(storedItems[i]).toEqual(testItems[i]);
  //   }

  //   await stream.stop();

  //   console.log('!!! All events received', events);

  //   expect(events.length).toEqual(NUM_ITEMS);
  //   for (let i = 0; i < NUM_ITEMS; i++) {
  //     const unmarshalled = instance.unmarshall<Data>(events[i]!);
  //     expect(unmarshalled.message).toEqual(testItems[i]?.message);
  //     expect(unmarshalled.timestamp).toEqual(testItems[i]?.timestamp);
  //   }
  // });

  // test('streams-latest-items', async () => {
  //   const NUM_ITEMS = 10;

  //   const options: DynamoDBProviderOptions = {
  //     client: container.getClient(),
  //     hashKey: 'hashKey',
  //     rangeKey: 'rangeKey',
  //     logger: console,
  //   };

  //   // Create two providers with the same table name to test shared streams
  //   const provider1 = await firstValueFrom(
  //     DynamoDBProvider.from(testId(), options)
  //   );
  //   const provider2 = await firstValueFrom(
  //     DynamoDBProvider.from(testId(), options)
  //   );

  //   // Create event collectors for both providers
  //   const events1: _Record[] = [];
  //   const events2: _Record[] = [];

  //   // Set up event handlers for both providers
  //   provider1.on('event', (event) => {
  //     events1.push(event);
  //   });

  //   provider2.on('event', (event) => {
  //     events2.push(event);
  //   });

  //   // Setup streams for both providers
  //   // Only store items on the first provider
  //   const stream1 = provider1.stream('latest');
  //   const stream2 = provider2.stream('latest');

  //   type Data = {
  //     message: string;
  //     timestamp: number;
  //   };

  //   // Store 5 items only using the first provider
  //   const testItems = [];
  //   for (let i = 0; i < NUM_ITEMS; i++) {
  //     const item: Data = {
  //       message: `stream-test-${i}`,
  //       timestamp: performance.now() + i,
  //     };
  //     testItems.push(item);
  //   }

  //   const storedItems = await Promise.all(
  //     testItems.map((item) => lastValueFrom(provider1.store(item)))
  //   );

  //   expect(storedItems.length).toEqual(testItems.length);

  //   await stream1.stop();
  //   await stream2.stop();

  //   // Both streams should have received the same events
  //   expect(events1.length).toEqual(events2.length);
  //   expect(events1.length).toEqual(NUM_ITEMS);
  //   expect(events2.length).toEqual(NUM_ITEMS);

  //   // Events should be in the same order
  //   for (let i = 0; i < NUM_ITEMS; i++) {
  //     const data1 = provider1.unmarshall<Data>(events1[i]!);
  //     const data2 = provider2.unmarshall<Data>(events2[i]!);

  //     expect(deepEqual(data1, data2)).toBe(true);

  //     expect(deepEqual(data1, testItems[i])).toBe(true);
  //     expect(deepEqual(data1, storedItems[i])).toBe(true);

  //     expect(deepEqual(data2, testItems[i])).toBe(true);
  //     expect(deepEqual(data2, storedItems[i])).toBe(true);
  //   }
  // });

  // describe('shard-observation', () => {
  //   // Create a class that mimics the behavior of DynamoDBProvider's shards getter
  //   class SharedObservablePattern {
  //     // Private property to store the observable
  //     private _shards?: Observable<Shard>;

  //     // The property we want to test - implementation follows DynamoDBProvider's pattern
  //     get shards(): Observable<Shard> {
  //       // Return existing observable if it exists
  //       if (this._shards) {
  //         return this._shards;
  //       }

  //       // Create a new observable if it doesn't exist yet
  //       const subject = new Subject<Shard>();
  //       this._shards = subject.asObservable();
  //       return this._shards;
  //     }

  //     // Method to create a stream that uses the shared observable
  //     stream(id: string): { id: string; observable: Observable<Shard> } {
  //       // This stream shares the observable from the getter
  //       return {
  //         id,
  //         observable: this.shards,
  //       };
  //     }
  //   }

  //   test('multiple-streams', () => {
  //     // Create an instance of our pattern class
  //     const provider = new SharedObservablePattern();

  //     // Create multiple streams that use the shared observable
  //     const stream1 = provider.stream('stream-1');
  //     const stream2 = provider.stream('stream-2');
  //     const stream3 = provider.stream('stream-3');

  //     // All streams should have access to the same observable instance
  //     expect(stream1.observable).toBe(stream2.observable);
  //     expect(stream2.observable).toBe(stream3.observable);

  //     // The observable should be the same as the private property
  //     // Use type assertion to access the private property
  //     expect(stream1.observable).toBe(
  //       (provider as unknown as { _shards?: Observable<Shard> })._shards
  //     );
  //   });

  //   test('only-once', () => {
  //     const provider = new SharedObservablePattern();

  //     // Create a spy on the getter
  //     const getSpy = jest.spyOn(
  //       provider as unknown as { shards: Observable<Shard> },
  //       'shards',
  //       'get'
  //     );

  //     // Access the property multiple times
  //     const obs1 = provider.shards;
  //     const obs2 = provider.shards;
  //     const obs3 = provider.shards;

  //     // The getter should be called for each access
  //     expect(getSpy).toHaveBeenCalledTimes(3);

  //     // But it should return the same instance each time
  //     expect(obs1).toBe(obs2);
  //     expect(obs2).toBe(obs3);

  //     // The first call should have created the observable
  //     expect(getShardsProperty(provider)).toBeDefined();

  //     // Further stream creations should use the existing observable
  //     const stream = provider.stream('new-stream');
  //     expect(stream.observable).toBe(obs1);
  //   });
  // });

  // describe('shard integration tests', () => {
  //   test('multiple-streams', async () => {
  //     const options: DynamoDBProviderOptions = {
  //       client: container.getClient(),
  //       hashKey: 'hashKey',
  //       rangeKey: 'rangeKey',
  //       signal: abort.signal,
  //       logger: console,
  //     };

  //     // Create a provider instance
  //     const provider = await firstValueFrom(
  //       DynamoDBProvider.from(testId(), options)
  //     );

  //     // Verify _shards is initially undefined
  //     const initial = getShardsProperty(provider);
  //     expect(initial).toBeUndefined();

  //     // Create two separate streams - this should initialize the shared observable
  //     const _stream1 = provider.stream('latest');
  //     const _stream2 = provider.stream('latest');

  //     // Now the _shards property should be defined
  //     const shards1 = getShardsProperty(provider);
  //     expect(shards1).toBeDefined();

  //     // Create a third stream and check it uses the same observable
  //     const _stream3 = provider.stream('latest');
  //     const shards2 = getShardsProperty(provider);

  //     // Verify the observable instance hasn't changed
  //     expect(shards2).toBe(shards1);
  //   });
  // });
});
