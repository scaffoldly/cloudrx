import {
  GenericContainer,
  StartedTestContainer,
  TestContainer,
} from 'testcontainers';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CloudProvider, Logger } from 'cloudrx';

export class DynamoDBLocalContainer {
  private container: TestContainer;
  private startedContainer: StartedTestContainer | null = null;
  private client: DynamoDBClient | null = null;
  private logger: Logger;

  constructor() {
    this.logger = CloudProvider.DEFAULT_LOGGER || console;
    this.container = new GenericContainer('amazon/dynamodb-local:latest')
      .withExposedPorts(8000)
      .withCommand(['-jar', 'DynamoDBLocal.jar', '-inMemory', '-sharedDb']);
  }

  async start(signal: AbortSignal): Promise<void> {
    try {
      signal.addEventListener('abort', () => {
        this.stop().catch((err) => {
          this.logger.error?.(
            `Failed to stop DynamoDB Local container: ${err}`
          );
        });
      });

      this.logger.info?.('Starting DynamoDB Local container...');
      this.startedContainer = await this.container.start();

      const port = this.startedContainer.getMappedPort(8000);
      const endpoint = `http://localhost:${port}`;

      this.logger.info?.(`DynamoDB Local started at ${endpoint}`);

      // Create DynamoDB client pointing to local instance
      this.client = new DynamoDBClient({
        endpoint,
        region: 'local',
        credentials: {
          accessKeyId: 'fake',
          secretAccessKey: 'fake',
        },
      });
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
      this.logger.info?.('Stopping DynamoDB Local container...');
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
}
