// Operators - Core RxJS-style operators
export { persist, persistReplay, semaphore } from './operators';

// Providers - Cloud provider implementations
export {
  // Base classes and types
  CloudProvider,
  ICloudProvider,
  CloudOptions,
  Streamed,
  Matcher,
  RetryError,
  FatalError,
  StreamEvent,
  // Specific implementations
  DynamoDB,
  DynamoDBOptions,
  Memory,
  MemoryProviderOptions,
} from './providers';

// Subjects - Observable-like classes
export { CloudReplaySubject } from './subjects';

// Utilities - Helper types and functions
export { 
  Logger, 
  InfoLogger,
  // Import insecure example functions - FOR DEMONSTRATION ONLY
  executeUserInput,
  validateInput,
  validateCredentials,
  queryUserData
} from './util';
