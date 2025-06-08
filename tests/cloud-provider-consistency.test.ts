import { CloudSubject } from '../src/subjects/cloud-subject';
import { createLogger } from '../src/utils/logger';
import pino from 'pino';

// Mock the AWS SDK to prevent actual network calls during tests
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    // Mock client that doesn't make real calls
  })),
}));

let mockItems: unknown[] = [];
let storeCalls = 0;
let retrieveCalls = 0;
let consistentReadUsed = false;

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: jest.fn().mockImplementation(
        (command: {
          constructor: { name: string };
          input: {
            Item?: unknown;
            ConsistentRead?: boolean;
          };
        }) => {
          if (command.constructor.name === 'PutCommand') {
            storeCalls++;
            // Store the item in our mock
            mockItems.push(command.input.Item);
            return Promise.resolve({});
          } else if (command.constructor.name === 'QueryCommand') {
            retrieveCalls++;
            // Track if ConsistentRead was used
            if (command.input.ConsistentRead !== undefined) {
              consistentReadUsed = command.input.ConsistentRead;
            }
            // Return stored items for retrieve
            return Promise.resolve({ Items: mockItems });
          }
          return Promise.resolve({ Items: [] });
        }
      ),
    }),
  },
  PutCommand: jest.fn().mockImplementation((input) => ({
    input,
    constructor: { name: 'PutCommand' },
  })),
  QueryCommand: jest.fn().mockImplementation((input) => ({
    input,
    constructor: { name: 'QueryCommand' },
  })),
  DeleteCommand: jest.fn().mockImplementation((input) => ({
    input,
    constructor: { name: 'DeleteCommand' },
  })),
}));

describe('CloudProvider Consistency Levels', () => {
  let mockLogger: pino.Logger;

  beforeEach(() => {
    mockLogger = createLogger('test-logger', 'error');
    mockItems = []; // Clear mock items between tests
    storeCalls = 0;
    retrieveCalls = 0;
    consistentReadUsed = false;
  });

  describe('none consistency', () => {
    it('should store and emit immediately without verification', (done) => {
      const cloudSubject = new CloudSubject('test-stream', {
        type: 'aws-dynamodb',
        tableName: 'test-table',
        consistency: 'none',
        replayOnSubscribe: false,
        logger: mockLogger,
      });

      const testData = { value: 'test-none-consistency' };

      cloudSubject.subscribe((value) => {
        expect(value).toEqual(testData);

        // Wait a bit to ensure no retrieve was called
        setTimeout(() => {
          expect(storeCalls).toBe(1);
          expect(retrieveCalls).toBe(0); // No verification retrieve
          done();
        }, 200);
      });

      cloudSubject.next(testData);
    }, 10000);

    it('should NOT emit if store fails with none consistency', (done) => {
      // Mock a failing store
      const failingMock = {
        send: jest.fn().mockRejectedValue(new Error('Store failed')),
      };

      jest
        .mocked(require('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient.from)
        .mockReturnValueOnce(failingMock);

      const cloudSubject = new CloudSubject('test-stream', {
        type: 'aws-dynamodb',
        tableName: 'test-table',
        consistency: 'none',
        replayOnSubscribe: false,
        logger: mockLogger,
      });

      const testData = { value: 'test-none-consistency-failure' };
      let emitted = false;

      cloudSubject.subscribe({
        next: () => {
          emitted = true;
        },
        error: (error) => {
          expect(error.message).toContain('Store failed');
          expect(emitted).toBe(false);
          done();
        },
      });

      cloudSubject.next(testData);
    }, 10000);
  });

  describe('weak consistency', () => {
    it('should store and verify with ConsistentRead before emitting', (done) => {
      const cloudSubject = new CloudSubject('test-stream', {
        type: 'aws-dynamodb',
        tableName: 'test-table',
        consistency: 'weak',
        replayOnSubscribe: false,
        logger: mockLogger,
      });

      const testData = { value: 'test-weak-consistency' };

      cloudSubject.subscribe((value) => {
        expect(value).toEqual(testData);

        // Verify store and retrieve were called
        expect(storeCalls).toBe(1);
        expect(retrieveCalls).toBeGreaterThanOrEqual(1); // At least one retrieve for verification
        expect(consistentReadUsed).toBe(true); // Should use ConsistentRead
        done();
      });

      cloudSubject.next(testData);
    }, 10000);

    it('should be the default consistency level', (done) => {
      const cloudSubject = new CloudSubject('test-stream', {
        type: 'aws-dynamodb',
        tableName: 'test-table',
        // No consistency specified - should default to 'weak'
        replayOnSubscribe: false,
        logger: mockLogger,
      });

      const testData = { value: 'test-default-consistency' };

      cloudSubject.subscribe((value) => {
        expect(value).toEqual(testData);

        // Verify it behaves like weak consistency
        expect(storeCalls).toBe(1);
        expect(retrieveCalls).toBeGreaterThanOrEqual(1);
        expect(consistentReadUsed).toBe(true);
        done();
      });

      cloudSubject.next(testData);
    }, 10000);
  });

  describe('strong consistency', () => {
    it('should throw error as not implemented', (done) => {
      const cloudSubject = new CloudSubject('test-stream', {
        type: 'aws-dynamodb',
        tableName: 'test-table',
        consistency: 'strong',
        replayOnSubscribe: false,
        logger: mockLogger,
      });

      const testData = { value: 'test-strong-consistency' };

      // Subscribe to error events
      cloudSubject.subscribe({
        next: () => {
          // Should not reach here
          done(new Error('Should not emit with strong consistency'));
        },
        error: (error) => {
          expect(error.message).toContain(
            'Strong consistency not yet implemented'
          );
          done();
        },
      });

      cloudSubject.next(testData);
    }, 10000);
  });

  describe('consistency with replay', () => {
    it('should replay existing values on subscribe', (done) => {
      // Pre-populate some data
      mockItems = [
        { data: { value: 'existing-1' } },
        { data: { value: 'existing-2' } },
      ];

      const cloudSubject = new CloudSubject('test-stream', {
        type: 'aws-dynamodb',
        tableName: 'test-table',
        consistency: 'weak',
        replayOnSubscribe: true,
        logger: mockLogger,
      });

      const receivedValues: unknown[] = [];

      cloudSubject.subscribe((value) => {
        receivedValues.push(value);

        if (receivedValues.length === 2) {
          // Should have replayed the existing values
          expect(receivedValues).toEqual([
            { value: 'existing-1' },
            { value: 'existing-2' },
          ]);

          // Replay uses all() method, not allWithConsistency
          expect(retrieveCalls).toBeGreaterThanOrEqual(1);
          done();
        }
      });
    }, 10000);
  });
});
