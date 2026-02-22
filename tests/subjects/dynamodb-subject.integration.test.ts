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
    it('getValue$() returns current record from DynamoDB', async () => {
      // Insert a record directly
      await firstValueFrom(
        controller.put({ id: 'bs-get', data: 'behavior value' })
      );

      const subject = new BehaviorSubject<TestRecord>({
        id: '',
        data: '',
      }).withController(controller, { id: 'bs-get' });

      const value = await firstValueFrom(subject.getValue$());

      expect(value).toBeDefined();
      expect(value).toEqual({ id: 'bs-get', data: 'behavior value' });
    });

    it('getValue$() returns undefined for non-existent key', async () => {
      const subject = new BehaviorSubject<TestRecord>({
        id: '',
        data: '',
      }).withController(controller, { id: 'no-such-key' });

      const value = await firstValueFrom(subject.getValue$());

      expect(value).toBeUndefined();
    });

    it('next() writes and stream delivers to subscribers', async () => {
      // Seed to ensure stream has shards
      await firstValueFrom(controller.put({ id: 'seed', data: 'seed' }));
      await new Promise((resolve) => setTimeout(resolve, 500));

      const subject = new BehaviorSubject<TestRecord>({
        id: '',
        data: '',
      }).withController(controller, { id: 'bs-next' });

      const values: TestRecord[] = [];
      const sub = subject.subscribe((value) => {
        values.push(value);
      });
      subscriptions.push(sub);

      await new Promise((resolve) => setTimeout(resolve, 500));

      subject.next({ id: 'bs-next', data: 'from behavior subject' });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const received = values.find((v) => v.id === 'bs-next');
      expect(received).toBeDefined();
      expect(received).toEqual({
        id: 'bs-next',
        data: 'from behavior subject',
      });
    });

    it('subscribe() receives controller events', async () => {
      // Seed to ensure stream has shards
      await firstValueFrom(controller.put({ id: 'seed', data: 'seed' }));
      await new Promise((resolve) => setTimeout(resolve, 500));

      const subject = new BehaviorSubject<TestRecord>({
        id: '',
        data: '',
      }).withController(controller, { id: 'bs-ctrl' });

      const values: TestRecord[] = [];
      const sub = subject.subscribe((value) => {
        values.push(value);
      });
      subscriptions.push(sub);

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Write directly via controller
      await firstValueFrom(
        controller.put({ id: 'bs-ctrl', data: 'from controller' })
      );

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const received = values.find((v) => v.id === 'bs-ctrl');
      expect(received).toBeDefined();
      expect(received).toEqual({ id: 'bs-ctrl', data: 'from controller' });
    });

    it('getValue() throws when wired to a controller', () => {
      const subject = new BehaviorSubject<TestRecord>({
        id: '',
        data: '',
      }).withController(controller, { id: 'any' });

      expect(() => subject.getValue()).toThrow(
        'Cannot use getValue() on a controller-wired BehaviorSubject'
      );
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
