import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { CloudProvider, CloudProviderOptions } from '../../cloud-provider';
import { from, defer, of } from 'rxjs';
import { switchMap, delay, catchError, retry, tap } from 'rxjs/operators';
import { createLogger } from '../../../utils/logger';

export interface DynamoDBProviderConfig extends CloudProviderOptions {
  tableName: string;
  region?: string;
  client?: DynamoDBClient;
}

export class DynamoDBProvider extends CloudProvider {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;
  private logger = createLogger('cloudrx-dynamodb');
  private readinessSubscription?: { unsubscribe(): void };

  constructor(config: DynamoDBProviderConfig) {
    super(config);
    this.tableName = config.tableName;

    const client =
      config.client ||
      new DynamoDBClient({
        region: config.region || 'us-east-1',
      });

    this.docClient = DynamoDBDocumentClient.from(client);
  }

  async store<T>(streamName: string, value: T): Promise<void> {
    const timestamp = this.now();
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

  async all<T>(streamName: string): Promise<T[]> {
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

  protected initializeReadiness(): void {
    // For DynamoDB Local in tests, assume it's ready immediately
    if (process.env.NODE_ENV === 'test') {
      this.setReady(true);
      return;
    }

    // Use a recursive retry pattern without timers for production
    this.readinessSubscription = defer(() => from(this.checkReadiness()))
      .pipe(
        switchMap((ready) => {
          if (ready) {
            return of(true);
          } else {
            // If not ready, wait and throw to trigger retry
            return of(null).pipe(
              delay(1000),
              switchMap(() => {
                throw new Error('Not ready, retrying...');
              })
            );
          }
        }),
        retry({ count: 10, delay: 1000 }),
        catchError(() => {
          this.logger.error(
            'DynamoDB provider failed to become ready after retries'
          );
          return of(false);
        }),
        tap((ready) => {
          if (ready) {
            this.logger.info('DynamoDB provider is ready');
          } else {
            this.logger.debug('DynamoDB provider not ready yet, will retry');
          }
        })
      )
      .subscribe({
        next: (ready) => {
          this.setReady(ready);
          // Clean up the subscription since we're done
          if (this.readinessSubscription) {
            this.readinessSubscription.unsubscribe();
          }
        },
        error: (error) => {
          this.logger.error({ error }, 'Error during readiness check');
          this.setReady(false);
          // Clean up the subscription on error
          if (this.readinessSubscription) {
            this.readinessSubscription.unsubscribe();
          }
        },
      });
  }

  /**
   * Clean up any ongoing subscriptions (useful for testing)
   */
  dispose(): void {
    if (this.readinessSubscription) {
      this.readinessSubscription.unsubscribe();
    }
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
