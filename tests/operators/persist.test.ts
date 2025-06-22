import { of, take, toArray, firstValueFrom } from 'rxjs';
import {
  DynamoDBProvider,
  DynamoDBProviderOptions,
  persistTo,
} from '../../src';
import { DynamoDBLocalContainer } from '../providers/aws/dynamodb/local';
import { testId } from '../setup';

type Data = { message: string; timestamp: number };

describe('aws-dynamodb', () => {
  describe('persist-to', () => {
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
      if (!abort.signal.aborted) {
        abort.abort();
      }
    });

    afterAll(async () => {
      if (container) {
        await container.stop();
      }
    });

    test('subject', async () => {
      const options: DynamoDBProviderOptions = {
        client: container.getClient(),
        hashKey: 'hashKey',
        rangeKey: 'rangeKey',
        signal: abort.signal,
        logger: console,
      };

      const data1: Data = { message: 'hello', timestamp: performance.now() };
      const data2: Data = { message: 'world', timestamp: performance.now() };

      // Use a cold observable that emits both values
      const source$ = of(data1, data2);
      const observable = source$.pipe(
        persistTo(DynamoDBProvider.from(testId(), options))
      );

      const events = await firstValueFrom(observable.pipe(take(2), toArray()));
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(data1);
      expect(events[1]).toEqual(data2);
    });
  });
});
