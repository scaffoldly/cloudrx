import { Subscription, firstValueFrom, toArray } from 'rxjs';
import {
  DynamoDBClient,
  DynamoDBClientConfig,
  TableDescription,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { fromEvent, Controller } from 'cloudrx';
import {
  DynamoDBController,
  DynamoDBEvent,
} from '../../src/controllers/aws/dynamodb';
import { DynamoDBLocalContainer } from '../providers/aws/dynamodb/local';
import {
  uniqueTableName,
  createTable,
  createClientConfig,
  clearControllerCache,
} from '../helpers/dynamodb';

describe('DynamoDBController Integration', () => {
  let container: DynamoDBLocalContainer;
  let clientConfig: DynamoDBClientConfig;
  let docClient: DynamoDBDocumentClient;
  let controller: Controller<DynamoDBEvent<TestRecord>>;
  let subscriptions: Subscription[] = [];
  let table: TableDescription;

  type TestRecord = {
    id: string;
    data: string;
    expires?: number;
  };

  beforeAll(async () => {
    container = new DynamoDBLocalContainer();
    await container.start();

    clientConfig = createClientConfig(container);
    docClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig));
  });

  afterAll(async () => {
    await container.stop();
  });

  beforeEach(async () => {
    subscriptions = [];

    clearControllerCache();

    // Create a fresh table for each test
    const tableName = uniqueTableName();
    table = await createTable(docClient, tableName);

    // Create controller
    controller = DynamoDBController.from<TestRecord>(table, {
      clientConfig,
      pollInterval: 100, // Fast polling for tests
    });
  });

  afterEach(() => {
    subscriptions.forEach((sub) => sub.unsubscribe());
    controller?.dispose();
  });

  describe('event streaming', () => {
    it('emits modified event on INSERT', async () => {
      // Seed record to ensure stream has shards
      await firstValueFrom(controller.put({ id: 'seed', data: 'seed record' }));

      // Wait for shard to be created
      await new Promise((resolve) => setTimeout(resolve, 500));

      const events: DynamoDBEvent<TestRecord>[] = [];
      const sub = fromEvent(controller, 'modified').subscribe((event) => {
        events.push(event);
      });
      subscriptions.push(sub);

      // Wait for stream polling to start and catch up
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Insert another record via controller
      await firstValueFrom(
        controller.put({ id: 'test-1', data: 'hello world' })
      );

      // Wait for event to be processed
      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(events.length).toBeGreaterThanOrEqual(1);
      const insertEvent = events.find((e) => e.value?.id === 'test-1');
      expect(insertEvent).toBeDefined();

      // Verify exact event content matches what was inserted
      expect(insertEvent!.type).toBe('modified');
      expect(insertEvent!.eventName).toBe('INSERT');
      expect(insertEvent!.value).toEqual({
        id: 'test-1',
        data: 'hello world',
      });
      expect(insertEvent!.key).toEqual({ id: 'test-1' });
      expect(insertEvent!.timestamp).toBeInstanceOf(Date);
      expect(typeof insertEvent!.sequenceNumber).toBe('string');
    });

    it('emits modified event on MODIFY', async () => {
      // Seed record to create the record and shard
      await firstValueFrom(controller.put({ id: 'test-2', data: 'original' }));

      // Wait for shard to be created
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Now subscribe to catch the modify
      const events: DynamoDBEvent<TestRecord>[] = [];
      const sub = fromEvent(controller, 'modified').subscribe((event) => {
        events.push(event);
      });
      subscriptions.push(sub);

      // Wait for stream polling to catch up
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Update the record via controller
      await firstValueFrom(controller.put({ id: 'test-2', data: 'updated' }));

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const modifyEvent = events.find((e) => e.eventName === 'MODIFY');
      expect(modifyEvent).toBeDefined();

      // Verify exact event content matches the modification
      expect(modifyEvent!.type).toBe('modified');
      expect(modifyEvent!.eventName).toBe('MODIFY');
      expect(modifyEvent!.value).toEqual({
        id: 'test-2',
        data: 'updated',
      });
      expect(modifyEvent!.key).toEqual({ id: 'test-2' });
      expect(modifyEvent!.timestamp).toBeInstanceOf(Date);
      expect(typeof modifyEvent!.sequenceNumber).toBe('string');
    });

    it('emits removed event on DELETE', async () => {
      // Seed record
      await firstValueFrom(controller.put({ id: 'test-3', data: 'to-delete' }));

      // Wait for insert
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Subscribe to removed events
      const events: DynamoDBEvent<TestRecord>[] = [];
      const sub = fromEvent(controller, 'removed').subscribe((event) => {
        events.push(event);
      });
      subscriptions.push(sub);

      // Delete the record via controller
      await firstValueFrom(controller.remove({ id: 'test-3' }));

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(events.length).toBeGreaterThanOrEqual(1);
      const removeEvent = events.find((e) => e.value?.id === 'test-3');
      expect(removeEvent).toBeDefined();

      // Verify exact event content matches the deleted record
      expect(removeEvent!.type).toBe('removed');
      expect(removeEvent!.eventName).toBe('REMOVE');
      expect(removeEvent!.value).toEqual({
        id: 'test-3',
        data: 'to-delete',
      });
      expect(removeEvent!.key).toEqual({ id: 'test-3' });
      expect(removeEvent!.timestamp).toBeInstanceOf(Date);
      expect(typeof removeEvent!.sequenceNumber).toBe('string');
    });
  });

  describe('observable factory', () => {
    it('from$() creates controller that receives events', async () => {
      // Seed record to create shard
      await firstValueFrom(controller.put({ id: 'seed', data: 'seed' }));
      await new Promise((resolve) => setTimeout(resolve, 500));

      clearControllerCache();

      const controller$ = DynamoDBController.from$<TestRecord>(table, {
        clientConfig,
        pollInterval: 100,
      });

      const newController = await firstValueFrom(controller$);

      // Subscribe and wait for polling to catch up
      const events: DynamoDBEvent<TestRecord>[] = [];
      const sub = fromEvent(newController, 'modified').subscribe((e) =>
        events.push(e)
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Insert a record via controller
      await firstValueFrom(
        newController.put({ id: 'obs-test', data: 'from observable' })
      );

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 1000));

      sub.unsubscribe();
      newController.dispose();

      const targetEvent = events.find((e) => e.value?.id === 'obs-test');
      expect(targetEvent).toBeDefined();

      // Verify exact event content
      expect(targetEvent!.type).toBe('modified');
      expect(targetEvent!.eventName).toBe('INSERT');
      expect(targetEvent!.value).toEqual({
        id: 'obs-test',
        data: 'from observable',
      });
    });
  });

  describe('multiple subscribers', () => {
    it('delivers events to all subscribers', async () => {
      // Seed record to create shard
      await firstValueFrom(controller.put({ id: 'seed', data: 'seed' }));
      await new Promise((resolve) => setTimeout(resolve, 500));

      const events1: DynamoDBEvent<TestRecord>[] = [];
      const events2: DynamoDBEvent<TestRecord>[] = [];

      const sub1 = fromEvent(controller, 'modified').subscribe((e) =>
        events1.push(e)
      );
      const sub2 = fromEvent(controller, 'modified').subscribe((e) =>
        events2.push(e)
      );
      subscriptions.push(sub1, sub2);

      // Wait for stream polling to start
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Insert a record via controller
      await firstValueFrom(
        controller.put({ id: 'multi-test', data: 'shared' })
      );

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const events1Filtered = events1.filter(
        (e) => e.value?.id === 'multi-test'
      );
      const events2Filtered = events2.filter(
        (e) => e.value?.id === 'multi-test'
      );

      expect(events1Filtered.length).toBeGreaterThanOrEqual(1);
      expect(events2Filtered.length).toBeGreaterThanOrEqual(1);

      // Verify both subscribers received the exact same event content
      const event1 = events1Filtered[0]!;
      const event2 = events2Filtered[0]!;

      expect(event1.type).toBe('modified');
      expect(event1.eventName).toBe('INSERT');
      expect(event1.value).toEqual({
        id: 'multi-test',
        data: 'shared',
      });

      expect(event2.type).toBe('modified');
      expect(event2.eventName).toBe('INSERT');
      expect(event2.value).toEqual({
        id: 'multi-test',
        data: 'shared',
      });

      // Both subscribers should have received the same sequence number
      expect(event1.sequenceNumber).toBe(event2.sequenceNumber);
    });
  });

  describe('get() method', () => {
    it('returns an item by key', async () => {
      // Insert a record
      await firstValueFrom(controller.put({ id: 'get-test', data: 'fetched' }));

      // Fetch it back
      const item = await firstValueFrom(controller.get({ id: 'get-test' }));

      expect(item).toBeDefined();
      expect(item).toEqual({ id: 'get-test', data: 'fetched' });
    });

    it('returns undefined for non-existent key', async () => {
      const item = await firstValueFrom(
        controller.get({ id: 'does-not-exist' })
      );

      expect(item).toBeUndefined();
    });
  });

  describe('track() method', () => {
    it('tracks observables with controller lifecycle', async () => {
      const { of } = await import('rxjs');

      const source$ = of(1, 2, 3);
      const tracked$ = controller.track(source$);

      const values = await firstValueFrom(tracked$.pipe(toArray()));
      expect(values).toEqual([1, 2, 3]);
    });
  });
});
