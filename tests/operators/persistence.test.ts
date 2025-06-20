import { Subject } from 'rxjs';
import {
  DynamoDBProvider,
  DynamoDBProviderOptions,
  persistTo,
} from '../../src';
import { DynamoDBLocalContainer } from '../providers/aws/dynamodb/local';
import { testId } from '../setup';

describe('persistence', () => {
  describe('aws-dynamodb', () => {
    let container: DynamoDBLocalContainer;
    let abort: AbortController = new AbortController();

    type Data = { message: string; timestamp: number };

    beforeAll(async () => {
      container = new DynamoDBLocalContainer();
      await container.start();
    });

    afterAll(async () => {
      abort.abort();
      if (container) {
        await container.stop();
      }
    });

    test.skip('subject', async () => {
      const options: DynamoDBProviderOptions = {
        client: container.getClient(),
        hashKey: 'hashKey',
        rangeKey: 'rangeKey',
        signal: abort.signal,
        // logger: console,
      };

      const provider = DynamoDBProvider.from(testId(), options);

      const subject1 = new Subject<Data>();
      const observable1 = subject1.pipe(persistTo(provider));
      const events1: Data[] = [];
      const subscription1 = observable1.subscribe({
        next: (event) => events1.push(event),
      });

      const subject2 = new Subject<Data>();
      const observable2 = subject2.pipe(persistTo(provider));
      const events2: Data[] = [];
      const subscription2 = observable2.subscribe({
        next: (event) => events2.push(event),
      });

      const data1: Data = { message: 'hello', timestamp: performance.now() };
      const data2: Data = { message: 'world', timestamp: performance.now() };

      // Only emit to subject1, both should receive since they share the same provider
      subject1.next(data1);
      subject1.next(data2);

      subscription1.unsubscribe();
      subscription2.unsubscribe();

      expect(events1).toEqual([data1, data2]);
      expect(events2).toEqual([data1, data2]);
    });
  });
});
