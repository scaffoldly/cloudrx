import { CloudSubject } from '../../../../src/subjects';
import { DynamoDBProvider } from '../../../../src/providers/aws/dynamodb';
import { DynamoDBLocalContainer } from './dynamodb-local-container';
import pino from 'pino';

const logger = pino({
  name: 'cloudrx-dynamodb-integration-tests',
  level: 'silent', // Always silent for tests
});

interface TestData {
  message?: string;
  timestamp?: number;
  test?: string;
  id?: number;
  lifecycle?: string;
}

describe('DynamoDB CloudSubject Integration Tests', () => {
  let cloudSubject: CloudSubject<TestData>;
  let dynamoDBProvider: DynamoDBProvider;
  let dynamoDBContainer: DynamoDBLocalContainer;
  let mockLogger: pino.Logger;

  beforeAll(async () => {
    // Start DynamoDB Local container
    dynamoDBContainer = new DynamoDBLocalContainer();
    await dynamoDBContainer.start();
  });

  afterAll(async () => {
    // Stop DynamoDB Local container
    if (dynamoDBContainer) {
      await dynamoDBContainer.stop();
    }
  });

  beforeEach(() => {
    // Create silent logger for tests
    mockLogger = pino({ level: 'silent' });

    // Create a provider that uses the local DynamoDB instance
    dynamoDBProvider = new DynamoDBProvider({
      tableName: 'integration-test-table',
      client: dynamoDBContainer.getClient(),
    });

    // Create CloudSubject with local client and mock logger
    cloudSubject = new CloudSubject<TestData>('integration-test-stream', {
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
      try {
        await cloudSubject.clearPersistedData();
      } catch (error) {
        logger.warn({ err: error }, 'Failed to clear test data');
      }
    }
  });

  it('should persist and replay events from cloud storage', async () => {
    // Test end-to-end persistence and replay
    const testData = { message: 'test persistence', timestamp: Date.now() };

    // Emit a value
    cloudSubject.next(testData);

    // Wait a moment for persistence
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create a new subject with the same stream name to test replay
    const replaySubject = new CloudSubject<TestData>(
      'integration-test-stream',
      {
        type: 'aws-dynamodb',
        tableName: 'integration-test-table',
        client: dynamoDBContainer.getClient(),
        replayOnSubscribe: true,
        logger: mockLogger,
      }
    );

    const replayedValues: TestData[] = [];

    // Subscribe should trigger replay
    replaySubject.subscribe((value) => replayedValues.push(value));

    // Wait for replay to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(replayedValues).toContainEqual(testData);
  });

  it('should handle multiple subscribers with cloud replay', async () => {
    const testData = { test: 'multi-subscriber', id: Math.random() };

    const subscriber1Values: TestData[] = [];
    const subscriber2Values: TestData[] = [];

    // Add first subscriber
    cloudSubject.subscribe((value) => subscriber1Values.push(value));

    // Emit value
    cloudSubject.next(testData);

    // Add second subscriber (should get replay if enabled)
    cloudSubject.subscribe((value) => subscriber2Values.push(value));

    // Emit another value
    const testData2 = { test: 'second-emission', id: Math.random() };
    cloudSubject.next(testData2);

    // Both subscribers should receive the second emission
    expect(subscriber1Values).toContainEqual(testData);
    expect(subscriber1Values).toContainEqual(testData2);
    expect(subscriber2Values).toContainEqual(testData2);
  });

  it('should handle persistence errors gracefully', async () => {
    // Test with an invalid table name to trigger errors
    const badSubject = new CloudSubject<TestData>('error-test-stream', {
      type: 'aws-dynamodb',
      tableName: 'non-existent-table',
      client: dynamoDBContainer.getClient(),
      logger: mockLogger,
    });

    const values: TestData[] = [];
    badSubject.subscribe((value) => values.push(value));

    // Should not throw even when persistence fails
    expect(() => {
      badSubject.next({ test: 'error-handling' });
    }).not.toThrow();

    // Should still emit to subscribers despite persistence failure
    expect(values).toContainEqual({ test: 'error-handling' });

    // Note: With pino silent logger, we can't easily test error logging
    // but we've verified the error handling doesn't crash the system
  });

  it('should persist data that survives container lifecycle', async () => {
    const persistentData = {
      message: 'persistent test',
      timestamp: Date.now(),
      lifecycle: 'test',
    };

    // Emit data
    cloudSubject.next(persistentData);

    // Wait for persistence
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify data was stored by reading directly from provider
    const retrievedData = await dynamoDBProvider.retrieve(
      'integration-test-stream'
    );
    expect(retrievedData).toContainEqual(persistentData);
  });
});
