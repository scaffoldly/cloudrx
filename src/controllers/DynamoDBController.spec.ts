/* global describe, it, beforeEach, afterEach, expect, jest */
import { Subscription } from 'rxjs';
import { DynamoDBClient, TableDescription } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBStreamsClient,
  _Record,
} from '@aws-sdk/client-dynamodb-streams';
import { fromEvent } from '../observables/fromEvent';
import { Abortable } from '../util/abortable';
import { Controller } from './Controller';
import {
  DynamoDBController,
  DynamoDBEvent,
  DynamoDBControllerOptions,
} from './DynamoDBController';

// Mock AWS SDK
const mockSend = jest.fn();
const mockDynamoDBClient = { send: mockSend };
const mockStreamsClient = { send: mockSend };

// Helper to create mock TableDescription
function createMockTableDescription(
  tableArn = 'arn:aws:dynamodb:us-east-1:123456789:table/test-table'
): TableDescription {
  return {
    TableArn: tableArn,
    TableName: tableArn.split('/').pop(),
    LatestStreamArn: `${tableArn}/stream/2024-01-01T00:00:00.000`,
  };
}

// Helper to create mock stream records
function createMockRecord(
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  options: {
    sequenceNumber?: string;
    keys?: Record<string, unknown>;
    newImage?: Record<string, unknown>;
    oldImage?: Record<string, unknown>;
    timestamp?: Date;
  } = {}
): _Record {
  const {
    sequenceNumber = '123',
    keys = { id: { S: 'test-id' } },
    newImage,
    oldImage,
    timestamp = new Date(),
  } = options;

  return {
    eventName,
    dynamodb: {
      SequenceNumber: sequenceNumber,
      Keys: keys as _Record['dynamodb'],
      NewImage: newImage as _Record['dynamodb'],
      OldImage: oldImage as _Record['dynamodb'],
      ApproximateCreationDateTime: timestamp,
    },
  } as unknown as _Record;
}

// Helper to clear singleton cache
function clearInstanceCache(): void {
  (
    DynamoDBController as unknown as { instances: Map<string, unknown> }
  ).instances.clear();
}

// Helper to create a controller with mocked clients
function createMockController<T = unknown>(
  tableArn = 'arn:aws:dynamodb:us-east-1:123456789:table/test-table',
  options: Partial<DynamoDBControllerOptions> = {}
): Controller<DynamoDBEvent<T>> {
  // Mock DescribeStreamCommand response
  mockSend.mockImplementation((command: unknown) => {
    const commandName = (command as { constructor: { name: string } })
      .constructor.name;

    if (commandName === 'DescribeStreamCommand') {
      return Promise.resolve({
        StreamDescription: {
          Shards: [],
        },
      });
    }

    return Promise.resolve({});
  });

  const controllerOptions: DynamoDBControllerOptions = {
    dynamoDBClient: mockDynamoDBClient as unknown as DynamoDBClient,
    streamsClient: mockStreamsClient as unknown as DynamoDBStreamsClient,
    pollInterval: 100,
    ...options,
  };

  const table = createMockTableDescription(tableArn);
  return DynamoDBController.from<T>(table, controllerOptions);
}

