#!/usr/bin/env node

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
export { Logger, InfoLogger } from './util';

// CLI - Command Line Interface entry point
import { Cli } from './cli';

// Cli Entrypoint
if (require.main === module) {
  Cli.run().catch((error) => {
    process.stderr.write('CLI Error:', error);
    process.stderr.write('\n');
    process.exit(1);
  });
}
