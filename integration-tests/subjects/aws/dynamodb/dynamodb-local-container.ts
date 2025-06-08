import {
  GenericContainer,
  StartedTestContainer,
  TestContainer,
} from 'testcontainers';
import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb';
import pino from 'pino';

const logger = pino({
  name: 'cloudrx-dynamodb-container',
  level: 'info', // Always show info level for debugging
});

export class DynamoDBLocalContainer {
  private container: TestContainer;
  private startedContainer: StartedTestContainer | null = null;
  private client: DynamoDBClient | null = null;

  constructor() {
    this.container = new GenericContainer('amazon/dynamodb-local:latest')
      .withExposedPorts(8000)
      .withCommand(['-jar', 'DynamoDBLocal.jar', '-inMemory', '-sharedDb']);
  }

  async start(): Promise<void> {
    try {
      logger.info('Starting DynamoDB Local container...');
      this.startedContainer = await this.container.start();

      const port = this.startedContainer.getMappedPort(8000);
      const endpoint = `http://localhost:${port}`;

      logger.info(`DynamoDB Local started at ${endpoint}`);

      // Create DynamoDB client pointing to local instance
      this.client = new DynamoDBClient({
        endpoint,
        region: 'local',
        credentials: {
          accessKeyId: 'fake',
          secretAccessKey: 'fake',
        },
      });

      // Create default test table
      await this.createTestTable();
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Cannot connect to the Docker daemon')) {
          throw new Error(
            '❌ Docker is not running!\n\n' +
              'Please start Docker Desktop or Docker daemon before running integration tests.\n' +
              'Integration tests require DynamoDB Local which runs in a Docker container.\n\n' +
              'To run tests without Docker, use: npm run test (unit tests only)'
          );
        }
        if (error.message.includes('docker: command not found')) {
          throw new Error(
            '❌ Docker is not installed!\n\n' +
              'Please install Docker Desktop to run integration tests.\n' +
              'Integration tests require DynamoDB Local which runs in a Docker container.\n\n' +
              'To run tests without Docker, use: npm run test (unit tests only)'
          );
        }
      }
      throw new Error(`Failed to start DynamoDB Local container: ${error}`);
    }
  }

  async stop(): Promise<void> {
    if (this.startedContainer) {
      logger.info('Stopping DynamoDB Local container...');
      await this.startedContainer.stop();
      this.startedContainer = null;
    }
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }

  getClient(): DynamoDBClient {
    if (!this.client) {
      throw new Error('DynamoDB Local container not started');
    }
    return this.client;
  }

  getEndpoint(): string {
    if (!this.startedContainer) {
      throw new Error('DynamoDB Local container not started');
    }
    const port = this.startedContainer.getMappedPort(8000);
    return `http://localhost:${port}`;
  }

  async createCustomTable(tableName: string): Promise<void> {
    await this.createTestTable(tableName);
  }

  private async createTestTable(customTableName?: string): Promise<void> {
    if (!this.client) {
      throw new Error('DynamoDB client not available');
    }

    const tableName = customTableName || 'integration-test-table';

    try {
      await this.client.send(
        new CreateTableCommand({
          TableName: tableName,
          KeySchema: [
            { AttributeName: 'streamName', KeyType: 'HASH' },
            { AttributeName: 'key', KeyType: 'RANGE' },
          ],
          AttributeDefinitions: [
            { AttributeName: 'streamName', AttributeType: 'S' },
            { AttributeName: 'key', AttributeType: 'S' },
          ],
          BillingMode: 'PAY_PER_REQUEST',
        })
      );

      logger.info(`✅ Successfully created table: ${tableName}`);
    } catch (error: unknown) {
      // If table already exists, that's OK - just log it
      if (error instanceof Error && error.name === 'ResourceInUseException') {
        logger.info(`ℹ️ Table ${tableName} already exists, continuing...`);
      } else {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(
          { error: errorMessage, tableName },
          `❌ Failed to create table: ${tableName}`
        );
        throw error;
      }
    }
  }
}
