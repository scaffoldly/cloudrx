# Claude Notes for CloudRx Project

## Project Overview

CloudRx is a sophisticated TypeScript library that extends RxJS to provide cloud-backed reactive streams with automatic persistence and replay capabilities. It creates reactive interfaces for cloud services like DynamoDB Streams, enabling real-time event streaming with persistent storage and cross-instance data sharing.

## Usage Examples

### Basic DynamoDB Streaming with `persist` Operator

```typescript
import { of } from 'rxjs';
import { DynamoDB, persist } from 'cloudrx';

const options = {
  client: dynamoDbClient,
  hashKey: 'id',
  rangeKey: 'timestamp',
  signal: abortController.signal,
};

const provider$ = DynamoDB.from('my-table', options);
const data = [
  { message: 'hello', timestamp: Date.now() },
  { message: 'world', timestamp: Date.now() + 1 }
];

const result$ = of(...data).pipe(persist(provider$));
result$.subscribe(item => console.log('Item stored and confirmed:', item));
```

### CloudReplaySubject for Reactive Persistence with Backfill

```typescript
import { CloudReplaySubject, DynamoDB } from 'cloudrx';

const subject = new CloudReplaySubject(DynamoDB.from('events-table', options));

// Subscribe to persisted events (includes replay of historical data)
subject.subscribe(event => console.log('Received event:', event));
subject.on('expired', event => console.log('Event expired:', event));

// Emit values that are automatically persisted
subject.next({ type: 'user-action', data: { userId: 123 } });

// Emit values with expiration (TTL)
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
subject.next({ type: 'temporary-session', sessionId: 'abc123' }, expiresAt);
```

## Architecture

### CloudProvider Abstract Class (`src/providers/base.ts`)

- **Generic Type**: Uses `StreamEvent` (not `Event` to avoid DOM conflicts)
- **EventEmitter**: Uses Node.js 'events' module for type safety
- **Stream Method**: Returns Observable with `concatAll()` flattening for `all=true` mode
- **Error Handling**: Distinguishes between `RetryError` and `FatalError`
- **Singleton Pattern**: Uses `CloudProvider.from()` with instance caching by ID
- **Backfill Support**: `stream(all=true)` calls `_stream(true).pipe(concatAll())` to flatten record arrays into individual records

### CloudReplaySubject (`src/subjects/cloud-replay.ts`)

Cloud-backed RxJS ReplaySubject that automatically persists emissions and replays historical data for late subscribers.

**Core Architecture**:
```typescript
export class CloudReplaySubject<T> extends ReplaySubject<T> {
  private inner = new Subject<Expireable<T>>();
  private emitter = new EventEmitter<{ expired: [T] }>();
  private persist: Subscription;
  private stream: Subscription;
  private expired: Subscription;
}
```

**Key Features**:
- **Triple Subscription Model**: Separate subscriptions for persistence, stream replay, and expired events
- **Automatic Backfill**: Late subscribers receive all previously persisted data via ReplaySubject behavior
- **TTL Support**: Items can be emitted with optional expiration times using the `expires` parameter
- **Provider Integration**: Works with any CloudProvider (DynamoDB, Memory, etc.)

**Persistence Flow**:
1. **Inner Subject**: User emissions go to internal Subject<Expireable<T>>
2. **Persist Operator**: Internal Subject piped through `persist(provider)` for storage
3. **Stream Subscription**: Provider's `stream(true)` provides backfill and live updates
4. **Expired Subscription**: Provider's `expired()` stream emits expired events
5. **ReplaySubject Emission**: All data (backfilled and live) emitted to ReplaySubject subscribers

### DynamoDB Provider (`src/providers/aws/provider.ts`)

**Complete AWS Integration**:
- **Table Management**: Automatic table creation/validation with proper schema and indexes
- **Stream Processing**: Real-time shard discovery and record polling with configurable intervals
- **TTL Support**: Configurable Time-To-Live for automatic record cleanup (default 'expires')
- **Error Handling**: Comprehensive error handling with retry logic and proper AWS SDK integration
- **Resource Management**: Proper subscription cleanup with abort signals and connection pooling
- **Type Safety**: Full TypeScript generics with AWS SDK v3 types and null safety
- **Singleton Pattern**: Uses `shareReplay(1)` to prevent race conditions and duplicate table creation

### Memory Provider (`src/providers/memory/provider.ts`)

Lightweight, configurable provider designed primarily for testing and development scenarios.

**Core Features**:
- **Dual Stream Support**: Separate `all` and `latest` streams using ReplaySubject
- **Configurable Delays**: Control timing for initialization, emission, and storage
- **UUID-based Identification**: Uses `crypto.randomUUID()` for unique record IDs
- **JSON Serialization**: Automatic payload serialization/deserialization
- **AbortSignal Integration**: Proper cleanup and cancellation support

### RxJS Operators (`src/operators/`)

#### `persist` Operator

Sophisticated RxJS operator that provides reliable storage and retrieval through cloud providers with comprehensive buffer management and timing control.

**Key Features**:
- **Provider-Agnostic Design**: Works with any `ICloudProvider` implementation
- **Buffering Strategy**: Buffers source emissions until provider is ready
- **Sequential Processing**: Processes values one at a time to maintain order
- **Graceful Degradation**: Falls back to delay-based emission when no provider is available
- **Hot/Cold Observable Support**: Handles all RxJS observable types seamlessly

#### `persistReplay` Operator

Combines persistence with historical data replay for seamless cloud-backed streaming.

