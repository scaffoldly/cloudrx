import { Subject, Subscription, Observer } from 'rxjs';
import { CloudProvider } from '../providers/cloud-provider';
import { DynamoDBProvider } from '../providers/aws/dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import pino from 'pino';

const defaultLogger = pino({
  name: 'cloudrx',
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
});

export interface CloudSubjectConfig {
  type: 'aws-s3' | 'aws-dynamodb';
  replayOnSubscribe?: boolean;
  logger?: pino.Logger;
}

export interface CloudSubjectDynamoDBConfig extends CloudSubjectConfig {
  type: 'aws-dynamodb';
  tableName: string;
  region?: string;
  client?: DynamoDBClient;
}

export interface CloudSubjectS3Config extends CloudSubjectConfig {
  type: 'aws-s3';
  bucketName: string;
  region?: string;
}

export class CloudSubject<T> extends Subject<T> {
  private provider: CloudProvider;
  private streamName: string;
  private replayOnSubscribe: boolean;
  private logger: pino.Logger;

  constructor(
    streamName: string,
    config: CloudSubjectDynamoDBConfig | CloudSubjectS3Config
  ) {
    super();
    this.streamName = streamName;
    this.provider = this.createProvider(config);
    this.replayOnSubscribe = config.replayOnSubscribe ?? true;
    this.logger = config.logger ?? defaultLogger;
  }

  private createProvider(
    config: CloudSubjectDynamoDBConfig | CloudSubjectS3Config
  ): CloudProvider {
    switch (config.type) {
      case 'aws-dynamodb':
        return new DynamoDBProvider({
          tableName: config.tableName,
          ...(config.region && { region: config.region }),
          ...(config.client && { client: config.client }),
        });
      case 'aws-s3':
        throw new Error('S3 provider not yet implemented');
      default:
        const exhaustiveCheck: never = config;
        throw new Error(`Unknown provider type: ${exhaustiveCheck}`);
    }
  }

  public next(value: T): void {
    // Persist to cloud provider (fire and forget)
    this.persistValue(value).catch(() => {
      // Error already handled in persistValue, just prevent unhandled promise rejection
    });

    // Emit to subscribers
    super.next(value);
  }

  public subscribe(
    observerOrNext?: Partial<Observer<T>> | ((value: T) => void)
  ): Subscription;
  public subscribe(
    next?: ((value: T) => void) | null,
    error?: ((error: unknown) => void) | null,
    complete?: (() => void) | null
  ): Subscription;
  public subscribe(
    observerOrNext?: Partial<Observer<T>> | ((value: T) => void) | null,
    error?: ((error: unknown) => void) | null,
    complete?: (() => void) | null
  ): Subscription {
    // If replay is enabled, load and replay persisted events
    if (this.replayOnSubscribe) {
      this.replayPersistedEvents().catch(() => {
        // Error already handled in replayPersistedEvents, just prevent unhandled promise rejection
      });
    }

    // Handle the different overload signatures
    if (error !== undefined || complete !== undefined) {
      // Called with separate callbacks - convert to observer object to avoid deprecated API
      const observer: Partial<Observer<T>> = {};
      if (observerOrNext) observer.next = observerOrNext as (value: T) => void;
      if (error) observer.error = error;
      if (complete) observer.complete = complete;
      return super.subscribe(observer);
    } else {
      // Called with observer object or single callback
      return super.subscribe(
        observerOrNext as Partial<Observer<T>> | ((value: T) => void)
      );
    }
  }

  private async persistValue(value: T): Promise<void> {
    try {
      await this.provider.store(this.streamName, value);
    } catch (error) {
      this.logger.error(
        { err: error, streamName: this.streamName },
        'Failed to persist value to cloud provider'
      );
      // Continue operation - don't fail the emission
    }
  }

  private async replayPersistedEvents(): Promise<void> {
    try {
      const events = await this.provider.retrieve<T>(this.streamName);
      events.forEach((event) => super.next(event));
    } catch (error) {
      this.logger.error(
        { err: error, streamName: this.streamName },
        'Failed to replay events from cloud provider'
      );
      // Continue operation - subscriber will still get new events
    }
  }

  public async clearPersistedData(): Promise<void> {
    await this.provider.clear(this.streamName);
  }
}
