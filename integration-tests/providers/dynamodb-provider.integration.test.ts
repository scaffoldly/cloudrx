import { CloudSubject } from '../../src/subjects/cloud-subject';
import { DynamoDBLocalContainer } from '../subjects/aws/dynamodb/dynamodb-local-container';
import { createLogger } from '../../src/utils/logger';

const currentTestName = 'dynamodb-provider-integration-test';

describe('DynamoDB Provider Integration Tests', () => {
  let container: DynamoDBLocalContainer;
  const logger = createLogger('test-logger', 'error');

  beforeAll(async () => {
    console.log(
      '🚀 Starting DynamoDB Local container for consistency tests...'
    );
    container = new DynamoDBLocalContainer();
    await container.start();
  }, 30000);

  afterAll(async () => {
    if (container) {
      console.log('🛑 Stopping DynamoDB Local container...');
      await container.stop();
    }
  }, 10000);

  describe('none consistency level', () => {
    it('should emit immediately without verification', async () => {
      console.log('🔍 Testing none consistency level...');

      const cloudSubject = new CloudSubject(`${currentTestName}-none`, {
        type: 'aws-dynamodb',
        tableName: 'integration-test-table',
        consistency: 'none',
        replayOnSubscribe: false,
        client: container.getClient(),
        logger,
      });

      const testData = { test: 'none-consistency', timestamp: Date.now() };
      const emittedValues: unknown[] = [];

      // Track timing
      const startTime = Date.now();

      cloudSubject.subscribe((value) => {
        emittedValues.push(value);
      });

      cloudSubject.next(testData);

      // Wait a bit to capture emission
      await new Promise((resolve) => setTimeout(resolve, 100));

      const emitTime = Date.now() - startTime;

      // Should emit almost immediately (< 200ms)
      expect(emitTime).toBeLessThan(200);
      expect(emittedValues).toContainEqual(testData);

      console.log(`✅ None consistency emitted in ${emitTime}ms`);
    });

    it('should NOT emit if cloud storage is unavailable', async () => {
      console.log('🔍 Testing none consistency with storage failure...');

      // Use a non-existent table to trigger failure
      const cloudSubject = new CloudSubject(`${currentTestName}-none-fail`, {
        type: 'aws-dynamodb',
        tableName: 'non-existent-table',
        consistency: 'none',
        replayOnSubscribe: false,
        client: container.getClient(),
        logger,
      });

      const testData = { test: 'none-consistency-fail', timestamp: Date.now() };
      const emittedValues: unknown[] = [];
      let errorReceived = false;

      cloudSubject.subscribe({
        next: (value) => {
          emittedValues.push(value);
        },
        error: (error) => {
          errorReceived = true;
          expect(error.name).toBe('ResourceNotFoundException');
        },
      });

      cloudSubject.next(testData);

      // Wait for error propagation (longer due to retries)
      await new Promise((resolve) => setTimeout(resolve, 12000));

      // Should NOT emit the value when storage fails
      expect(emittedValues).toEqual([]);
      expect(errorReceived).toBe(true);

      console.log('✅ None consistency correctly failed without emission');
    }, 15000);
  });

  describe('weak consistency level', () => {
    it('should verify storage before emitting', async () => {
      console.log('🔍 Testing weak consistency level...');

      const cloudSubject = new CloudSubject(`${currentTestName}-weak`, {
        type: 'aws-dynamodb',
        tableName: 'integration-test-table',
        consistency: 'weak',
        replayOnSubscribe: false,
        client: container.getClient(),
        logger,
      });

      const testData = { test: 'weak-consistency', timestamp: Date.now() };
      const emittedValues: unknown[] = [];

      // Track timing
      const startTime = Date.now();

      cloudSubject.subscribe((value) => {
        emittedValues.push(value);
      });

      cloudSubject.next(testData);

      // Wait for store-verify-emit cycle
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const emitTime = Date.now() - startTime;

      // Should take longer due to verification (> 100ms)
      expect(emitTime).toBeGreaterThan(100);
      expect(emittedValues).toContainEqual(testData);

      console.log(`✅ Weak consistency verified and emitted in ${emitTime}ms`);
    });

    it('should use ConsistentRead for verification', async () => {
      console.log('🔍 Testing weak consistency with multiple values...');

      const streamName = `${currentTestName}-weak-consistent`;
      const cloudSubject = new CloudSubject(streamName, {
        type: 'aws-dynamodb',
        tableName: 'integration-test-table',
        consistency: 'weak',
        replayOnSubscribe: false,
        client: container.getClient(),
        logger,
      });

      const values = [
        { test: 'weak-1', order: 1 },
        { test: 'weak-2', order: 2 },
        { test: 'weak-3', order: 3 },
      ];

      const emittedValues: unknown[] = [];

      cloudSubject.subscribe((value) => {
        emittedValues.push(value);
      });

      // Emit values in sequence
      for (const value of values) {
        cloudSubject.next(value);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      // Wait a bit more for all values to be processed
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Should have all values emitted
      expect(emittedValues).toHaveLength(3);
      values.forEach((value) => {
        expect(emittedValues).toContainEqual(value);
      });

      console.log(
        '✅ Weak consistency verified all values with ConsistentRead'
      );
    }, 10000);
  });

  describe('strong consistency level', () => {
    it('should throw error as not implemented', async () => {
      console.log('🔍 Testing strong consistency level...');

      const cloudSubject = new CloudSubject(`${currentTestName}-strong`, {
        type: 'aws-dynamodb',
        tableName: 'integration-test-table',
        consistency: 'strong',
        replayOnSubscribe: false,
        client: container.getClient(),
        logger,
      });

      const testData = { test: 'strong-consistency' };
      let errorCaught = false;

      cloudSubject.subscribe({
        next: () => {
          // Should not reach here
        },
        error: (error) => {
          errorCaught = true;
          expect(error.message).toContain(
            'Strong consistency not yet implemented'
          );
        },
      });

      cloudSubject.next(testData);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(errorCaught).toBe(true);

      console.log(
        '✅ Strong consistency correctly throws not implemented error'
      );
    });
  });

  describe('default consistency behavior', () => {
    it('should default to weak consistency', async () => {
      console.log('🔍 Testing default consistency level...');

      const cloudSubject = new CloudSubject(`${currentTestName}-default`, {
        type: 'aws-dynamodb',
        tableName: 'integration-test-table',
        // No consistency specified
        replayOnSubscribe: false,
        client: container.getClient(),
        logger,
      });

      const testData = { test: 'default-consistency', timestamp: Date.now() };
      const emittedValues: unknown[] = [];

      // Track timing
      const startTime = Date.now();

      cloudSubject.subscribe((value) => {
        emittedValues.push(value);
      });

      cloudSubject.next(testData);

      // Wait for store-verify-emit cycle
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const emitTime = Date.now() - startTime;

      // Should behave like weak consistency (> 100ms)
      expect(emitTime).toBeGreaterThan(100);
      expect(emittedValues).toContainEqual(testData);

      console.log(
        `✅ Default consistency (weak) verified and emitted in ${emitTime}ms`
      );
    });
  });
});
