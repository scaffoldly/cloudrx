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

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: jest.fn().mockImplementation((command: { constructor: { name: string }; input: { Item: unknown } }) => {
        if (command.constructor.name === 'PutCommand') {
          // Store the item in our mock
          mockItems.push(command.input.Item);
          return Promise.resolve({});
        } else if (command.constructor.name === 'QueryCommand') {
          // Return stored items for retrieve
          return Promise.resolve({ Items: mockItems });
        }
        return Promise.resolve({ Items: [] });
      }),
    }),
  },
  PutCommand: jest.fn().mockImplementation((input) => ({ input, constructor: { name: 'PutCommand' } })),
  QueryCommand: jest.fn().mockImplementation((input) => ({ input, constructor: { name: 'QueryCommand' } })),
  DeleteCommand: jest.fn().mockImplementation((input) => ({ input, constructor: { name: 'DeleteCommand' } })),
}));

describe('CloudSubject', () => {
  let mockLogger: pino.Logger;

  beforeEach(() => {
    mockLogger = createLogger('test-logger', 'error');
    mockItems = []; // Clear mock items between tests
  });


  it('should create a CloudSubject with DynamoDB provider', () => {
    const cloudSubject = new CloudSubject('my-stream', {
      type: 'aws-dynamodb',
      tableName: 'test-table',
      logger: mockLogger,
    });

    expect(cloudSubject).toBeDefined();
    expect(cloudSubject).toBeInstanceOf(CloudSubject);
  });

  it('should emit values to subscribers', (done) => {
    const cloudSubject = new CloudSubject<string>('test-stream', {
      type: 'aws-dynamodb',
      tableName: 'test-table',
      replayOnSubscribe: false, // Disable replay for this test
      logger: mockLogger,
    });

    cloudSubject.subscribe((value: string) => {
      expect(value).toBe('test-message');
      done();
    });

    cloudSubject.next('test-message');
  }, 10000);

  it('should demonstrate Jest console.log interception', () => {
    // Jest automatically intercepts console.log calls in tests
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    
    console.log('🧪 This console.log is intercepted by Jest');
    console.log('📋 Jest captures this for test verification');
    
    // Verify console.log was called
    expect(consoleSpy).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalledWith('🧪 This console.log is intercepted by Jest');
    expect(consoleSpy).toHaveBeenCalledWith('📋 Jest captures this for test verification');
    
    // Restore original console.log
    consoleSpy.mockRestore();
  });
});
