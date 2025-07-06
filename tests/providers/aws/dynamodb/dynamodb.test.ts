import { DynamoDB, DynamoDBOptions } from '@providers';
import { DynamoDBLocalContainer } from './local';
import { testId } from '../../../setup';
import { firstValueFrom } from 'rxjs';
import { _Record, Shard } from '@aws-sdk/client-dynamodb-streams';

describe('aws-dynamodb', () => {
  let container: DynamoDBLocalContainer;
  let options: DynamoDBOptions;
  type Data = { message: string; timestamp: number };

  beforeAll(async () => {
    container = new DynamoDBLocalContainer(console);
    await container.start();
    options = {
      client: container.getClient(),
    };
  });

  beforeEach(() => {});

  afterEach(() => {});

  afterAll(async () => {
    if (container) {
      await container.stop();
    }
  });

  test('is-a-singleton', async () => {
    const instance1$ = DynamoDB.from(testId(), options);
    const instance2$ = DynamoDB.from(testId(), options);
    const instance1 = await firstValueFrom(instance1$);
    const instance2 = await firstValueFrom(instance2$);
    expect(instance1).toBe(instance2);
    expect(instance1.tableName).toBe(`cloudrx-${testId()}`);
    expect(instance2.tableName).toBe(`cloudrx-${testId()}`);
  });

  test('sets-table-arn', async () => {
    const instance = await firstValueFrom(DynamoDB.from(testId(), options));
    expect(instance.tableArn).toBeDefined();
  });

  test('sets-stream-arn', async () => {
    const instance = await firstValueFrom(DynamoDB.from(testId(), options));
    expect(instance.streamArn).toBeDefined();
  });

  test('stores-an-item', async () => {
    const instance = await firstValueFrom(DynamoDB.from(testId(), options));
    const testData: Data = { message: 'test', timestamp: performance.now() };
    const storedData = await firstValueFrom(instance.store(testData));
    expect(storedData).toEqual(testData);
  });

  test('stores-items', async () => {
    const NUM_ITEMS = 20;

    const instance = await firstValueFrom(DynamoDB.from(testId(), options));
    const testItems: Data[] = [];
    for (let i = 0; i < NUM_ITEMS; i++) {
      testItems.push({
        message: `test-${i}`,
        timestamp: performance.now() + i,
      });
    }

    const storedItems = await Promise.all(
      testItems.map((item) => firstValueFrom(instance.store(item)))
    );

    expect(storedItems.length).toEqual(testItems.length);

    console.log('!!! Test items:', testItems);
    console.log('!!! Stored items:', storedItems);

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

    const options: DynamoDBOptions = {
      client: container.getClient(),
      pollInterval: 1000, // 1 second for faster testing
    };

    const provider = await firstValueFrom(DynamoDB.from(testId(), options));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any)._streamClient = mockStreamClient;
    const emittedShards: Shard[] = [];
    const subscription = provider.shards.subscribe((shard) => {
      emittedShards.push(shard);
    });

    await new Promise((resolve) => setTimeout(resolve, 6000)); // 6 seconds with 1s poll = 6 cycles

    subscription.unsubscribe();
    expect(emittedShards).toHaveLength(3);
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
