import { Subscription, firstValueFrom } from 'rxjs';
import {
  DynamoDBClient,
  DynamoDBClientConfig,
  TableDescription,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { fromEvent, Controller, Subject, BehaviorSubject } from 'cloudrx';
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

describe('DynamoDB Subject Integration', () => {
  let container: DynamoDBLocalContainer;
  let clientConfig: DynamoDBClientConfig;
  let docClient: DynamoDBDocumentClient;
  let controller: Controller<DynamoDBEvent<TestRecord>>;
  let subscriptions: Subscription[] = [];
  let table: TableDescription;

  type TestRecord = {
    id: string;
    data: string;
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

    const tableName = uniqueTableName();
    table = await createTable(docClient, tableName);

    controller = DynamoDBController.from<TestRecord>(table, {
      clientConfig,
      pollInterval: 100,
    });
  });

  afterEach(() => {
    subscriptions.forEach((sub) => sub.unsubscribe());
    controller?.dispose();
  });

  it('subject.next() writes via controller', async () => {
    // Seed to ensure stream has shards
    await firstValueFrom(controller.put({ id: 'seed', data: 'seed' }));
    await new Promise((resolve) => setTimeout(resolve, 500));

    const events: DynamoDBEvent<TestRecord>[] = [];
    const sub = fromEvent(controller, 'modified').subscribe((event) => {
      events.push(event);
    });
    subscriptions.push(sub);

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Write via subject.next()
    const subject = new Subject<TestRecord>().withController(controller);
    subject.next({ id: 'subj-1', data: 'from subject' });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const insertEvent = events.find((e) => e.value?.id === 'subj-1');
    expect(insertEvent).toBeDefined();
    expect(insertEvent!.type).toBe('modified');
    expect(insertEvent!.eventName).toBe('INSERT');
    expect(insertEvent!.value).toEqual({ id: 'subj-1', data: 'from subject' });
  });

  it('subject.subscribe() receives controller events', async () => {
    // Seed to ensure stream has shards
    await firstValueFrom(controller.put({ id: 'seed', data: 'seed' }));
    await new Promise((resolve) => setTimeout(resolve, 500));

    const subject = new Subject<TestRecord>().withController(controller);

    const values: TestRecord[] = [];
    const sub = subject.subscribe((value) => {
      values.push(value);
    });
    subscriptions.push(sub);

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Write directly via controller
    await firstValueFrom(
      controller.put({ id: 'ctrl-1', data: 'from controller' })
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const received = values.find((v) => v.id === 'ctrl-1');
    expect(received).toBeDefined();
    expect(received).toEqual({ id: 'ctrl-1', data: 'from controller' });
  });

  it('full round-trip: subject.next() -> subject.subscribe()', async () => {
    // Seed to ensure stream has shards
    await firstValueFrom(controller.put({ id: 'seed', data: 'seed' }));
    await new Promise((resolve) => setTimeout(resolve, 500));

    const subject = new Subject<TestRecord>().withController(controller);

    const values: TestRecord[] = [];
    const sub = subject.subscribe((value) => {
      values.push(value);
    });
    subscriptions.push(sub);

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Write via subject, read via subject
    subject.next({ id: 'rt-1', data: 'round-trip' });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const received = values.find((v) => v.id === 'rt-1');
    expect(received).toBeDefined();
    expect(received).toEqual({ id: 'rt-1', data: 'round-trip' });
  });

  describe('BehaviorSubject', () => {
    it('getValue() returns initial value before any events', () => {
      const initial: TestRecord = { id: 'init', data: 'initial' };
      const subject = new BehaviorSubject<TestRecord>(initial).withController(
        controller
      );

      expect(subject.getValue()).toEqual(initial);
    });

    it('subscribe() emits initial value then stream events', async () => {
      // Seed to ensure stream has shards
      await firstValueFrom(controller.put({ id: 'seed', data: 'seed' }));
      await new Promise((resolve) => setTimeout(resolve, 500));

      const initial: TestRecord = { id: 'hello', data: 'initial' };
      const subject = new BehaviorSubject<TestRecord>(initial).withController(
        controller
      );

      const values: TestRecord[] = [];
      const sub = subject.subscribe((v) => values.push(v));
      subscriptions.push(sub);

      // Initial value should be emitted immediately
      expect(values).toEqual([initial]);

      await new Promise((resolve) => setTimeout(resolve, 500));

      subject.next({ id: 'hello', data: 'world' });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      subject.next({ id: 'world', data: 'world' });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(values).toEqual([
        { id: 'hello', data: 'initial' },
        { id: 'hello', data: 'world' },
        { id: 'world', data: 'world' },
      ]);
    });

    it('getValue() updates after stream event arrives', async () => {
      // Seed to ensure stream has shards
      await firstValueFrom(controller.put({ id: 'seed', data: 'seed' }));
      await new Promise((resolve) => setTimeout(resolve, 500));

      const subject = new BehaviorSubject<TestRecord>({
        id: '',
        data: '',
      }).withController(controller);

      // Wait for stream polling to start
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Write via controller — stream will update the cached value
      await firstValueFrom(
        controller.put({ id: 'gv-1', data: 'from controller' })
      );

      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(subject.getValue()).toEqual({
        id: 'gv-1',
        data: 'from controller',
      });
    });

    it('next() delivers multiple events and getValue() tracks latest', async () => {
      // Seed to ensure stream has shards
      await firstValueFrom(controller.put({ id: 'seed', data: 'seed' }));
      await new Promise((resolve) => setTimeout(resolve, 500));

      const initial: TestRecord = { id: 'init', data: 'initial' };
      const subject = new BehaviorSubject<TestRecord>(initial).withController(
        controller
      );

      // getValue() should be initial before any stream events
      expect(subject.getValue()).toEqual(initial);

      const values: TestRecord[] = [];
      const sub = subject.subscribe((value) => {
        values.push(value);
      });
      subscriptions.push(sub);

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Write two events via next()
      subject.next({ id: 'bs-1', data: 'first' });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      subject.next({ id: 'bs-2', data: 'second' });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // First emission should be the initial value
      expect(values[0]).toEqual(initial);

      // Subscriber should have received both stream events
      const first = values.find((v) => v.id === 'bs-1');
      const second = values.find((v) => v.id === 'bs-2');
      expect(first).toBeDefined();
      expect(first).toEqual({ id: 'bs-1', data: 'first' });
      expect(second).toBeDefined();
      expect(second).toEqual({ id: 'bs-2', data: 'second' });

      // getValue() should reflect the latest stream event
      expect(subject.getValue()).toEqual({ id: 'bs-2', data: 'second' });
    });

    it('subscribe() receives multiple controller events and getValue() stays in sync', async () => {
      // Seed to ensure stream has shards
      await firstValueFrom(controller.put({ id: 'seed', data: 'seed' }));
      await new Promise((resolve) => setTimeout(resolve, 500));

      const initial: TestRecord = { id: 'init', data: 'initial' };
      const subject = new BehaviorSubject<TestRecord>(initial).withController(
        controller
      );

      expect(subject.getValue()).toEqual(initial);

      const values: TestRecord[] = [];
      const sub = subject.subscribe((value) => {
        values.push(value);
      });
      subscriptions.push(sub);

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Write two events directly via controller
      await firstValueFrom(
        controller.put({ id: 'bs-c1', data: 'controller first' })
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      await firstValueFrom(
        controller.put({ id: 'bs-c2', data: 'controller second' })
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // First emission should be the initial value
      expect(values[0]).toEqual(initial);

      // Subscriber should have received both stream events
      const first = values.find((v) => v.id === 'bs-c1');
      const second = values.find((v) => v.id === 'bs-c2');
      expect(first).toBeDefined();
      expect(first).toEqual({ id: 'bs-c1', data: 'controller first' });
      expect(second).toBeDefined();
      expect(second).toEqual({ id: 'bs-c2', data: 'controller second' });

      // getValue() should reflect the latest stream event
      expect(subject.getValue()).toEqual({
        id: 'bs-c2',
        data: 'controller second',
      });
    });
  });

  it('multiple subscribers both receive events', async () => {
    // Seed to ensure stream has shards
    await firstValueFrom(controller.put({ id: 'seed', data: 'seed' }));
    await new Promise((resolve) => setTimeout(resolve, 500));

    const subject = new Subject<TestRecord>().withController(controller);

    const values1: TestRecord[] = [];
    const values2: TestRecord[] = [];

    const sub1 = subject.subscribe((v) => values1.push(v));
    const sub2 = subject.subscribe((v) => values2.push(v));
    subscriptions.push(sub1, sub2);

    await new Promise((resolve) => setTimeout(resolve, 500));

    subject.next({ id: 'multi-1', data: 'multi-sub' });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const received1 = values1.find((v) => v.id === 'multi-1');
    const received2 = values2.find((v) => v.id === 'multi-1');

    expect(received1).toBeDefined();
    expect(received2).toBeDefined();
    expect(received1).toEqual({ id: 'multi-1', data: 'multi-sub' });
    expect(received2).toEqual({ id: 'multi-1', data: 'multi-sub' });
  });
});
