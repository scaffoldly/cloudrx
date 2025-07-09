import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { Observable, from, of } from 'rxjs';
import { CloudOptions, CloudProvider } from '../base';
import { DynamoDBImpl } from './provider';

/**
 * Builder class for DynamoDB provider
 * Allows for fluent configuration of DynamoDB provider options
 */
export class DynamoDBBuilder<
  THashKey extends string = 'hashKey',
  TRangeKey extends string = 'rangeKey',
> extends Observable<DynamoDBImpl<THashKey, TRangeKey>> {
  private id: string;
  private options: CloudOptions = {};
  private client?: DynamoDBClient;
  private hashKey?: THashKey;
  private rangeKey?: TRangeKey;
  private ttlAttribute?: string;
  private pollInterval?: number;
  private initialized = false;
  
  constructor(id: string) {
    super(subscriber => {
      if (this.initialized) {
        return from(DynamoDBImpl.from(this.id, this.buildOptions())).subscribe(subscriber);
      }
      
      this.initialized = true;
      return from(DynamoDBImpl.from(this.id, this.buildOptions())).subscribe(subscriber);
    });
    this.id = id;
  }

  private checkInitialized(methodName: string): void {
    if (this.initialized) {
      throw new Error(`Cannot call ${methodName} after initialization`);
    }
  }

  private buildOptions() {
    return {
      ...this.options,
      client: this.client,
      hashKey: this.hashKey,
      rangeKey: this.rangeKey,
      ttlAttribute: this.ttlAttribute,
      pollInterval: this.pollInterval,
    };
  }

  /**
   * Set the DynamoDB client
   */
  withClient(client: DynamoDBClient): this {
    this.checkInitialized('withClient');
    this.client = client;
    return this;
  }

  /**
   * Set the hash key attribute name
   */
  withHashKey<T extends string>(hashKey: T): DynamoDBBuilder<T, TRangeKey> {
    this.checkInitialized('withHashKey');
    this.hashKey = hashKey as unknown as THashKey;
    return this as unknown as DynamoDBBuilder<T, TRangeKey>;
  }

  /**
   * Set the range key attribute name
   */
  withRangeKey<T extends string>(rangeKey: T): DynamoDBBuilder<THashKey, T> {
    this.checkInitialized('withRangeKey');
    this.rangeKey = rangeKey as unknown as TRangeKey;
    return this as unknown as DynamoDBBuilder<THashKey, T>;
  }

  /**
   * Set the TTL attribute name
   */
  withTtlAttribute(ttlAttribute: string): this {
    this.checkInitialized('withTtlAttribute');
    this.ttlAttribute = ttlAttribute;
    return this;
  }

  /**
   * Set the poll interval in milliseconds
   */
  withPollInterval(pollInterval: number): this {
    this.checkInitialized('withPollInterval');
    this.pollInterval = pollInterval;
    return this;
  }

  /**
   * Set the logger
   */
  withLogger(logger: CloudOptions['logger']): this {
    this.checkInitialized('withLogger');
    this.options.logger = logger;
    return this;
  }

  /**
   * Set the abort signal
   */
  withSignal(signal: AbortSignal): this {
    this.checkInitialized('withSignal');
    this.options.signal = signal;
    return this;
  }
}