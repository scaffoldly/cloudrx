import { firstValueFrom } from 'rxjs';
import { DynamoDBProviderOptions } from '../../../../src';
import DynamoDBProvider from '../../../../src/providers/aws/dynamodb';
import { DynamoDBLocalContainer } from './local';

function testId(): string {
  return expect
    .getState()
    .currentTestName!.replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/--+/g, '-');
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

  //   test('stores-a-single-item', async () => {
  //     const testName = expect.getState().currentTestName!;
  //     const options: DynamoDBProviderOptions = {
  //       client: container.getClient(),
  //       hashKey: 'hashKey',
  //       rangeKey: 'rangeKey',
  //       signal: abort.signal,
  //     };

  //     const instance = await firstValueFrom(
  //       DynamoDBProvider.from(testName, options)
  //     );

  //     const testData = { message: 'test', timestamp: Date.now() };
  //     const storedData = await lastValueFrom(instance.store(testData));

  //     expect(storedData).toEqual(testData);
  //   });
});
