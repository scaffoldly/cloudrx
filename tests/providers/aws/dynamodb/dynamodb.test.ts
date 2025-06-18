import { firstValueFrom, lastValueFrom } from 'rxjs';
// import { deepEqual } from 'fast-equals';
import { DynamoDBLocalContainer } from './local';
import { _Record, Shard } from '@aws-sdk/client-dynamodb-streams';
import { testId } from '../../../setup';
import { DynamoDBProvider, DynamoDBProviderOptions } from '../../../../src';

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

  test('stores-items', async () => {
    const NUM_ITEMS = 10;

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

    const testItems: Data[] = [];
    for (let i = 0; i < NUM_ITEMS; i++) {
      testItems.push({
        message: `test-${i}`,
        timestamp: performance.now() + i,
      });
    }

    const storedItems = await Promise.all(
      testItems.map((item) => lastValueFrom(instance.store(item)))
    );

    expect(storedItems.length).toEqual(testItems.length);
    for (let i = 0; i < NUM_ITEMS; i++) {
      expect(storedItems[i]).toEqual(testItems[i]);
    }
  });

  test('shard-emits-once', async () => {
    const mockStreamClient = {
      send: jest.fn(),
    };

    const shard1 = {
      ShardId: 'shard-1',
      SequenceNumberRange: { StartingSequenceNumber: '1' },
    };
    const shard2 = {
      ShardId: 'shard-2',
      SequenceNumberRange: { StartingSequenceNumber: '2' },
    };
    const shard3 = {
      ShardId: 'shard-3',
      SequenceNumberRange: { StartingSequenceNumber: '3' },
    };

    mockStreamClient.send
      .mockResolvedValueOnce({ StreamDescription: { Shards: [shard1] } })
      .mockResolvedValueOnce({
        StreamDescription: { Shards: [shard1, shard2] },
      })
      .mockResolvedValueOnce({
        StreamDescription: { Shards: [shard1, shard2] },
      })
      .mockResolvedValueOnce({
        StreamDescription: { Shards: [shard1, shard2, shard3] },
      })
      .mockResolvedValue({
        StreamDescription: { Shards: [shard1, shard2, shard3] },
      });

    const options: DynamoDBProviderOptions = {
      client: container.getClient(),
      hashKey: 'hashKey',
      rangeKey: 'rangeKey',
      signal: abort.signal,
      logger: console,
      pollInterval: 1000, // 1 second for faster testing
    };

    const provider = await firstValueFrom(
      DynamoDBProvider.from(testId(), options)
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any)._streamClient = mockStreamClient;

    const emittedShards: Shard[] = [];
    const subscription = provider.shards.subscribe((shard) => {
      emittedShards.push(shard);
    });

    await new Promise((resolve) => setTimeout(resolve, 6000)); // 6 seconds with 1s poll = 6 cycles

    subscription.unsubscribe();

    // Should emit exactly 3 shards total
    expect(emittedShards).toHaveLength(3);

    // Should emit each shard ID exactly once
    expect(emittedShards.filter((s) => s.ShardId === 'shard-1')).toHaveLength(
      1
    );
    expect(emittedShards.filter((s) => s.ShardId === 'shard-2')).toHaveLength(
      1
    );
    expect(emittedShards.filter((s) => s.ShardId === 'shard-3')).toHaveLength(
      1
    );

    // Verify the shard IDs are the expected ones
    const shardIds = emittedShards.map((s) => s.ShardId).sort();
    expect(shardIds).toEqual(['shard-1', 'shard-2', 'shard-3']);
  });
});
