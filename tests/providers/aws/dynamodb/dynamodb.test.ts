import { firstValueFrom, lastValueFrom } from 'rxjs';
// import { deepEqual } from 'fast-equals';
import { DynamoDBLocalContainer } from './local';
import { _Record, Shard } from '@aws-sdk/client-dynamodb-streams';
import { testId } from '../../../setup';
import { DynamoDBProvider, DynamoDBProviderOptions } from '../../../../src';

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
      // logger: console,
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
      // logger: console,
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
      // logger: console,
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
      // logger: console,
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
      // logger: console,
    };

    const instance = await firstValueFrom(
      DynamoDBProvider.from(testId(), options)
    );
    const stream = instance.stream();

    const events: _Record[] = [];
    instance.on('streamEvent', (event) => {
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
      // logger: console,
    };

    const instance1 = await firstValueFrom(
      DynamoDBProvider.from(testId(), options)
    );
    const stream1 = instance1.stream();

    const instance2 = await firstValueFrom(
      DynamoDBProvider.from(testId(), options)
    );
    const stream2 = instance2.stream();

    const events1: _Record[] = [];
    instance1.on('streamEvent', (event) => {
      events1.push(event);
    });

    const events2: _Record[] = [];
    instance2.on('streamEvent', (event) => {
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
      // logger: console,
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

  test('global-abort-cascades', async () => {
    const testAbort = new AbortController();
    const options: DynamoDBProviderOptions = {
      client: container.getClient(),
      hashKey: 'hashKey',
      rangeKey: 'rangeKey',
      signal: testAbort.signal,
      // logger: console,
    };

    // Create multiple instances
    const instance1 = await firstValueFrom(
      DynamoDBProvider.from(`${testId()}-1`, options)
    );
    const instance2 = await firstValueFrom(
      DynamoDBProvider.from(`${testId()}-2`, options)
    );
    const instance3 = await firstValueFrom(
      DynamoDBProvider.from(`${testId()}-3`, options)
    );

    const instances = [instance1, instance2, instance3];

    // Start streams for all instances
    const streamControllers = instances.map((instance) => instance.stream());

    // Track stream events for all instances
    const streamStarted = [false, false, false];
    const streamStopped = [false, false, false];

    instances.forEach((instance, index) => {
      instance.on('streamStart', () => {
        streamStarted[index] = true;
      });

      instance.on('streamStop', () => {
        streamStopped[index] = true;
      });
    });

    // Wait for all streams to start
    await Promise.all(
      instances.map(
        (instance, index) =>
          new Promise<void>((resolve) => {
            if (streamStarted[index]) {
              resolve();
            } else {
              instance.once('streamStart', () => resolve());
            }
          })
      )
    );

    // Verify all streams are started
    expect(streamStarted).toEqual([true, true, true]);
    expect(streamStopped).toEqual([false, false, false]);

    // Now abort the global controller
    testAbort.abort('test abort');

    // Wait for all streams to stop
    await Promise.all(
      instances.map(
        (instance, index) =>
          new Promise<void>((resolve) => {
            if (streamStopped[index]) {
              resolve();
            } else {
              instance.once('streamStop', () => resolve());
              // Also set a timeout in case it doesn't stop
              setTimeout(resolve, 500);
            }
          })
      )
    );

    // Verify that all streams were stopped
    expect(streamStopped).toEqual([true, true, true]);

    // Verify all stream controller signals are aborted
    streamControllers.forEach((controller) => {
      expect(controller.signal.aborted).toBe(true);
    });

    // Verify all providers' internal signals are aborted
    instances.forEach((instance) => {
      expect(instance['signal'].aborted).toBe(true);
    });
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
      // logger: console,
      pollInterval: 1000, // 1 second for faster testing
    };

    const provider = await firstValueFrom(
      DynamoDBProvider.from(testId(), options)
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any)._streamClient = mockStreamClient;

    const emittedShards: Shard[] = [];
    const subscription = provider.getShards(abort.signal).subscribe((shard) => {
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
