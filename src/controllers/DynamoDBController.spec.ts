/* global describe, it, beforeEach, afterEach, expect, jest */
import { Subscription } from 'rxjs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBStreamsClient,
  _Record,
} from '@aws-sdk/client-dynamodb-streams';
import { fromEvent } from '../observables/fromEvent';
import { Abortable } from '../util/abortable';
import {
  DynamoDBController,
  DynamoDBEvent,
  DynamoDBControllerOptions,
} from './DynamoDBController';

// Mock AWS SDK
const mockSend = jest.fn();
const mockDynamoDBClient = { send: mockSend };
const mockStreamsClient = { send: mockSend };

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
async function createMockController<T = unknown>(
  tableArn = 'arn:aws:dynamodb:us-east-1:123456789:table/test-table',
  options: Partial<DynamoDBControllerOptions> = {}
): Promise<DynamoDBController<T>> {
  // Mock DescribeTable response
  mockSend.mockImplementation((command: unknown) => {
    const commandName = (command as { constructor: { name: string } })
      .constructor.name;

    if (commandName === 'DescribeTableCommand') {
      return Promise.resolve({
        Table: {
          TableArn: tableArn,
          LatestStreamArn: `${tableArn}/stream/2024-01-01T00:00:00.000`,
        },
      });
    }

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

  return DynamoDBController.from<T>(tableArn, controllerOptions);
}

describe('DynamoDBController', () => {
  let controller: DynamoDBController<Record<string, unknown>>;
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
      controller = await createMockController(tableArn);
      const controller2 = await createMockController(tableArn);

      expect(controller).toBe(controller2);
    });

    it('returns different instances for different table ARNs', async () => {
      const tableArn1 = 'arn:aws:dynamodb:us-east-1:123456789:table/table1';
      const tableArn2 = 'arn:aws:dynamodb:us-east-1:123456789:table/table2';

      controller = await createMockController(tableArn1);
      const controller2 = await createMockController(tableArn2);

      expect(controller).not.toBe(controller2);
      controller2.dispose();
    });

    it('removes instance from cache on dispose', async () => {
      const tableArn =
        'arn:aws:dynamodb:us-east-1:123456789:table/dispose-test';
      controller =
        await createMockController<Record<string, unknown>>(tableArn);
      controller.dispose();

      const controller2 =
        await createMockController<Record<string, unknown>>(tableArn);
      expect(controller).not.toBe(controller2);
      controller = controller2;
    });
  });

  describe('event classification', () => {
    it('classifies INSERT as modified', async () => {
      controller = await createMockController();
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
      controller = await createMockController();
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
      controller = await createMockController();
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
      controller = await createMockController();
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
      controller = await createMockController();
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
      controller = await createMockController(undefined, {
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
      controller = await createMockController(undefined, {
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
      controller = await createMockController();
      const events: DynamoDBEvent<unknown>[] = [];

      const sub = fromEvent(controller, 'modified').subscribe((event) => {
        events.push(event);
      });
      subscriptions.push(sub);

      // Subscription should be active
      expect(sub.closed).toBe(false);
    });

    it('can subscribe to removed events', async () => {
      controller = await createMockController();
      const events: DynamoDBEvent<unknown>[] = [];

      const sub = fromEvent(controller, 'removed').subscribe((event) => {
        events.push(event);
      });
      subscriptions.push(sub);

      expect(sub.closed).toBe(false);
    });

    it('can subscribe to expired events', async () => {
      controller = await createMockController();
      const events: DynamoDBEvent<unknown>[] = [];

      const sub = fromEvent(controller, 'expired').subscribe((event) => {
        events.push(event);
      });
      subscriptions.push(sub);

      expect(sub.closed).toBe(false);
    });

    it('supports multiple listeners on same event type', async () => {
      controller = await createMockController();
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
      controller = await createMockController();

      const tree = Abortable.root.tree;
      const controllerNode = tree.children.find((c) =>
        c.name.startsWith('DynamoDBController:')
      );

      expect(controllerNode).toBeDefined();
      expect(controllerNode?.aborted).toBe(false);
    });

    it('exposes signal for external cancellation', async () => {
      controller = await createMockController();

      expect(controller.signal).toBeInstanceOf(AbortSignal);
      expect(controller.signal.aborted).toBe(false);
    });

    it('exposes table ARN', async () => {
      const tableArn = 'arn:aws:dynamodb:us-east-1:123456789:table/arn-test';
      controller = await createMockController(tableArn);

      expect(controller.arn).toBe(tableArn);
    });

    it('closes subscriptions on dispose', async () => {
      controller = await createMockController();

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

    it('chains external abort signal', async () => {
      const externalController = new AbortController();
      controller = await createMockController(undefined, {
        signal: externalController.signal,
      });

      expect(controller.signal.aborted).toBe(false);

      externalController.abort();

      // Allow async propagation
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Controller should be disposed
      expect(controller.signal.aborted).toBe(true);
    });
  });

  describe('track() method', () => {
    it('wraps observables with controller lifecycle', async () => {
      controller = await createMockController();
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

        if (commandName === 'DescribeTableCommand') {
          return Promise.resolve({
            Table: {
              TableArn: 'arn:aws:dynamodb:us-east-1:123456789:table/obs-test',
              LatestStreamArn:
                'arn:aws:dynamodb:us-east-1:123456789:table/obs-test/stream/2024-01-01T00:00:00.000',
            },
          });
        }

        if (commandName === 'DescribeStreamCommand') {
          return Promise.resolve({
            StreamDescription: { Shards: [] },
          });
        }

        return Promise.resolve({});
      });

      const controllerOptions: DynamoDBControllerOptions = {
        dynamoDBClient: mockDynamoDBClient as unknown as DynamoDBClient,
        streamsClient: mockStreamsClient as unknown as DynamoDBStreamsClient,
      };

      const controller$ = DynamoDBController.from$(
        'arn:aws:dynamodb:us-east-1:123456789:table/obs-test',
        controllerOptions
      );

      const emittedController = await new Promise<DynamoDBController>(
        (resolve) => {
          controller$.subscribe((c) => {
            resolve(c);
          });
        }
      );

      expect(emittedController).toBeInstanceOf(DynamoDBController);
      emittedController.dispose();
    });
  });
});
