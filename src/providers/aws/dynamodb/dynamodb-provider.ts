import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { CloudProvider, CloudProviderOptions } from '../../cloud-provider';
import { createLogger } from '../../../utils/logger';

export interface DynamoDBProviderConfig extends CloudProviderOptions {
  tableName: string;
  region?: string;
  client?: DynamoDBClient;
}

export class DynamoDBProvider<
  T,
  Key extends string = string,
> extends CloudProvider<T, Key> {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor(config: DynamoDBProviderConfig) {
    super({
      ...config,
      logger: config.logger || createLogger('cloudrx-dynamodb'),
    });
    this.tableName = config.tableName;

    const client =
      config.client ||
      new DynamoDBClient({
        region: config.region || 'us-east-1',
      });

    this.docClient = DynamoDBDocumentClient.from(client);
  }

  async store(streamName: string, key: Key, value: T): Promise<Key> {
    const timestamp = this.now();
    const sortKey = `${timestamp}#${key}#${Math.random().toString(36).substring(7)}`;
    const item = {
      streamName,
      timestamp,
      key: sortKey,
      data: value,
      ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days TTL
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );

    return sortKey as Key;
  }

  async all(streamName: string): Promise<T[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'streamName = :streamName',
      ExpressionAttributeValues: {
        ':streamName': streamName,
      },
      ScanIndexForward: true, // Sort by sort key ascending (chronological order)
      ConsistentRead: this.consistency === 'weak',
    });

    const result = await this.docClient.send(command);
    return (result.Items || []).map(
      (item: Record<string, unknown>) => item.data as T
    );
  }

  async retrieve(streamName: string, key: Key): Promise<T | undefined> {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'streamName = :streamName AND #key = :key',
      ExpressionAttributeNames: {
        '#key': 'key',
      },
      ExpressionAttributeValues: {
        ':streamName': streamName,
        ':key': key,
      },
      ConsistentRead: this.consistency === 'weak',
    });

    const result = await this.docClient.send(command);
    if (result.Items && result.Items.length > 0 && result.Items[0]) {
      return result.Items[0].data as T;
    }
    return undefined;
  }

  protected async init(): Promise<boolean> {
    // Try readiness check with retries (even in test env to ensure table exists)
    const maxAttempts = process.env.NODE_ENV === 'test' ? 5 : 10;
    const delayMs = process.env.NODE_ENV === 'test' ? 200 : 1000;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const ready = await this.checkReadiness();
        if (ready) {
          this.logger.info('DynamoDB provider is ready');
          return true;
        }
        this.logger.debug(
          `DynamoDB provider not ready yet, attempt ${attempt}/${maxAttempts}`
        );
        // Wait before next attempt
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.debug(
          { error },
          `DynamoDB readiness check failed, attempt ${attempt}/${maxAttempts}`
        );
        // Wait before next attempt
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    this.logger.error('DynamoDB provider failed to become ready after retries');
    // Always throw an error if we can't become ready
    throw (
      lastError ||
      new Error('DynamoDB provider failed to become ready after retries')
    );
  }

  /**
   * Clean up any ongoing subscriptions (useful for testing)
   */
  dispose(): void {
    super.dispose();
  }

  private async checkReadiness(): Promise<boolean> {
    try {
      // Simple health check - try to query the table
      await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'streamName = :test',
          ExpressionAttributeValues: {
            ':test': '__health_check__',
          },
          Limit: 1,
        })
      );
      return true;
    } catch (error) {
      this.logger.debug(
        { error },
        'DynamoDB provider health check failed, retrying...'
      );
      return false;
    }
  }
}
