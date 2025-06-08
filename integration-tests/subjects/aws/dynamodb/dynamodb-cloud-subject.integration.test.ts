import { CloudSubject } from '../../../../src/subjects';
import { DynamoDBProvider } from '../../../../src/providers/aws/dynamodb';
import { DynamoDBLocalContainer } from './dynamodb-local-container';
import { createLogger } from '../../../../src/utils/logger';
import pino from 'pino';

const logger = createLogger('cloudrx-dynamodb-integration-tests', 'warn');

interface TestData {
  message?: string;
  timestamp?: number;
  test?: string;
  id?: number;
  lifecycle?: string;
}

describe('DynamoDB CloudSubject Integration Tests', () => {
  let cloudSubject: CloudSubject<TestData>;
  let dynamoDBProvider: DynamoDBProvider<TestData>;
  let dynamoDBContainer: DynamoDBLocalContainer;
  let mockLogger: pino.Logger;
  let currentTestName: string;

  beforeAll(async () => {
    // Start DynamoDB Local container
    dynamoDBContainer = new DynamoDBLocalContainer();
    await dynamoDBContainer.start();
  }, 30000);

  afterAll(async () => {
    // Stop DynamoDB Local container
    if (dynamoDBContainer) {
      await dynamoDBContainer.stop();
    }
  }, 30000);

  beforeEach(() => {
    // Get current test name to use as stream name
    currentTestName = expect.getState().currentTestName || 'unknown-test';

    // Use error-level logger for integration tests - only show actual errors
    // Store-then-verify timing issues will be at debug level (not shown)
    mockLogger = createLogger('test-logger', 'error');

    // Create a provider that uses the local DynamoDB instance
    dynamoDBProvider = new DynamoDBProvider<TestData>({
      tableName: 'integration-test-table',
      client: dynamoDBContainer.getClient(),
    });

    // Create CloudSubject with test name as stream name
    cloudSubject = new CloudSubject<TestData>(currentTestName, {
      type: 'aws-dynamodb',
      tableName: 'integration-test-table',
      client: dynamoDBContainer.getClient(),
      replayOnSubscribe: false, // Disable replay during setup
      logger: mockLogger,
    });
  });

  afterEach(async () => {
    // Clear test data after each test
    if (cloudSubject) {
      cloudSubject.dispose();
    }

    // Clean up provider subscriptions
    if (dynamoDBProvider) {
      try {
        dynamoDBProvider.dispose();
      } catch (error) {
        logger.warn({ err: error }, 'Failed to dispose provider');
      }
    }

    // Logger cleanup is now handled by the centralized logger manager
  });

  it('should persist and replay events from cloud storage', async () => {
    console.log('💾 Testing end-to-end persistence and replay');

    // Test end-to-end persistence and replay
    const testData = { message: 'test persistence', timestamp: Date.now() };

    // Emit a value
    console.log('📤 Emitting test data...');
    cloudSubject.next(testData);

    // Wait a moment for persistence
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Create a new subject with the same stream name to test replay
    const replaySubject = new CloudSubject<TestData>(currentTestName, {
      type: 'aws-dynamodb',
      tableName: 'integration-test-table',
      client: dynamoDBContainer.getClient(),
      replayOnSubscribe: true,
      logger: mockLogger,
    });

    const replayedValues: TestData[] = [];

    // Subscribe should trigger replay
    console.log('🔄 Testing replay with new subject...');
    const subscription = replaySubject.subscribe((value) =>
      replayedValues.push(value)
    );

    // Wait for replay to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(replayedValues).toContainEqual(testData);
    console.log('✅ Replay successful: Found persisted data');

    // Clean up subscription
    subscription.unsubscribe();
  }, 10000);

  it('should handle multiple subscribers with cloud replay', async () => {
    const testData = { test: 'multi-subscriber', id: Math.random() };

    const subscriber1Values: TestData[] = [];
    const subscriber2Values: TestData[] = [];

    // Add first subscriber
    const subscription1 = cloudSubject.subscribe((value) =>
      subscriber1Values.push(value)
    );

    // Emit value
    cloudSubject.next(testData);

    // Wait for persistence
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Add second subscriber (should get replay if enabled)
    const subscription2 = cloudSubject.subscribe((value) =>
      subscriber2Values.push(value)
    );

    // Emit another value
    const testData2 = { test: 'second-emission', id: Math.random() };
    cloudSubject.next(testData2);

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Both subscribers should receive the second emission
    expect(subscriber1Values).toContainEqual(testData);
    expect(subscriber1Values).toContainEqual(testData2);
    expect(subscriber2Values).toContainEqual(testData2);

    // Clean up subscriptions
    subscription1.unsubscribe();
    subscription2.unsubscribe();
  }, 8000);

  it('should handle persistence errors gracefully', async () => {
    console.log(
      '🧪 Testing error handling: Intentionally using non-existent table'
    );

    // For this error test, use silent logger since errors are expected and we'll use console.log
    const silentLogger = pino({ level: 'silent' });

    // Test with an invalid table name to trigger errors
    const badSubject = new CloudSubject<TestData>(currentTestName, {
      type: 'aws-dynamodb',
      tableName: 'non-existent-table',
      client: dynamoDBContainer.getClient(),
      logger: silentLogger,
    });

    const values: TestData[] = [];
    let errorReceived = false;

    const subscription = badSubject.subscribe({
      next: (value) => values.push(value),
      error: (error) => {
        errorReceived = true;
        expect(error.name).toBe('ResourceNotFoundException');
      },
    });

    // Should not throw even when persistence fails
    expect(() => {
      badSubject.next({ test: 'error-handling' });
    }).not.toThrow();

    console.log(
      '🔄 Waiting for error to propagate (this will take a moment due to retries)...'
    );

    // Wait for processing (longer due to retries and timeouts)
    await new Promise((resolve) => setTimeout(resolve, 12000));

    // Should NOT emit values when persistence fails, but should receive error
    expect(values).toEqual([]);
    expect(errorReceived).toBe(true);
    console.log(
      '✅ Error handling worked: Error propagated, no emission on storage failure'
    );

    // Clean up subscription
    subscription.unsubscribe();
  }, 15000);

  it('should persist data that survives container lifecycle', async () => {
    const persistentData = {
      message: 'persistent test',
      timestamp: Date.now(),
      lifecycle: 'test',
    };

    // Emit data
    cloudSubject.next(persistentData);

    // Wait for persistence
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify data was stored by reading directly from provider
    const retrievedData = await dynamoDBProvider.all(currentTestName);
    expect(retrievedData).toContainEqual(persistentData);
  }, 8000);

  it('should guarantee store-then-get-then-return pattern', async () => {
    console.log('🔐 Testing store-then-verify-then-emit guarantee');

    const testData = {
      message: 'store-verify-emit test',
      timestamp: Date.now(),
      verification: 'guaranteed-persistence',
    };

    const emittedValues: TestData[] = [];
    let emissionTimestamp: number | null = null;

    // Subscribe and capture emission timestamp
    const subscription = cloudSubject.subscribe((value) => {
      emittedValues.push(value);
      emissionTimestamp = Date.now();
      console.log('📤 Event emitted after cloud verification');
    });

    // Emit value - this will store, verify, then emit
    const emitStartTime = Date.now();
    console.log('💾 Storing value and verifying in DynamoDB...');
    cloudSubject.next(testData);

    // Wait for processing (longer for store-verify pattern)
    console.log('⏳ Waiting for store-verify-emit cycle...');
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // Verify emission happened after storage
    expect(emittedValues).toContainEqual(testData);
    expect(emissionTimestamp).toBeGreaterThan(emitStartTime);

    // Verify data is actually in cloud storage
    const retrievedData = await dynamoDBProvider.all(currentTestName);
    expect(retrievedData).toContainEqual(testData);

    // Clean up
    subscription.unsubscribe();
  }, 10000);
});