#### `semaphore` Operator

Provides concurrency control for cloud operations to prevent rate limiting.

## Development Commands

### Testing

```bash
npm test                    # Run unit tests (info level logs)
npm test -- --verbose      # Run with debug level logs  
npm test -- --silent       # Run with no logs
npm run test:watch         # Watch mode for development
npm run test:integration   # Run integration tests
```

**Test Logging System**: Uses Jest Global Setup Module that automatically detects Jest's built-in flags and configures pino-based logging accordingly.

### Code Quality

```bash
npm run lint               # Run ESLint
npm run lint:fix           # Fix ESLint issues
npx tsc --noEmit          # TypeScript compilation check
```

### Build

```bash
npm run build             # Build for production
```

## Development Guidelines

### Error Handling

- Use `RetryError` for recoverable errors (network issues, resource not ready)
- Use `FatalError` for unrecoverable errors (configuration problems)
- **Error Checking Strategy**: 
  - NEVER do conditional error logic handling on "error.message" - use "error.name" for deterministic error type checking
  - Use native `AbortError` for abort operations - don't manufacture new Error objects
  - Pass through original `signal.reason` to preserve native error types
  - Handle AbortError as debug-level logging (normal shutdown) vs error-level for actual errors

### Observable Patterns

- Use `takeUntil(fromEvent(signal, 'abort'))` for cleanup
- Use `shareReplay(1)` for singleton observables
- Handle errors with `catchError` to prevent stream termination

### Test Development

- **IMPORTANT**: If you experiment and modify tests during development, you MUST restore the test to its normal/correct state before considering the objective complete
- Use the `getTestName()` helper function to sanitize Jest test names for DynamoDB table names
- Always clean up resources properly in test teardown
- **Cold vs Hot Observable Testing**: Use cold observables for simple tests, hot observables for real-world streaming scenarios
- **Provider Initialization**: For hot observable tests, always wait for provider initialization before creating subjects
- **Memory Management**: Always complete subjects and observables to prevent memory leaks

## Testing Architecture

**Multi-Provider Testing**: Same test suites run against both Memory and DynamoDB providers using Docker-based DynamoDB Local container for integration testing.

**Test Pattern Categories**:
- **Provider Tests**: Singleton behavior, streaming, error handling, resource management
- **Operator Tests**: Observable type coverage, timing scenarios, completion logic, error propagation
- **Subject Tests**: Backfill scenarios, cross-instance sharing, persistence integration, snapshot testing

## Dependencies

### Core Dependencies

- **RxJS 7+**: Core reactive programming library (peer dependency)
- **AWS SDK v3**: Complete AWS integration for DynamoDB and DynamoDB Streams
- **timeflake**: Distributed unique ID generation for record identification
- **bn.js**: Big number library for precise numerical operations

### Development Dependencies

- **Jest**: Primary testing framework with TypeScript support
- **testcontainers**: Docker container management for DynamoDB Local
- **ESLint**: Comprehensive linting with TypeScript support
- **TypeScript**: Core TypeScript compiler
- **pino**: High-performance structured logging

## Performance Considerations

- Empty event arrays are delayed by 100ms to prevent tight polling loops
- Shard discovery happens independently of record polling
- Use `concatAll()` to flatten event streams efficiently
- Singleton pattern in `CloudProvider.from()` doesn't clean up instances - consider using WeakMap for automatic cleanup in future versions

## Security Notes

- Never log or expose AWS credentials
- Use IAM roles with minimal required permissions
- AbortSignal provides secure stream termination

## Development Principles

- Don't arbitrarily add delays, investigate the race conditions
- Prefer early return pattern for conditionals rather than large if-else blocks
- Use `unknown` instead of `any` for type safety, never disable ESLint rules

## Critical Fixes & Learnings

### CloudSubject → CloudReplaySubject Fix (2025-07-08)

**Issue**: Original CloudSubject extended regular Subject, causing late subscribers to miss backfilled data
**Solution**: Changed to extend ReplaySubject, enabling late subscribers to receive historical emissions
**Impact**: Backfill tests now pass, ensuring consistent behavior across all scenarios

**Key Discovery**: Memory provider's ReplaySubject simulation works correctly - the timing issue was in CloudSubject not extending ReplaySubject, causing late subscribers to miss the backfilled emissions.

### Console-Compatible Logger Interface (2025-06-28)

**Solution**: Updated Logger interface to be Console-compatible with optional methods
```typescript
export interface Logger {
  log?(message?: unknown, ...optionalParams: unknown[]): void;
  debug?(message?: unknown, ...optionalParams: unknown[]): void;
  info?(message?: unknown, ...optionalParams: unknown[]): void;
  warn?(message?: unknown, ...optionalParams: unknown[]): void;
  error?(message?: unknown, ...optionalParams: unknown[]): void;
  trace?(message?: unknown, ...optionalParams: unknown[]): void;
}
```

### Circular Import Resolution (2025-06-18)

**Issue**: "Class extends value undefined is not a constructor or null" error caused by circular imports
**Solution**: Created separate `providers/base.ts` file containing base classes and types to break circular dependency

### AbortSignal Memory Leak Prevention

**Solution**: Added `setMaxListeners(50)` in `tests/setup.ts` to handle legitimate test scenarios with multiple AbortSignal instances
**Key Learning**: AbortSignal extends EventTarget (not EventEmitter), so instance-level `setMaxListeners()` is not available
- don't call things production ready unless tests have been added