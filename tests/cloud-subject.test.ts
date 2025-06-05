import { CloudSubject } from '../src/subjects/cloud-subject';
import pino from 'pino';

// Mock the AWS SDK to prevent actual network calls during tests
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    // Mock client that doesn't make real calls
  })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: jest.fn().mockResolvedValue({ Items: [] }),
    }),
  },
  PutCommand: jest.fn(),
  QueryCommand: jest.fn(),
  DeleteCommand: jest.fn(),
}));

describe('CloudSubject', () => {
  let mockLogger: pino.Logger;

  beforeEach(() => {
    mockLogger = pino({ level: 'silent' });
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
  });
});
