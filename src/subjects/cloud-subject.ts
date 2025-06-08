import { Subject, Subscription, Observer } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { of, from } from 'rxjs';
import { CloudProvider } from '../providers/cloud-provider';
import { DynamoDBProvider } from '../providers/aws/dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import pino from 'pino';
import { createLogger } from '../utils/logger';

const defaultLogger = createLogger('cloudrx');

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
    // Use the provider's persist method for store-then-verify-then-emit pattern
    this.provider
      .persist(this.streamName, value, (verifiedValue) => {
        super.next(verifiedValue);
      })
      .subscribe({
        error: () => {
          // Error already handled in persist method, just prevent unhandled promise rejection
        },
      });
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

  private async replayPersistedEvents(): Promise<void> {
    this.provider
      .isReady()
      .pipe(
        switchMap((ready) => {
          if (ready) {
            return from(this.provider.all<T>(this.streamName));
          } else {
            throw new Error('Provider is not ready');
          }
        }),
        catchError((error) => {
          this.logger.warn(
            { err: error.message, streamName: this.streamName },
            'Failed to replay events from cloud provider'
          );
          return of([]); // Continue operation - subscriber will still get new events
        })
      )
      .subscribe((events) => {
        events.forEach((event: T) => super.next(event));
      });
  }

  /**
   * Clean up CloudSubject resources
   */
  public dispose(): void {
    this.complete();
  }
}
