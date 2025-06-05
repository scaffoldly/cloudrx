import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { CloudProvider } from '../../cloud-provider';
import pino from 'pino';

export interface DynamoDBProviderConfig {
  tableName: string;
  region?: string;
  client?: DynamoDBClient;
}

export class DynamoDBProvider implements CloudProvider {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;
  private logger = pino({
    name: 'cloudrx-dynamodb',
    level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  });

  constructor(config: DynamoDBProviderConfig) {
    this.tableName = config.tableName;

    const client =
      config.client ||
      new DynamoDBClient({
        region: config.region || 'us-east-1',
      });

    this.docClient = DynamoDBDocumentClient.from(client);
  }

  async store<T>(streamName: string, value: T): Promise<void> {
    const timestamp = Date.now();
    const item = {
      streamName,
      timestamp,
      sortKey: `${timestamp}#${Math.random().toString(36).substring(7)}`,
      data: value,
      ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days TTL
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );
  }

  async retrieve<T>(streamName: string): Promise<T[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'streamName = :streamName',
      ExpressionAttributeValues: {
        ':streamName': streamName,
      },
      ScanIndexForward: true, // Sort by sort key ascending (chronological order)
    });

    const result = await this.docClient.send(command);
    return (result.Items || []).map(
      (item: Record<string, unknown>) => item.data as T
    );
  }

  async clear(streamName: string): Promise<void> {
    // First, get all items for this stream
    const items = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'streamName = :streamName',
        ExpressionAttributeValues: {
          ':streamName': streamName,
        },
        ProjectionExpression: 'streamName, sortKey',
      })
    );

    // Delete each item
    if (items.Items && items.Items.length > 0) {
      for (const item of items.Items) {
        await this.docClient.send(
          new DeleteCommand({
            TableName: this.tableName,
            Key: {
              streamName: item.streamName,
              sortKey: item.sortKey,
            },
          })
        );
      }
    }
  }

  async isReady(): Promise<boolean> {
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
      this.logger.error({ error }, 'DynamoDB provider health check failed');
      return false;
    }
  }
}
