export interface CloudProvider {
  /**
   * Store a value in the cloud provider under the given stream name
   */
  store<T>(streamName: string, value: T): Promise<void>;

  /**
   * Retrieve all values for a given stream name
   */
  retrieve<T>(streamName: string): Promise<T[]>;

  /**
   * Clear all data for a given stream name
   */
  clear(streamName: string): Promise<void>;

  /**
   * Check if the provider is connected and ready
   */
  isReady(): Promise<boolean>;
}
