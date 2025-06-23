import { of, take, toArray, firstValueFrom, Subject } from 'rxjs';
import { DynamoDBProvider, DynamoDBProviderOptions } from '../../../src';
import { persistTo, Persistable } from '../../../src/operators/persist';
import { DynamoDBLocalContainer } from '../../providers/aws/dynamodb/local';
import { testId } from '../../setup';
import { createTestLogger } from '../../utils/logger';

type Data = { message: string; timestamp: number };

describe.skip('persist-to', () => {
  let container: DynamoDBLocalContainer;
  let abort: AbortController;
  const logger = createTestLogger();

  beforeAll(async () => {
    container = new DynamoDBLocalContainer(logger);
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

  const createOptions = (): DynamoDBProviderOptions => ({
    client: container.getClient(),
    hashKey: 'hashKey',
    rangeKey: 'rangeKey',
    signal: abort.signal,
    logger,
  });

  describe('hot', () => {
    test('subject', async () => {
      const options = createOptions();
      const data1: Data = { message: 'hot', timestamp: performance.now() };
      const data2: Data = {
        message: 'subject',
        timestamp: performance.now(),
      };

      // Create basic Subject (hot observable)
      const source$ = new Subject<Data>();
      const persistable$ = of<Persistable<Data>>({
        provider: DynamoDBProvider.from(testId(), options),
        source: source$,
      });
      const observable = persistable$.pipe(persistTo());

      // Start subscription
      const promise = firstValueFrom(observable.pipe(take(2), toArray()));

      // Emit values after subscription (hot observable pattern)
      setTimeout(() => {
        source$.next(data1);
        source$.next(data2);
      }, 100);

      const events = await promise;
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(data1);
      expect(events[1]).toEqual(data2);

      source$.complete();
    });
  });

  describe('cold', () => {
    test('observable', async () => {
      const options = createOptions();
      const data1: Data = { message: 'cold', timestamp: performance.now() };
      const data2: Data = {
        message: 'observe',
        timestamp: performance.now(),
      };

      // Create persistable object with provider and source
      const source$ = of(data1, data2);
      const persistable$ = of<Persistable<Data>>({
        provider: DynamoDBProvider.from(testId(), options),
        source: source$,
      });
      const observable = persistable$.pipe(persistTo());

      const events = await firstValueFrom(observable.pipe(take(2), toArray()));
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(data1);
      expect(events[1]).toEqual(data2);
    });
  });
});
