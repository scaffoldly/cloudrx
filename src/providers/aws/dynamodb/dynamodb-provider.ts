import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Observable, of, from, defer, throwError } from 'rxjs';
import { switchMap, retry, catchError, tap } from 'rxjs/operators';
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
  private client: DynamoDBClient;
  private tableName: string;

  constructor(config: DynamoDBProviderConfig) {
    super({
      ...config,
      logger: config.logger || createLogger('cloudrx-dynamodb'),
    });
    this.tableName = config.tableName;

    this.client =
      config.client ||
      new DynamoDBClient({
        region: config.region || 'us-east-1',
      });

    this.docClient = DynamoDBDocumentClient.from(this.client);
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

  protected init(): Observable<boolean> {
    // In test environment, handle differently based on client setup
    if (process.env.NODE_ENV === 'test') {
      // If no custom client provided, assume we're using mocks (unit tests)
      const clientConfig = (
        this.client as unknown as { config?: { endpoint?: string } }
      ).config;
      if (!clientConfig?.endpoint) {
        this.logger.info(
          'DynamoDB provider is ready (test environment with mocks)'
        );
        return of(true);
      }
    }

    // For real environments and integration tests, check table status
    const maxAttempts = process.env.NODE_ENV === 'test' ? 5 : 10;
    const delayMs = process.env.NODE_ENV === 'test' ? 200 : 1000;

    return defer(() => this.checkTableStatus()).pipe(
      retry({ count: maxAttempts - 1, delay: delayMs }),
      tap((ready) => {
        if (ready) {
          this.logger.info('DynamoDB provider is ready - table is ACTIVE');
        } else {
          this.logger.debug('DynamoDB table is not ready yet');
        }
      }),
      catchError((error) => {
        this.logger.error(
          { error },
          'DynamoDB provider failed to become ready after retries'
        );
        return throwError(() => error);
      })
    );
  }

  /**
   * Clean up any ongoing subscriptions (useful for testing)
   */
  dispose(): void {
    super.dispose();
  }

  private checkTableStatus(): Observable<boolean> {
    return from(
      this.client.send(
        new DescribeTableCommand({
          TableName: this.tableName,
        })
      )
    ).pipe(
      switchMap((response) => {
        const tableStatus = response.Table?.TableStatus;
        this.logger.debug(
          { tableStatus },
          `DynamoDB table status: ${tableStatus}`
        );

        if (tableStatus === 'ACTIVE') {
          return of(true);
        } else {
          // Table exists but not active yet (CREATING, UPDATING, etc.)
          return throwError(
            () =>
              new Error(`Table status is ${tableStatus}, waiting for ACTIVE`)
          );
        }
      }),
      catchError((error) => {
        this.logger.debug(
          { error },
          'DynamoDB table status check failed, retrying...'
        );
        return throwError(() => error);
      })
    );
  }
}
