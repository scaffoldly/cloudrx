import { of, take, toArray, firstValueFrom, Subject } from 'rxjs';
import { DynamoDBProvider, DynamoDBProviderOptions } from '../../src';
import { persistFrom } from '../../src/operators/persist';
import { DynamoDBLocalContainer } from '../providers/aws/dynamodb/local';
import { testId } from '../setup';
import { createTestLogger } from '../utils/logger';

type Data = { message: string; timestamp: number };

describe('persist-from', () => {
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
      const data1: Data = {
        message: 'hot-from-1',
        timestamp: performance.now(),
      };
      const data2: Data = {
        message: 'hot-from-2',
        timestamp: performance.now(),
      };
      const provider$ = DynamoDBProvider.from(testId(), options);

      // Create hot Subject
      const source$ = new Subject<Data>();
      const persistable$ = source$.pipe(persistFrom(provider$, true));

      const promise = firstValueFrom(persistable$.pipe(take(2), toArray()));

      // Emit values after subscription (hot observable pattern)
      setTimeout(() => {
        source$.next(data1);
        source$.next(data2);
      }, 100);

      const persistables = await promise;
      expect(persistables).toHaveLength(2);

      // Verify the structure of first persistable
      expect(persistables[0]?.provider).toBeDefined();
      expect(persistables[0]?.source).toBeDefined();
      expect(persistables[0]?.stream).toBeDefined();

      // Verify the sources emit the correct data
      const sourceData1 = await firstValueFrom(persistables[0]!.source);
      const sourceData2 = await firstValueFrom(persistables[1]!.source);
      expect(sourceData1).toEqual(data1);
      expect(sourceData2).toEqual(data2);

      source$.complete();
    });
  });

  describe('cold', () => {
    test('observable', async () => {
      const options = createOptions();
      const data1: Data = {
        message: 'cold-from-1',
        timestamp: performance.now(),
      };
      const data2: Data = {
        message: 'cold-from-2',
        timestamp: performance.now(),
      };
      const provider$ = DynamoDBProvider.from(testId(), options);

      // Test that persistFrom creates Persistable objects
      const source$ = of(data1, data2);
      const persistable$ = source$.pipe(persistFrom(provider$, true));

      const persistables = await firstValueFrom(
        persistable$.pipe(take(2), toArray())
      );
      expect(persistables).toHaveLength(2);

      // Verify the structure
      expect(persistables[0]?.provider).toBeDefined();
      expect(persistables[0]?.source).toBeDefined();
      expect(persistables[0]?.stream).toBeDefined();

      // Verify the sources emit the correct data
      const sourceData1 = await firstValueFrom(persistables[0]!.source);
      const sourceData2 = await firstValueFrom(persistables[1]!.source);
      expect(sourceData1).toEqual(data1);
      expect(sourceData2).toEqual(data2);
    });
  });
});
