import { firstValueFrom } from 'rxjs';
import { DynamoDBProviderOptions } from '../../../../src';
import DynamoDBProvider from '../../../../src/providers/aws/dynamodb';
import { DynamoDBLocalContainer } from './local';

describe('AWS DynamoDB Provider Tests', () => {
  let container: DynamoDBLocalContainer;
  let abort = new AbortController();

  beforeAll(async () => {
    container = new DynamoDBLocalContainer();
    await container.start();
  }); // Using global timeout from package.json

  afterAll(async () => {
    abort.abort();
    if (container) {
      await container.stop();
    }
  }); // Using global timeout from package.json

  test('is a singleton', async () => {
    const id = 'is-a-singleton';
    const options: DynamoDBProviderOptions = {
      client: container.getClient(),
      hashKey: 'hashKey',
      rangeKey: 'rangeKey',
      signal: abort.signal,
    };

    const instance1$ = DynamoDBProvider.from(id, options);
    const instance2$ = DynamoDBProvider.from(id, options);

    const instance1 = await firstValueFrom(instance1$);
    const instance2 = await firstValueFrom(instance2$);

    expect(instance1).toBe(instance2);

    expect(instance1.tableName).toBe(`cloudrx-${id}`);
    expect(instance2.tableName).toBe(`cloudrx-${id}`);
  }); // Using global timeout from package.json

  test('Sets Table ARN', async () => {
    const id = 'sets-table-arn';
    const options: DynamoDBProviderOptions = {
      client: container.getClient(),
      hashKey: 'hashKey',
      rangeKey: 'rangeKey',
      signal: abort.signal,
    };

    const instance = await firstValueFrom(DynamoDBProvider.from(id, options));

    expect(instance.tableArn).toBeDefined();
  }); // Using global timeout from package.json

  test('Sets Stream ARN', async () => {
    const id = 'sets-stream-arn';
    const options: DynamoDBProviderOptions = {
      client: container.getClient(),
      hashKey: 'hashKey',
      rangeKey: 'rangeKey',
      signal: abort.signal,
    };

    const instance = await firstValueFrom(DynamoDBProvider.from(id, options));

    expect(instance.streamArn).toBeDefined();
  }); // Using global timeout from package.json
});
