import { Observable, firstValueFrom } from 'rxjs';
import { DynamoDBProviderOptions } from '../../../../src';
import DynamoDBProvider from '../../../../src/providers/aws/dynamodb';
import { DynamoDBLocalContainer } from './local';
import { Shard } from '@aws-sdk/client-dynamodb-streams';

function testId(): string {
  return expect
    .getState()
    .currentTestName!.replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/--+/g, '-');
}

// Helper to access private property
function getShardsProperty(
  provider: DynamoDBProvider
): Observable<Shard> | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (provider as any)._shards;
}

describe('DynamoDBProvider Shards Integration', () => {
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

  test('multiple streams share the same shard observable', async () => {
    // Skip this test in CI environment
    if (process.env.CI) {
      console.log('Skipping integration test in CI environment');
      return;
    }

    const options: DynamoDBProviderOptions = {
      client: container.getClient(),
      hashKey: 'hashKey',
      rangeKey: 'rangeKey',
      signal: abort.signal,
      logger: console,
    };

    // Create a provider instance
    const provider = await firstValueFrom(
      DynamoDBProvider.from(testId(), options)
    );

    // Verify _shards is initially undefined
    const initial = getShardsProperty(provider);
    expect(initial).toBeUndefined();

    // Create two separate streams - this should initialize the shared observable
    const _stream1 = provider.stream('latest');
    const _stream2 = provider.stream('latest');

    // Now the _shards property should be defined
    const shards1 = getShardsProperty(provider);
    expect(shards1).toBeDefined();

    // Create a third stream and check it uses the same observable
    const _stream3 = provider.stream('latest');
    const shards2 = getShardsProperty(provider);

    // Verify the observable instance hasn't changed
    expect(shards2).toBe(shards1);
  });
});