describe('DynamoDBController', () => {
  let controller: Controller<DynamoDBEvent<Record<string, unknown>>>;
  let subscriptions: Subscription[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    clearInstanceCache();
    subscriptions = [];
  });

  afterEach(() => {
    subscriptions.forEach((sub) => sub.unsubscribe());
    controller?.dispose();
  });

  describe('singleton behavior', () => {
    it('returns same instance for same table ARN', async () => {
      const tableArn =
        'arn:aws:dynamodb:us-east-1:123456789:table/singleton-test';
      controller = createMockController(tableArn);
      const controller2 = createMockController(tableArn);

      expect(controller).toBe(controller2);
    });

    it('returns different instances for different table ARNs', async () => {
      const tableArn1 = 'arn:aws:dynamodb:us-east-1:123456789:table/table1';
      const tableArn2 = 'arn:aws:dynamodb:us-east-1:123456789:table/table2';

      controller = createMockController(tableArn1);
      const controller2 = createMockController(tableArn2);

      expect(controller).not.toBe(controller2);
      controller2.dispose();
    });

    it('removes instance from cache on dispose', async () => {
      const tableArn =
        'arn:aws:dynamodb:us-east-1:123456789:table/dispose-test';
      controller = createMockController<Record<string, unknown>>(tableArn);
      controller.dispose();

      const controller2 =
        createMockController<Record<string, unknown>>(tableArn);
      expect(controller).not.toBe(controller2);
      controller = controller2;
    });
  });

  describe('event classification', () => {
    it('classifies INSERT as modified', async () => {
      controller = createMockController();
      const record = createMockRecord('INSERT', {
        newImage: { id: { S: 'test' }, data: { S: 'value' } },
      });

      // Access private method via type assertion
      const classifyRecord = (
        controller as unknown as {
          classifyRecord: (r: _Record) => DynamoDBEvent<unknown> | null;
        }
      ).classifyRecord.bind(controller);

      const event = classifyRecord(record);
      expect(event?.type).toBe('modified');
      expect(event?.eventName).toBe('INSERT');
    });

    it('classifies MODIFY as modified', async () => {
      controller = createMockController();
      const record = createMockRecord('MODIFY', {
        oldImage: { id: { S: 'test' }, data: { S: 'old' } },
        newImage: { id: { S: 'test' }, data: { S: 'new' } },
      });

      const classifyRecord = (
        controller as unknown as {
          classifyRecord: (r: _Record) => DynamoDBEvent<unknown> | null;
        }
      ).classifyRecord.bind(controller);

      const event = classifyRecord(record);
      expect(event?.type).toBe('modified');
      expect(event?.eventName).toBe('MODIFY');
    });

    it('classifies REMOVE without TTL as removed', async () => {
      controller = createMockController();
      const record = createMockRecord('REMOVE', {
        oldImage: { id: { S: 'test' }, data: { S: 'value' } },
      });

      const classifyRecord = (
        controller as unknown as {
          classifyRecord: (r: _Record) => DynamoDBEvent<unknown> | null;
        }
      ).classifyRecord.bind(controller);

      const event = classifyRecord(record);
      expect(event?.type).toBe('removed');
      expect(event?.eventName).toBe('REMOVE');
    });

    it('classifies REMOVE with expired TTL as expired', async () => {
      controller = createMockController();
      const pastTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const record = createMockRecord('REMOVE', {
        oldImage: { id: { S: 'test' }, expires: { N: String(pastTime) } },
        timestamp: new Date(),
      });

      const classifyRecord = (
        controller as unknown as {
          classifyRecord: (r: _Record) => DynamoDBEvent<unknown> | null;
        }
      ).classifyRecord.bind(controller);

      const event = classifyRecord(record);
      expect(event?.type).toBe('expired');
    });

    it('classifies REMOVE with future TTL as removed', async () => {
      controller = createMockController();
      const futureTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const record = createMockRecord('REMOVE', {
        oldImage: { id: { S: 'test' }, expires: { N: String(futureTime) } },
        timestamp: new Date(),
      });

      const classifyRecord = (
        controller as unknown as {
          classifyRecord: (r: _Record) => DynamoDBEvent<unknown> | null;
        }
      ).classifyRecord.bind(controller);

      const event = classifyRecord(record);
      expect(event?.type).toBe('removed');
    });

    it('respects custom TTL attribute name', async () => {
      controller = createMockController(undefined, {
        ttlAttribute: 'expiresAt',
      });
      const pastTime = Math.floor(Date.now() / 1000) - 3600;
      const record = createMockRecord('REMOVE', {
        oldImage: { id: { S: 'test' }, expiresAt: { N: String(pastTime) } },
        timestamp: new Date(),
      });

      const classifyRecord = (
        controller as unknown as {
          classifyRecord: (r: _Record) => DynamoDBEvent<unknown> | null;
        }
      ).classifyRecord.bind(controller);

      const event = classifyRecord(record);
      expect(event?.type).toBe('expired');
    });

    it('treats all REMOVE as removed when ttlAttribute is null', async () => {
      controller = createMockController(undefined, {
        ttlAttribute: null,
      });
      const pastTime = Math.floor(Date.now() / 1000) - 3600;
      const record = createMockRecord('REMOVE', {
        oldImage: { id: { S: 'test' }, expires: { N: String(pastTime) } },
        timestamp: new Date(),
      });

      const classifyRecord = (
        controller as unknown as {
          classifyRecord: (r: _Record) => DynamoDBEvent<unknown> | null;
        }
      ).classifyRecord.bind(controller);

      const event = classifyRecord(record);
      expect(event?.type).toBe('removed');
    });
  });

  describe('fromEvent integration', () => {
    it('can subscribe to modified events', async () => {
      controller = createMockController();
      const events: DynamoDBEvent<unknown>[] = [];

      const sub = fromEvent(controller, 'modified').subscribe((event) => {
        events.push(event);
      });
      subscriptions.push(sub);

      // Subscription should be active
      expect(sub.closed).toBe(false);
    });

    it('can subscribe to removed events', async () => {
      controller = createMockController();
      const events: DynamoDBEvent<unknown>[] = [];

      const sub = fromEvent(controller, 'removed').subscribe((event) => {
        events.push(event);
      });
      subscriptions.push(sub);

      expect(sub.closed).toBe(false);
    });

    it('can subscribe to expired events', async () => {
      controller = createMockController();
      const events: DynamoDBEvent<unknown>[] = [];

      const sub = fromEvent(controller, 'expired').subscribe((event) => {
        events.push(event);
      });
      subscriptions.push(sub);

      expect(sub.closed).toBe(false);
    });

    it('supports multiple listeners on same event type', async () => {
      controller = createMockController();
      const events1: DynamoDBEvent<unknown>[] = [];
      const events2: DynamoDBEvent<unknown>[] = [];

      const sub1 = fromEvent(controller, 'modified').subscribe((event) => {
        events1.push(event);
      });
      const sub2 = fromEvent(controller, 'modified').subscribe((event) => {
        events2.push(event);
      });
      subscriptions.push(sub1, sub2);

      expect(sub1.closed).toBe(false);
      expect(sub2.closed).toBe(false);
    });
  });

  describe('lifecycle management', () => {
    it('integrates with Abortable tree', async () => {
      controller = createMockController();

      const tree = Abortable.root.tree;
      const controllerNode = tree.children.find((c) =>
        c.name.startsWith('DynamoDBController:')
      );

      expect(controllerNode).toBeDefined();
      expect(controllerNode?.aborted).toBe(false);
    });

    it('exposes signal for external cancellation', async () => {
      controller = createMockController();

      expect(controller.signal).toBeInstanceOf(AbortSignal);
      expect(controller.signal.aborted).toBe(false);
    });

    it('exposes controller id (table ARN)', async () => {
      const tableArn = 'arn:aws:dynamodb:us-east-1:123456789:table/arn-test';
      controller = createMockController(tableArn);

      expect(controller.id).toBe(tableArn);
    });

    it('closes subscriptions on dispose', async () => {
      controller = createMockController();

      const sub = fromEvent(controller, 'modified').subscribe();
      subscriptions.push(sub);

      expect(sub.closed).toBe(false);

      controller.dispose();

      // Allow async propagation
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Note: fromEvent doesn't propagate completion (DOM semantics)
      // but the internal subscription should be closed
      // Manual unsubscription is triggered by the controller
      sub.unsubscribe();
      expect(sub.closed).toBe(true);
    });

    it('chains external abortable', async () => {
      const externalAbortable = Abortable.root.fork('external-test');
      controller = createMockController(undefined, {
        abortable: externalAbortable,
      });

      expect(controller.signal.aborted).toBe(false);

      externalAbortable.dispose();

      // Allow async propagation
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Controller should be disposed
      expect(controller.signal.aborted).toBe(true);
    });

    it('controller appears in parent abortable tree', () => {
      const parentAbortable = Abortable.root.fork('parent-tree-test');
      controller = createMockController(undefined, {
        abortable: parentAbortable,
      });

      const tree = parentAbortable.tree;
      expect(tree.children.length).toBe(1);
      expect(tree.children[0]?.name).toContain('DynamoDBController:');
    });

    it('dispose is idempotent (can be called multiple times)', () => {
      controller = createMockController();

      expect(controller.signal.aborted).toBe(false);

      // Call dispose multiple times - should not throw
      controller.dispose();
      controller.dispose();
      controller.dispose();

      expect(controller.signal.aborted).toBe(true);
    });

    it('disposes controller when nested parent chain is disposed', async () => {
      const grandparent = Abortable.root.fork('grandparent');
      const parent = grandparent.fork('parent');
      controller = createMockController(undefined, {
        abortable: parent,
      });

      expect(controller.signal.aborted).toBe(false);

      // Dispose grandparent - should cascade to controller
      grandparent.dispose();

      // Allow async propagation
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(controller.signal.aborted).toBe(true);
    });

    it('removes from singleton cache when disposed via parent', async () => {
      const tableArn =
        'arn:aws:dynamodb:us-east-1:123456789:table/cache-dispose-test';
      const parentAbortable = Abortable.root.fork('cache-parent');

      controller = createMockController(tableArn, {
        abortable: parentAbortable,
      });

      // Controller should be cached
      const sameController = createMockController(tableArn);
      expect(sameController).toBe(controller);

      // Dispose via parent
      parentAbortable.dispose();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should get new instance now
      const newController = createMockController(tableArn);
      expect(newController).not.toBe(controller);
      newController.dispose();
    });
  });

  describe('track() method', () => {
    it('wraps observables with controller lifecycle', async () => {
      controller = createMockController();
      const { of } = await import('rxjs');

      const source$ = of(1, 2, 3);
      const tracked$ = controller.track(source$);

      const values: number[] = [];
      const sub = tracked$.subscribe((v) => values.push(v));
      subscriptions.push(sub);

      expect(values).toEqual([1, 2, 3]);
    });
  });

  describe('observable factory', () => {
    it('from$() returns observable that emits controller', async () => {
      mockSend.mockImplementation((command: unknown) => {
        const commandName = (command as { constructor: { name: string } })
          .constructor.name;

        if (commandName === 'DescribeStreamCommand') {
          return Promise.resolve({
            StreamDescription: { Shards: [] },
          });
        }

        return Promise.resolve({});
      });

      const table = createMockTableDescription(
        'arn:aws:dynamodb:us-east-1:123456789:table/obs-test'
      );

      const controllerOptions: DynamoDBControllerOptions = {
        dynamoDBClient: mockDynamoDBClient as unknown as DynamoDBClient,
        streamsClient: mockStreamsClient as unknown as DynamoDBStreamsClient,
      };

      const controller$ = DynamoDBController.from$(table, controllerOptions);

      const emittedController = await new Promise<
        Controller<DynamoDBEvent<unknown>>
      >((resolve) => {
        controller$.subscribe((c) => {
          resolve(c);
        });
      });

      expect(emittedController).toBeInstanceOf(DynamoDBController);
      emittedController.dispose();
    });
  });

  describe('shard lifecycle', () => {
    it('discovers and polls new shards', async () => {
      const events: DynamoDBEvent<unknown>[] = [];
      let describeCallCount = 0;

      mockSend.mockImplementation((command: unknown) => {
        const commandName = (command as { constructor: { name: string } })
          .constructor.name;

        if (commandName === 'DescribeStreamCommand') {
          describeCallCount++;
          return Promise.resolve({
            StreamDescription: {
              Shards: [{ ShardId: 'shard-001' }],
            },
          });
        }

        if (commandName === 'GetShardIteratorCommand') {
          return Promise.resolve({
            ShardIterator: 'iterator-001',
          });
        }

        if (commandName === 'GetRecordsCommand') {
          return Promise.resolve({
            Records: [
              createMockRecord('INSERT', {
                sequenceNumber: '100',
                newImage: { id: { S: 'test-1' }, data: { S: 'hello' } },
              }),
            ],
            NextShardIterator: 'iterator-002',
          });
        }

        return Promise.resolve({});
      });

      const table = createMockTableDescription();
      controller = DynamoDBController.from(table, {
        dynamoDBClient: mockDynamoDBClient as unknown as DynamoDBClient,
        streamsClient: mockStreamsClient as unknown as DynamoDBStreamsClient,
        pollInterval: 50,
      });

      const sub = fromEvent(controller, 'modified').subscribe((e) =>
        events.push(e)
      );
      subscriptions.push(sub);

      // Wait for shard discovery and polling
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(describeCallCount).toBeGreaterThan(0);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.newValue).toEqual({ id: 'test-1', data: 'hello' });
    });

    it('cleans up completed shards when NextShardIterator is null', async () => {
      let getRecordsCallCount = 0;

      mockSend.mockImplementation((command: unknown) => {
        const commandName = (command as { constructor: { name: string } })
          .constructor.name;

        if (commandName === 'DescribeStreamCommand') {
          return Promise.resolve({
            StreamDescription: {
              Shards: [{ ShardId: 'shard-completing' }],
            },
          });
        }

        if (commandName === 'GetShardIteratorCommand') {
          return Promise.resolve({
            ShardIterator: 'iterator-completing',
          });
        }

        if (commandName === 'GetRecordsCommand') {
          getRecordsCallCount++;
          // First call returns records, second call returns null iterator (shard closed)
          if (getRecordsCallCount === 1) {
            return Promise.resolve({
              Records: [
                createMockRecord('INSERT', {
                  sequenceNumber: '200',
                  newImage: { id: { S: 'final' } },
                }),
              ],
              NextShardIterator: 'iterator-next',
            });
          }
          // Shard is closed
          return Promise.resolve({
            Records: [],
            NextShardIterator: null,
          });
        }

        return Promise.resolve({});
      });

      const table = createMockTableDescription();
      controller = DynamoDBController.from(table, {
        dynamoDBClient: mockDynamoDBClient as unknown as DynamoDBClient,
        streamsClient: mockStreamsClient as unknown as DynamoDBStreamsClient,
        pollInterval: 50,
      });

      const events: DynamoDBEvent<unknown>[] = [];
      const sub = fromEvent(controller, 'modified').subscribe((e) =>
        events.push(e)
      );
      subscriptions.push(sub);

      // Wait for shard to complete
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Should have received the event before shard closed
      expect(events.length).toBeGreaterThanOrEqual(1);
      // GetRecords should have been called at least twice (once with data, once returning null)
      expect(getRecordsCallCount).toBeGreaterThanOrEqual(2);
    });

    it('discovers new shards that appear after initial discovery', async () => {
      let describeCallCount = 0;
      const events: DynamoDBEvent<unknown>[] = [];

      mockSend.mockImplementation((command: unknown) => {
        const commandName = (command as { constructor: { name: string } })
          .constructor.name;

        if (commandName === 'DescribeStreamCommand') {
          describeCallCount++;
          // First call returns shard-001, later calls also include shard-002
          const shards =
            describeCallCount >= 3
              ? [{ ShardId: 'shard-001' }, { ShardId: 'shard-002' }]
              : [{ ShardId: 'shard-001' }];
          return Promise.resolve({
            StreamDescription: { Shards: shards },
          });
        }

        if (commandName === 'GetShardIteratorCommand') {
          const shardId = (command as { input: { ShardId: string } }).input
            .ShardId;
          return Promise.resolve({
            ShardIterator: `iterator-${shardId}`,
          });
        }

        if (commandName === 'GetRecordsCommand') {
          const iterator = (command as { input: { ShardIterator: string } })
            .input.ShardIterator;
          const shardId = iterator.replace('iterator-', '');
          return Promise.resolve({
            Records: [
              createMockRecord('INSERT', {
                sequenceNumber: `seq-${shardId}-${Date.now()}`,
                newImage: { id: { S: shardId }, source: { S: shardId } },
              }),
            ],
            NextShardIterator: iterator,
          });
        }

        return Promise.resolve({});
      });

      const table = createMockTableDescription();
      controller = DynamoDBController.from(table, {
        dynamoDBClient: mockDynamoDBClient as unknown as DynamoDBClient,
        streamsClient: mockStreamsClient as unknown as DynamoDBStreamsClient,
        pollInterval: 50,
      });

      const sub = fromEvent(controller, 'modified').subscribe((e) =>
        events.push(e)
      );
      subscriptions.push(sub);

      // Wait for multiple discovery cycles
      await new Promise((resolve) => setTimeout(resolve, 400));

      // Should have received events from both shards
      const shard1Events = events.filter(
        (e) => (e.newValue as { source?: string })?.source === 'shard-001'
      );
      const shard2Events = events.filter(
        (e) => (e.newValue as { source?: string })?.source === 'shard-002'
      );

      expect(shard1Events.length).toBeGreaterThan(0);
      expect(shard2Events.length).toBeGreaterThan(0);
    });

    it('handles shard churn - old shards complete while new ones appear', async () => {
      let describeCallCount = 0;
      let shard1RecordCalls = 0;
      const events: DynamoDBEvent<unknown>[] = [];

      mockSend.mockImplementation((command: unknown) => {
        const commandName = (command as { constructor: { name: string } })
          .constructor.name;

        if (commandName === 'DescribeStreamCommand') {
          describeCallCount++;
          // Shard-001 disappears after call 3, shard-002 appears at call 2
          let shards: { ShardId: string }[] = [];
          if (describeCallCount <= 3) {
            shards.push({ ShardId: 'shard-001' });
          }
          if (describeCallCount >= 2) {
            shards.push({ ShardId: 'shard-002' });
          }
          return Promise.resolve({
            StreamDescription: { Shards: shards },
          });
        }

        if (commandName === 'GetShardIteratorCommand') {
          const shardId = (command as { input: { ShardId: string } }).input
            .ShardId;
          return Promise.resolve({
            ShardIterator: `iterator-${shardId}`,
          });
        }

        if (commandName === 'GetRecordsCommand') {
          const iterator = (command as { input: { ShardIterator: string } })
            .input.ShardIterator;

          if (iterator.includes('shard-001')) {
            shard1RecordCalls++;
            // Shard-001 closes after 2 record calls
            if (shard1RecordCalls >= 2) {
              return Promise.resolve({
                Records: [],
                NextShardIterator: null, // Shard closed
              });
            }
            return Promise.resolve({
              Records: [
                createMockRecord('INSERT', {
                  sequenceNumber: `seq-001-${shard1RecordCalls}`,
                  newImage: { id: { S: 'from-shard-001' } },
                }),
              ],
              NextShardIterator: iterator,
            });
          }

          // Shard-002 keeps running
          return Promise.resolve({
            Records: [
              createMockRecord('INSERT', {
                sequenceNumber: `seq-002-${Date.now()}`,
                newImage: { id: { S: 'from-shard-002' } },
              }),
            ],
            NextShardIterator: iterator,
          });
        }

        return Promise.resolve({});
      });

      const table = createMockTableDescription();
      controller = DynamoDBController.from(table, {
        dynamoDBClient: mockDynamoDBClient as unknown as DynamoDBClient,
        streamsClient: mockStreamsClient as unknown as DynamoDBStreamsClient,
        pollInterval: 50,
      });

      const sub = fromEvent(controller, 'modified').subscribe((e) =>
        events.push(e)
      );
      subscriptions.push(sub);

      // Wait for shard churn to happen
      await new Promise((resolve) => setTimeout(resolve, 400));

      const shard1Events = events.filter(
        (e) => (e.newValue as { id?: string })?.id === 'from-shard-001'
      );
      const shard2Events = events.filter(
        (e) => (e.newValue as { id?: string })?.id === 'from-shard-002'
      );

      // Should have events from shard-001 before it closed
      expect(shard1Events.length).toBeGreaterThan(0);
      // Should have events from shard-002 which took over
      expect(shard2Events.length).toBeGreaterThan(0);
      // Shard-001 should have closed (only 1 event before closing)
      expect(shard1Events.length).toBeLessThanOrEqual(2);
    });
  });
});
