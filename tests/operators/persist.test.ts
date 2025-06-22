import {
  of,
  take,
  toArray,
  firstValueFrom,
  Subject,
  BehaviorSubject,
  ReplaySubject,
  AsyncSubject,
} from 'rxjs';
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

    test('cold-observe', async () => {
      const options: DynamoDBProviderOptions = {
        client: container.getClient(),
        hashKey: 'hashKey',
        rangeKey: 'rangeKey',
        signal: abort.signal,
        logger: console,
      };

      const data1: Data = { message: 'cold', timestamp: performance.now() };
      const data2: Data = { message: 'observe', timestamp: performance.now() };

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

    test('subject', async () => {
      const options: DynamoDBProviderOptions = {
        client: container.getClient(),
        hashKey: 'hashKey',
        rangeKey: 'rangeKey',
        signal: abort.signal,
        logger: console,
      };

      const data1: Data = { message: 'hot', timestamp: performance.now() };
      const data2: Data = { message: 'subject', timestamp: performance.now() };

      const provider$ = DynamoDBProvider.from(testId(), options);

      // Wait for provider to initialize first
      await firstValueFrom(provider$);

      // Create basic Subject (hot observable)
      const source$ = new Subject<Data>();
      const observable = source$.pipe(persistTo(provider$));

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

    test('behavior-subject', async () => {
      const options: DynamoDBProviderOptions = {
        client: container.getClient(),
        hashKey: 'hashKey',
        rangeKey: 'rangeKey',
        signal: abort.signal,
        logger: console,
      };

      const data1: Data = { message: 'behavior', timestamp: performance.now() };
      const data2: Data = { message: 'subject', timestamp: performance.now() };

      const provider$ = DynamoDBProvider.from(testId(), options);

      // Wait for provider to initialize first
      await firstValueFrom(provider$);

      // Create BehaviorSubject with initial value
      const source$ = new BehaviorSubject(data1);
      const observable = source$.pipe(persistTo(provider$));

      // Start subscription
      const promise = firstValueFrom(observable.pipe(take(2), toArray()));

      // Add second value after subscription
      setTimeout(() => source$.next(data2), 100);

      const events = await promise;
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(data1);
      expect(events[1]).toEqual(data2);

      source$.complete();
    });

    test('replay-subject', async () => {
      const options: DynamoDBProviderOptions = {
        client: container.getClient(),
        hashKey: 'hashKey',
        rangeKey: 'rangeKey',
        signal: abort.signal,
        logger: console,
      };

      const data1: Data = { message: 'replay', timestamp: performance.now() };
      const data2: Data = { message: 'subject', timestamp: performance.now() };

      const provider$ = DynamoDBProvider.from(testId(), options);

      // Wait for provider to initialize first
      await firstValueFrom(provider$);

      // Create ReplaySubject and emit values before subscription
      const source$ = new ReplaySubject<Data>(2);
      source$.next(data1);
      source$.next(data2);

      const observable = source$.pipe(persistTo(provider$));

      const events = await firstValueFrom(observable.pipe(take(2), toArray()));
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(data1);
      expect(events[1]).toEqual(data2);

      source$.complete();
    });

    test('async-subject', async () => {
      const options: DynamoDBProviderOptions = {
        client: container.getClient(),
        hashKey: 'hashKey',
        rangeKey: 'rangeKey',
        signal: abort.signal,
        logger: console,
      };

      const data1: Data = { message: 'async', timestamp: performance.now() };
      const data2: Data = { message: 'subject', timestamp: performance.now() };

      const provider$ = DynamoDBProvider.from(testId(), options);

      // Wait for provider to initialize first
      await firstValueFrom(provider$);

      // Create AsyncSubject - only emits the last value when completed
      const source$ = new AsyncSubject<Data>();
      const observable = source$.pipe(persistTo(provider$));

      // Start subscription
      const promise = firstValueFrom(observable);

      // Emit values and complete
      setTimeout(() => {
        source$.next(data1);
        source$.next(data2); // This will be the only value emitted
        source$.complete();
      }, 100);

      const event = await promise;
      expect(event).toEqual(data2); // Only the last value
    });
  });
});
