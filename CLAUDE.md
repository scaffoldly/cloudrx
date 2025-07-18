# Claude Notes for CloudRx Project

## Project Overview

CloudRx is a sophisticated TypeScript library that extends RxJS to provide cloud-backed reactive streams with automatic persistence and replay capabilities. It creates reactive interfaces for cloud services like DynamoDB Streams, enabling real-time event streaming with persistent storage and cross-instance data sharing.

## Usage Examples

### Basic DynamoDB Streaming with `persist` Operator

```typescript
import { of } from 'rxjs';
import { DynamoDB, persist } from 'cloudrx';

// Create provider configuration
const options = {
  client: dynamoDbClient,
  hashKey: 'id',
  rangeKey: 'timestamp',
  signal: abortController.signal,
};

// Create provider observable
const provider$ = DynamoDB.from('my-table', options);

// Data to persist
const data = [
  { message: 'hello', timestamp: Date.now() },
  { message: 'world', timestamp: Date.now() + 1 }
];

// Persist data and get it back from the stream
const result$ = of(...data).pipe(
  persist(provider$)
);

// Subscribe to get confirmed stored items
result$.subscribe(item => {
  console.log('Item stored and confirmed:', item);
});
```

### CloudReplaySubject for Reactive Persistence with Backfill

```typescript
import { CloudReplaySubject } from 'cloudrx';
import { DynamoDB } from 'cloudrx';

// Create a cloud-backed replay subject
const subject = new CloudReplaySubject(
  DynamoDB.from('events-table', options)
);

// Subscribe to persisted events (includes replay of historical data)
subject.subscribe(event => {
  console.log('Received event:', event);
});

// Subscribe to expired events
subject.on('expired', (expiredEvent) => {
  console.log('Event expired:', expiredEvent);
});

// Emit values that are automatically persisted
subject.next({ type: 'user-action', data: { userId: 123 } });

// Emit values with expiration (TTL)
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
subject.next({ type: 'temporary-session', sessionId: 'abc123' }, expiresAt);
```

## Key Architecture Components

### CloudProvider Abstract Class (`src/providers/base.ts`)

- **Generic Type**: Uses `StreamEvent` (not `Event` to avoid DOM conflicts)
- **EventEmitter**: Uses Node.js 'events' module for type safety
- **Stream Method**: Returns Observable with `concatAll()` flattening for `all=true` mode
- **Error Handling**: Distinguishes between `RetryError` and `FatalError`
- **Singleton Pattern**: Uses `CloudProvider.from()` with instance caching by ID
- **Backfill Support**: `stream(all=true)` calls `_stream(true).pipe(concatAll())` to flatten record arrays into individual records

### CloudReplaySubject (`src/subjects/cloud-replay.ts`)

The CloudReplaySubject is a cloud-backed RxJS ReplaySubject that automatically persists emissions and replays historical data for late subscribers.

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
- **Expired Event Handling**: Emits 'expired' events when items reach their TTL
- **Provider Integration**: Works with any CloudProvider (DynamoDB, Memory, etc.)
- **Stream Processing**: Uses `provider.stream(true)` to get full historical replay from provider

**Persistence Flow**:
1. **Inner Subject**: User emissions go to internal Subject<Expireable<T>>
2. **Persist Operator**: Internal Subject piped through `persist(provider)` for storage
3. **Stream Subscription**: Provider's `stream(true)` provides backfill and live updates
4. **Expired Subscription**: Provider's `expired()` stream emits expired events
5. **ReplaySubject Emission**: All data (backfilled and live) emitted to ReplaySubject subscribers

**TTL and Expiration**:
- Items can be emitted with optional expiration using `subject.next(value, expiresDate)`
- The `expires` Date parameter is converted to Unix timestamp in seconds
- Only the "all" stream checks for expired items and emits expired events
- Expired events are emitted via EventEmitter pattern: `subject.on('expired', callback)`

**Usage Patterns**:
```typescript
// Basic usage with automatic backfill
const subject = new CloudReplaySubject(provider$);

// Subscribe before or after seeding - both get full history
subject.subscribe(item => console.log('Historical + Live:', item));

// Listen for expired events
subject.on('expired', item => console.log('Expired:', item));

// Emit new data that gets persisted and replayed
subject.next({ message: 'new data' });

// Emit data with expiration
const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now
subject.next({ message: 'temporary data' }, expiresAt);
```

**Critical Timing Fix (2025-07-08)**:
- **Issue**: Original CloudSubject extended regular Subject, causing late subscribers to miss backfilled data
- **Solution**: Changed to extend ReplaySubject, enabling late subscribers to receive historical emissions
- **Impact**: Backfill tests now pass, ensuring consistent behavior across all scenarios

### DynamoDB Provider (`src/providers/aws/provider.ts`)

**Complete AWS Integration**:
- **Table Management**: Automatic table creation/validation with proper schema and indexes
- **Stream Processing**: Real-time shard discovery and record polling with configurable intervals
- **TTL Support**: Configurable Time-To-Live for automatic record cleanup (default 'expires')
- **Error Handling**: Comprehensive error handling with retry logic and proper AWS SDK integration
- **Resource Management**: Proper subscription cleanup with abort signals and connection pooling
- **Type Safety**: Full TypeScript generics with AWS SDK v3 types and null safety
- **Singleton Pattern**: Uses `shareReplay(1)` to prevent race conditions and duplicate table creation

### RxJS Operators (`src/operators/`)

#### `persistReplay` Operator

Combines persistence with historical data replay for seamless cloud-backed streaming.

**Core Features**:
- **Dual Stream Merge**: Combines `persist` operator with provider's `stream(true)` for complete coverage
- **Historical Backfill**: Automatically replays all previously persisted data on subscription
- **Marker Cleanup**: Removes internal `__marker__` properties before final emission
- **Provider Integration**: Works with any CloudProvider implementation
- **Completion Handling**: Properly coordinates completion between persistence and stream sources

**Usage Pattern**:
```typescript
const result$ = source$.pipe(
  persistReplay(provider$)
);
```

#### `semaphore` Operator

Provides concurrency control for cloud operations to prevent rate limiting.

**Core Features**:
- **Concurrency Limiting**: Configurable maximum concurrent operations
- **Queue Management**: Internal queue for pending operations
- **Observable Input Support**: Handles any `ObservableInput` type
- **Resource Management**: Proper cleanup and error handling
- **Backpressure Handling**: Manages flow control for cloud provider limits

**Usage Pattern**:
```typescript
const controlled$ = source$.pipe(
  semaphore(5, (item) => cloudOperation(item))
);
```

#### `persist` Operator Architecture

The `persist` operator is a sophisticated RxJS operator that provides reliable storage and retrieval through cloud providers with comprehensive buffer management and timing control.

**Core Design Pattern**:
```typescript
const persist = <T>(
  provider: Observable<ICloudProvider<unknown, unknown> | undefined>
): MonoTypeOperatorFunction<T>
```

**Key Features**:
- **Provider-Agnostic Design**: Works with any `ICloudProvider` implementation (Memory, DynamoDB, etc.)
- **Buffering Strategy**: Buffers source emissions until provider is ready
- **Sequential Processing**: Processes values one at a time to maintain order
- **Graceful Degradation**: Falls back to delay-based emission when no provider is available
- **Hot/Cold Observable Support**: Handles all RxJS observable types seamlessly
- **Resource Management**: Proper subscription cleanup and memory management

**Internal Architecture**:
1. **Provider Subscription**: Uses `first()` to get single provider instance
2. **Source Buffering**: Accumulates emissions in array while provider initializes
3. **Sequential Processing**: Recursive `processValues()` maintains emission order
4. **Completion Handling**: Coordinates completion between source and processing queue

**Buffer Management**:
- Values emitted before provider readiness are stored in internal buffer
- Buffer is processed sequentially once provider becomes available
- Maintains original emission order through recursive processing
- Memory-efficient: buffer cleared as values are processed

**Observable Compatibility**:
- **Cold Observables** (`of()`, `from()`): Immediate processing, no timing concerns
- **Subject**: Hot observable, values buffered until provider ready
- **BehaviorSubject**: Initial value buffered if emitted before provider ready
- **ReplaySubject**: All buffered values processed in order
- **AsyncSubject**: Final value processed when subject completes

**Error Handling**:
- Provider errors propagated to subscriber immediately
- Source errors propagated to subscriber immediately
- Storage errors from provider propagated per value
- Subscription cleanup on error or completion

**Performance Characteristics**:
- Single provider subscription with `first()` operator
- Sequential processing prevents overwhelming cloud providers
- Minimal memory footprint through buffer clearing
- No explicit delays except for provider-less fallback (1000ms)

**Usage Patterns**:
```typescript
// With Memory provider for testing
const result$ = source$.pipe(
  persist(Memory.from('test-id'))
);

// With DynamoDB provider for production
const result$ = source$.pipe(
  persist(DynamoDB.from('table-name', options))
);

// Graceful degradation (no provider)
const result$ = source$.pipe(
  persist(of(undefined))
);
```

**Testing Considerations**:
- **Provider Timing**: Hot observables automatically handled through buffering
- **Sequential Processing**: Test order preservation with multiple rapid emissions
- **Completion Logic**: Verify completion timing with various observable types
- **Error Scenarios**: Test provider errors, source errors, and cleanup
- **Memory Management**: Ensure proper subscription cleanup and buffer clearing

## Development Commands

### Testing

```bash
npm test                    # Run unit tests (info level logs)
npm test -- --verbose      # Run with debug level logs  
npm test -- --silent       # Run with no logs
npm run test:watch         # Watch mode for development
npm run test:integration   # Run integration tests
```

#### Test Logging System

The test suite uses a Jest Global Setup Module that automatically detects Jest's built-in flags and configures pino-based logging accordingly:

- **Default Mode**: `npm test` - Shows info+ level logs with structured pino formatting
- **Verbose Mode**: `npm test -- --verbose` - Shows debug+ level logs for detailed troubleshooting
- **Silent Mode**: `npm test -- --silent` - Suppresses all log output for clean CI runs
- **Watch Mode**: `npm run test:watch` - Standard Jest watch mode with default logging

The logging system uses pino exclusively for all log levels, providing consistent structured logging with pretty formatting during development.

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

## Common Patterns & Conventions

### Error Handling

- Use `RetryError` for recoverable errors (network issues, resource not ready)
- Use `FatalError` for unrecoverable errors (configuration problems)
- Always include error context in messages
- **Error Checking Strategy**: 
  - NEVER do conditional error logic handling on "error.message" - use "error.name" for deterministic error type checking
  - Use native `AbortError` for abort operations - don't manufacture new Error objects
  - Pass through original `signal.reason` to preserve native error types
  - Handle AbortError as debug-level logging (normal shutdown) vs error-level for actual errors

### Observable Patterns

- Use `takeUntil(fromEvent(signal, 'abort'))` for cleanup
- Use `shareReplay(1)` for singleton observables
- Handle errors with `catchError` to prevent stream termination

### Configuration

- Use optional parameters with sensible defaults
- Make polling intervals and timeouts configurable
- Validate required parameters in constructors

### Test Development Guidelines

- **IMPORTANT**: If you experiment and modify tests during development, you MUST restore the test to its normal/correct state before considering the objective complete
- Tests should properly verify the functionality they claim to test (e.g., 'is-a-singleton' should actually test that the same instance is returned)
- Use the `getTestName()` helper function to sanitize Jest test names for DynamoDB table names
- Use short but descriptive names for tests (e.g., 'multiple-streams', 'only-once', 'shard-observation')
- Always clean up resources properly in test teardown
- NEVER skip tests in CI environments - ensure all tests can run successfully in CI

#### RxJS Operator Testing Best Practices

- **Cold vs Hot Observable Testing**: 
  - Use cold observables (`of()`, `from()`) for simple, deterministic tests
  - Use hot observables (Subjects) to test real-world streaming scenarios
- **Provider Initialization**: For hot observable tests, always wait for provider initialization before creating subjects
- **Timing Control**: Use `setTimeout()` with appropriate delays for async operations in tests
- **Memory Management**: Always complete subjects and observables to prevent memory leaks
- **Error Scenarios**: Test both normal shutdown (AbortError) and actual error conditions
- **Subject Type Coverage**: Test with multiple RxJS subject types to ensure broad compatibility

#### Test Infrastructure Patterns

- **Logger Creation**: Create logger once per test suite using `const logger = createTestLogger()` in describe block
- **Container Initialization**: Pass logger to test containers (e.g., `new DynamoDBLocalContainer(logger)`)
- **Consistent Options**: Reuse `DynamoDBProviderOptions` object with shared logger across test cases
- **Performance**: Avoid repetitive object creation within individual test cases
- **Verbosity Control**: All test components should respect Jest's `--verbose`, `--silent`, and default modes

## Testing Architecture

### Test Infrastructure

**Jest Configuration**:
- **TypeScript Support**: Complete Jest setup with ts-jest and TypeScript compilation
- **Test Containers**: Docker-based DynamoDB Local container for integration testing
- **Logging System**: Sophisticated logging with automatic Jest flag detection (`--verbose`, `--silent`)
- **Global Setup**: Centralized test setup with proper resource management
- **Timeout Configuration**: Appropriate timeouts for cloud operations and container startup

**Test Utilities**:
- **Helper Functions**: `getTestName()` for sanitizing test names for DynamoDB table names
- **Logger Factory**: `createTestLogger()` for consistent logging across test suites
- **Container Management**: `DynamoDBLocalContainer` with proper lifecycle management
- **Resource Cleanup**: Proper cleanup patterns with abort controllers and subscription management

### Testing Patterns

**Provider Testing**:
- **Dual Provider Coverage**: Same test suites run against both Memory and DynamoDB providers
- **Singleton Testing**: Verification that `CloudProvider.from()` returns same instances
- **Stream Testing**: Comprehensive streaming scenarios with backfill and live data
- **Error Handling**: Testing of retry/fatal error scenarios and abort signal propagation
- **Resource Management**: Memory leak prevention and proper cleanup verification

**Operator Testing**:
- **Observable Type Coverage**: Testing across cold observables, Subject, BehaviorSubject, ReplaySubject, AsyncSubject
- **Timing Scenarios**: Race condition testing with configurable delays and hot observables
- **Completion Logic**: Verification of proper completion coordination between sources
- **Error Propagation**: Testing of both provider and source error scenarios
- **Buffer Management**: Verification of internal buffering and sequential processing

**Subject Testing**:
- **Backfill Scenarios**: Testing historical data replay for late subscribers
- **Cross-Instance Sharing**: Verification that multiple subjects share data via same provider
- **Persistence Integration**: Testing automatic persistence of new emissions
- **Snapshot Testing**: Verification of complete historical data retrieval
- **Shadowed Testing**: Testing multiple subjects with same provider receiving all events

### Test Structure

**Directory Organization**:
- **Unit Tests**: `tests/` directory with provider-specific subdirectories
- **Integration Tests**: Comprehensive DynamoDB Local integration within main test suite
- **Test Utilities**: `tests/setup/` and `tests/utils/` for shared infrastructure
- **Provider Tests**: `tests/providers/` with Memory and AWS subdirectories
- **Operator Tests**: `tests/operators/` with comprehensive RxJS operator testing
- **Subject Tests**: `tests/subjects/` with CloudReplaySubject testing

### Test Execution

**Command Variations**:
- **Standard**: `npm test` - Info-level logs with structured pino output
- **Verbose**: `npm test -- --verbose` - Debug-level logs for troubleshooting
- **Silent**: `npm test -- --silent` - No logs for clean CI runs
- **Watch**: `npm run test:watch` - Development mode with file watching
- **Integration**: `npm run test:integration` - Full integration test suite

**DynamoDB Local**:
- **Container Integration**: Uses testcontainers for Docker-based DynamoDB Local
- **Real Streaming**: Actual DynamoDB Streams (not mocked) for realistic testing
- **TTL Behavior**: Tests account for TTL propagation timing in real AWS
- **Resource Management**: Proper container startup/shutdown with abort signals

### Test Development Guidelines

**Best Practices**:
- **Test Helper Functions**: Reusable functions for common test patterns (seed, backfill, snapshot)
- **Timing Patterns**: Use `setTimeout()` with appropriate delays for async operations
- **Resource Cleanup**: Always complete subjects and abort controllers in test teardown
- **Error Scenarios**: Test both normal shutdown (AbortError) and actual error conditions
- **Provider Agnostic**: Write tests that work with both Memory and DynamoDB providers

**Common Test Patterns**:
- **Seed-Test-Verify**: Seed data, perform operation, verify results
- **Late Subscription**: Test backfill by subscribing after data seeding
- **Cross-Instance**: Test data sharing between multiple subject instances
- **Abort Testing**: Test proper cleanup with abort controllers
- **Timing Control**: Use configurable delays for race condition testing

### Memory Provider (`src/providers/memory/provider.ts`)

The Memory provider is a lightweight, configurable provider designed primarily for testing and development scenarios.

**Core Architecture**:
```typescript
export class Memory extends CloudProvider<Record, Record['id']> {
  private all = new ReplaySubject<Record[]>();
  private latest = new ReplaySubject<Record[]>(1);
  private initialized = false;
}
```

**Key Features**:
- **Dual Stream Support**: Separate `all` and `latest` streams using ReplaySubject
- **Configurable Delays**: Control timing for initialization, emission, and storage
- **UUID-based Identification**: Uses `crypto.randomUUID()` for unique record IDs
- **JSON Serialization**: Automatic payload serialization/deserialization
- **AbortSignal Integration**: Proper cleanup and cancellation support

**Timing Configuration**:
```typescript
type MemoryDelays = {
  init?: number;     // Initialization delay (default: 2000ms)
  emission?: number; // Emission interval (default: 1000ms)
  storage?: number;  // Storage delay (default: 25ms)
};
```

**Stream Behavior**:
- **All Stream**: ReplaySubject with unlimited buffer, retains all records
- **Latest Stream**: ReplaySubject(1), only retains most recent emission
- **Empty Emissions**: Regular empty array emissions to trigger stream activity
- **Record Emission**: New records emitted to both streams simultaneously

**Storage Process**:
1. Generate unique UUID for record identification
2. Serialize payload to JSON string
3. Create record with ID and data structure
4. Wait for storage delay (configurable, default 25ms)
5. Emit record to both streams
6. Return matcher function for stream filtering

**Matcher Function Pattern**:
```typescript
protected _store<T>(item: T): Observable<(event: Record) => boolean> {
  const id = crypto.randomUUID();
  // ... storage logic ...
  const matcher = (event: Record): boolean => event.id === id;
  return of(matcher);
}
```

**Data Structure**:
```typescript
type Record = {
  id: string;        // UUID for unique identification
  data: {
    payload: string; // JSON-serialized original item
  };
};
```

**Unmarshalling Process**:
- Extract record ID as marker for stream identification
- Parse JSON payload back to original type
- Return object with `__marker__` property for tracking
- Marker gets removed by base class before final emission

**Error Handling**:
- Validates initialization state before streaming/storing
- Propagates abort signals through timing operations
- Provides descriptive error messages for debugging
- Graceful cleanup on abort/error conditions

**Testing Benefits**:
- **Predictable Timing**: Configurable delays for race condition testing
- **Fast Feedback**: Much faster than DynamoDB for unit tests
- **Isolation**: No external dependencies or network calls
- **Debugging**: Clear logging integration with test infrastructure
- **Flexibility**: Easy to configure different timing scenarios

**Usage Patterns**:
```typescript
// Basic usage with defaults
Memory.from('test-id')

// Custom delays for specific test scenarios
Memory.from('test-id', {
  delays: {
    init: 100,     // Fast initialization
    emission: 50,  // Rapid emissions
    storage: 10    // Quick storage
  }
})

// With logger for debugging
Memory.from('test-id', {
  logger: testLogger,
  delays: { init: 0 } // Immediate initialization
})
```

**Performance Characteristics**:
- **Memory Efficient**: Uses ReplaySubject for stream management
- **CPU Light**: Minimal processing overhead
- **Configurable Load**: Timing controls prevent overwhelming test systems
- **Cleanup**: Proper resource management with abort signals

**Backfill Architecture & DynamoDB Simulation**:
- **Page-Based Emissions**: Emits `Record[]` arrays to simulate DynamoDB pagination, not individual records
- **Empty Page Simulation**: Regular `[]` emissions simulate DynamoDB GetRecords at stream tail
- **ReplaySubject Buffer**: `_all` stream maintains unlimited buffer of all page emissions for backfill
- **Buffer Content**: Contains mix of empty pages `[]` and record pages `[{record}]` in chronological order
- **Flattening Pipeline**: Base class `concatAll()` flattens page arrays into individual records for CloudReplaySubject

**Backfill Flow Debugging (2025-07-08)**:
1. **Seeding Phase**: Records stored individually, each emits single-record page `[{record}]` to ReplaySubject
2. **Buffer State**: ReplaySubject accumulates `[[], [{record1}], [{record2}], [{record3}]]`
3. **CloudReplaySubject Creation**: Subscribes to `provider.stream(true)` for backfill
4. **ReplaySubject Replay**: Immediately replays all buffered pages to new subscriber
5. **Base Class Processing**: `concatAll()` flattens pages into individual records
6. **Record Processing**: Each record unmarshalled, `__marker__` removed, emitted to ReplaySubject
7. **Late Subscriber Support**: ReplaySubject inheritance ensures late subscribers get full history

**Key Discovery**: Memory provider's ReplaySubject simulation works correctly - the timing issue was in CloudSubject not extending ReplaySubject, causing late subscribers to miss the backfilled emissions.

## Known Issues & Considerations

### Memory Management

- Singleton pattern in `CloudProvider.from()` doesn't clean up instances
- Consider using WeakMap for automatic cleanup in future versions
- Memory provider ReplaySubjects retain records until completion

### Rate Limiting

- DynamoDB shard polling interval should be tuned for production
- Consider exponential backoff for error scenarios
- Memory provider emission intervals should be tuned for test performance

### TypeScript

- Generic type `StreamEvent` avoids conflicts with DOM Event type
- Strict typing on AWS SDK responses with proper null checks
- Memory provider uses proper generic typing for Record and marker types

## Dependencies

### Core Dependencies

- **RxJS 7+**: Core reactive programming library (peer dependency)
- **AWS SDK v3**: Complete AWS integration for DynamoDB and DynamoDB Streams
- **timeflake**: Distributed unique ID generation for record identification
- **bn.js**: Big number library for precise numerical operations

### Development Dependencies

**Testing Framework**:
- **Jest**: Primary testing framework with TypeScript support
- **ts-jest**: TypeScript integration for Jest
- **testcontainers**: Docker container management for DynamoDB Local
- **@types/jest**: TypeScript definitions for Jest

**Code Quality**:
- **ESLint**: Comprehensive linting with TypeScript support
- **@typescript-eslint/parser**: TypeScript parser for ESLint
- **@typescript-eslint/eslint-plugin**: TypeScript-specific linting rules
- **Prettier**: Code formatting with consistent style

**Build Tools**:
- **TypeScript**: Core TypeScript compiler
- **rimraf**: Cross-platform directory cleanup
- **npm-run-all**: Parallel and sequential npm script execution

**Logging & Utilities**:
- **pino**: High-performance structured logging
- **pino-pretty**: Pretty formatting for development logs

### Peer Dependencies

- **RxJS**: Version 7+ required (allows consumer version choice)
- **AWS SDK v3**: Optional for DynamoDB provider usage
- **Node.js**: Version 20+ required for modern JavaScript features

## Performance Considerations

- Empty event arrays are delayed by 100ms to prevent tight polling loops
- Shard discovery happens independently of record polling
- Use `concatAll()` to flatten event streams efficiently

## Security Notes

- Never log or expose AWS credentials
- Use IAM roles with minimal required permissions
- AbortSignal provides secure stream termination

## Development Workflow

### Pre-Commit Checklist

**Required Steps**:
1. **Code Quality**: Run `npm run lint` and fix any ESLint issues
2. **Type Safety**: Run `npx tsc --noEmit` to ensure TypeScript compilation
3. **Test Coverage**: Run `npm test` to ensure all tests pass
4. **Integration Tests**: Run full test suite including DynamoDB Local integration
5. **Build Verification**: Run `npm run build` to ensure production build works

### Development Process

**Code Changes**:
- **Incremental Testing**: Run relevant test suites during development
- **Type-First Development**: Ensure TypeScript types are correct before implementation
- **Provider Compatibility**: Test changes against both Memory and DynamoDB providers
- **Documentation Updates**: Update CLAUDE.md with architectural insights and patterns

**Testing Strategy**:
- **Unit Tests First**: Write unit tests with Memory provider for fast feedback
- **Integration Verification**: Validate with DynamoDB Local for real-world scenarios
- **Edge Case Coverage**: Test error conditions, abort scenarios, and timing edge cases
- **Performance Testing**: Verify memory usage and resource cleanup

### Build System

**TypeScript Configuration**:
- **Strict Mode**: All strict TypeScript options enabled
- **Source Maps**: Full source map generation for debugging
- **Declaration Files**: Automatic `.d.ts` generation for library consumers
- **Target Compatibility**: ES2020 target with Node.js 20+ compatibility

**Output Structure**:
- **Dist Directory**: Compiled JavaScript with source maps
- **Type Declarations**: Complete TypeScript definitions
- **ES Modules**: Modern ES module output for tree-shaking
- **CommonJS**: Compatible CommonJS exports for legacy consumers

## Development Principles

- don't arbitrarily add delays, investigate the race conditions
- prefer early return pattern for conditionals (if condition, return) rather than large if-else blocks
- use `unknown` instead of `any` for type safety, never disable ESLint rules

## Recent Learnings & Fixes (2025-06-18)

### Circular Import Resolution

- **Issue**: "Class extends value undefined is not a constructor or null" error caused by circular imports between `providers/index.ts`, `aws/index.ts`, and `aws/dynamodb.ts`
- **Solution**: Created separate `providers/base.ts` file containing base classes and types to break circular dependency
- **Key Files**:
  - `src/providers/base.ts` - Contains `CloudProvider` abstract class and related types
  - `src/providers/index.ts` - Simplified to export from base.ts and AWS providers
  - `src/providers/aws/dynamodb.ts` - Updated imports to use '../base'
- **Recommendation**: Always be mindful of import chains in TypeScript. Prefer architectural separation between base classes and implementations.

### AbortSignal Memory Leak Prevention

- **Issue**: "MaxListenersExceededWarning: Possible EventTarget memory leak detected" with 10+ AbortSignal listeners in tests
- **Solution**: Added `setMaxListeners(50)` in `tests/setup.ts` to handle legitimate test scenarios with multiple AbortSignal instances
- **Key Learning**: AbortSignal extends EventTarget (not EventEmitter), so instance-level `setMaxListeners()` is not available
- **Recommendation**: For test environments with multiple abort controllers, increase global max listeners limit rather than implementing complex cleanup logic

### Signal Propagation Enhancement

- **Issue**: Global abort controller wasn't properly cascading to individual stream controllers
- **Solution**: Enhanced `CloudProvider` base class to listen for abort signals and emit 'stopped' events, plus updated DynamoDB provider to listen to both stream and provider abort signals
- **Key Changes**:
  - Added `streamAbort.signal.addEventListener('abort', () => this.emit('stopped'))` in `CloudProvider.stream()`
  - Added dual `takeUntil` operators in DynamoDB `_stream()` method for both stream and provider signals
- **Test Coverage**: Created comprehensive 'global-abort-cascades' test with multiple provider instances to verify proper signal propagation

### Architecture Insights

- **Provider Singleton Pattern**: The current singleton implementation in `CloudProvider.from()` works well but doesn't automatically clean up instances. Consider WeakMap for future versions if memory usage becomes a concern.
- **Signal Hierarchy**: Maintain clear signal hierarchy: Global AbortController → Provider AbortController → Stream AbortController
- **Event Emission**: Always emit lifecycle events ('started', 'stopped') for proper test verification and debugging

### Future Recommendations

1. **Circular Import Prevention**: Consider using dependency injection or factory patterns for complex provider hierarchies
2. **Memory Management**: Monitor memory usage in production; current singleton pattern is acceptable for typical use cases
3. **Signal Testing**: Always test abort signal propagation with multiple instances to ensure proper cascade behavior
4. **Error Handling**: Continue distinguishing between `RetryError` and `FatalError` for appropriate error recovery strategies

## Recent Session Learnings (2025-06-22)

### `persistTo` Operator Development & Testing

- **Issue**: RxJS operator needed comprehensive testing across different observable types
- **Solution**: Created test suite covering cold observables, Subject, BehaviorSubject, ReplaySubject, and AsyncSubject
- **Key Insights**:
  - Cold observables work immediately without timing concerns
  - Hot observables require provider initialization before creating subjects
  - Each subject type has distinct emission patterns that need specific test approaches
  - Proper cleanup (subject.complete()) is essential for memory management

### Error Handling & AbortSignal Improvements

- **Issue**: "Provider aborted" errors were manufacturing new Error objects instead of preserving native AbortError
- **Root Cause**: Code was creating `new Error('Provider aborted')` instead of passing through `signal.reason`
- **Solution**: 
  - Modified abort handlers to pass through original `signal.reason`
  - Updated error checking logic to use `error.name !== 'AbortError'` exclusively
  - Removed custom AbortError class in favor of native browser AbortError
- **Best Practice**: Always preserve native error types through the error propagation chain

### Log Message Cleanup

- **Issue**: Scary error messages appeared during normal test cleanup
- **Solution**: Distinguished between normal shutdown (AbortError) and actual errors
- **Implementation**: Use debug-level logging for AbortError, error-level for actual problems
- **Result**: Clean test output without losing important error information

### Test Logging System Implementation

- **Issue**: Test logs were inconsistent and didn't respect Jest's built-in verbosity flags
- **Solution**: Implemented Jest Global Setup Module with pino-based logging that automatically detects `--verbose` and `--silent` flags
- **Architecture**:
  - **Global Setup**: `/tests/setup.ts` detects Jest flags and sets `JEST_LOG_LEVEL` environment variable
  - **Logger Factory**: `/tests/utils/logger.ts` uses pino exclusively for all log levels
  - **Pino Integration**: Structured logging with pretty formatting and automatic silent mode handling
- **Key Benefits**:
  - Clean CI runs with `--silent` flag (no log output)
  - Detailed debugging with `--verbose` flag (debug-level pino logs)
  - Consistent structured logging across all test scenarios
  - No manual environment variable management required
- **Usage**: 
  - `npm test` - Standard info-level logs
  - `npm test -- --verbose` - Debug-level logs for troubleshooting
  - `npm test -- --silent` - No logs for clean CI output

### Test Infrastructure Optimization

- **Issue**: Repetitive logger creation and console usage in test infrastructure
- **Solution**: Centralized logger creation and consistent logging interfaces
- **Implementation**:
  - **Logger Optimization**: Create logger once per test suite instead of per test case
  - **DynamoDBLocalContainer**: Updated to accept and use structured logger instead of console
  - **Consistent Interfaces**: All test components use the same logger interface
- **Benefits**:
  - Performance improvement from reduced object creation
  - Consistent logging behavior across all test components  
  - Container logs respect Jest verbosity flags (silent/verbose)
  - Clean separation between test infrastructure and application logging

### DynamoDB Provider Logging Enhancement

- **Issue**: Verbose initialization logs cluttered normal test output
- **Solution**: Optimized log levels to show only essential information during normal operation
- **Changes**:
  - Moved initialization steps to debug level (`"Initializing..."`, `"Setting ARNs..."`)
  - Enhanced completion message to show Table ARN: `"DynamoDB table ready: {tableArn}"`
  - Debug mode still shows full initialization sequence for troubleshooting
- **Result**: 
  - Normal mode: Single info log with concrete Table ARN information
  - Verbose mode: Full debug trace for troubleshooting
  - Silent mode: No logs for clean CI output

### Console-Compatible Logger Interface (2025-06-28)

- **Issue**: Logger interface needed to support "Bring Your Own Logger" pattern
- **Solution**: Updated Logger interface to be Console-compatible with optional methods
- **Implementation**:
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
- **Key Changes**:
  - All logger methods are now optional using `?` operator
  - Method signatures match Node.js Console interface exactly
  - Uses `unknown` instead of `any` for better type safety
  - All logger calls throughout codebase use optional chaining (`logger.debug?.()`)
- **Benefits**:
  - Drop-in compatibility with native `console` object
  - Supports any subset of logging methods (pino, winston, etc.)
  - Type-safe with strict TypeScript settings
  - Graceful handling when logger methods are undefined
- **Usage Patterns**:
  ```typescript
  // Native console (all methods available)
  const provider = Memory.from('test', { logger: console });
  
  // Custom logger (partial implementation)
  const customLogger = { debug: console.log, error: console.error };
  const provider = Memory.from('test', { logger: customLogger });
  
  // Pino logger (full featured)
  const pinoLogger = pino();
  const provider = Memory.from('test', { logger: pinoLogger });
  ```

### Persist Operator Deep Dive (2025-06-28)

- **Buffer Management Strategy**: 
  - Internal array buffer accumulates source emissions until provider ready
  - Sequential processing maintains emission order through recursive function calls
  - Buffer cleared incrementally as values are processed to minimize memory
  - Completion coordination between source observable and processing queue

- **Provider Integration Pattern**:
  - Uses `provider.pipe(first())` to get single instance, avoiding multiple subscriptions
  - Handles undefined providers gracefully with 1000ms delay fallback
  - Provider errors propagated immediately to subscriber
  - Clean separation between provider lifecycle and source processing

- **Observable Type Compatibility**:
  - **Cold Observables**: Immediate processing since provider typically ready
  - **Hot Observables**: Automatic buffering handles timing race conditions
  - **Completion Timing**: Complex logic coordinates source completion with buffer processing
  - **Error Propagation**: Both provider and source errors handled appropriately

- **Performance Optimizations**:
  - Single provider subscription reduces overhead
  - Sequential processing prevents cloud provider rate limiting
  - Minimal memory footprint through incremental buffer clearing
  - No unnecessary delays or polling loops

### Memory Provider Implementation Details (2025-06-28)

- **Stream Architecture**: 
  - Dual ReplaySubject design supports both `all` and `latest` stream types
  - Regular empty emissions keep streams active for timing-dependent operations
  - Record emission to both streams ensures consistency
  - Proper ReplaySubject buffer management (unlimited for `all`, size 1 for `latest`)

- **Timing Control System**:
  - Three independent delay configurations for different aspects
  - Initialization delay simulates real cloud provider setup time
  - Emission interval controls stream activity frequency
  - Storage delay simulates network/database latency
  - All timing operations respect AbortSignal for clean cancellation

- **Data Serialization Pattern**:
  - UUID-based identification ensures unique record tracking
  - JSON payload serialization handles complex object types
  - Structured record format with ID and data separation
  - Unmarshalling restores original type with temporary marker

- **Testing Integration**:
  - Fast defaults for unit tests (25ms storage, 1000ms emission)
  - Configurable delays for race condition and timing tests
  - Logger integration for debugging test scenarios
  - AbortSignal support for proper test cleanup

### AWS SDK Type Safety Enhancement (2025-06-28)

- **Issue**: TypeScript error with `_Record['dynamodb']['SequenceNumber']` due to optional `dynamodb` property
- **Solution**: Used `NonNullable<_Record['dynamodb']>['SequenceNumber']` for type safety
- **Impact**: Ensures CloudProvider generic types handle AWS SDK optional properties correctly
- **Pattern**: Use `NonNullable<>` utility type when accessing properties of optional objects in generic type definitions

## Session Learnings and Recommendations

### Objective: Comprehensive Documentation Update

- **Lesson Learned**: Deep architectural understanding emerges through systematic implementation and testing
- **Recommendation**: Document not just what components do, but how they work internally and why design decisions were made
- **Best Practice**: Capture implementation patterns that can be reused across different providers and operators
- **Continuous Improvement**: Update documentation immediately after implementation while details are fresh in memory
- **Architecture Evolution**: Track how design patterns evolve and mature through real-world usage and testing

## Recent Session: CloudReplaySubject Backfill Investigation & Fix (2025-07-08)

### Problem Discovery

- **Issue**: Memory provider backfill test failing with 0 results despite data being seeded correctly
- **Initial Hypothesis**: Memory provider ReplaySubject not working, base class stream processing broken
- **Investigation Method**: Added comprehensive logging to trace data flow through entire pipeline

### Debugging Journey & Insights

#### Phase 1: Memory Provider Investigation
- **Expectation**: ReplaySubject buffer not containing seeded records
- **Reality**: Buffer contained correct data: `[[], [{record1}], [{record2}], [{record3}]]`
- **Learning**: Memory provider correctly simulates DynamoDB page-based emissions

#### Phase 2: Base Class Stream Processing
- **Expectation**: `concatAll()` not flattening properly
- **Reality**: Base class correctly flattened page arrays into individual records
- **Logging Revealed**: 
  ```
  [cloud-subject-memory-backfill] _stream(true) emitted 1 events before concatAll
  [cloud-subject-memory-backfill] After concatAll - individual event: { id: '...', data: {...} }
  ```

#### Phase 3: CloudReplaySubject Processing
- **Expectation**: Records not being unmarshalled or emitted properly
- **Reality**: CloudReplaySubject correctly processed all records and emitted them
- **Logging Revealed**:
  ```
  [CloudSubject] Received event from stream: { id: '...', data: {...} }
  [CloudSubject] Unmarshalled: { message: 'data-1', timestamp: ... }
  [CloudSubject] Emitting to subscribers: { message: 'data-1', timestamp: ... }
  ```

#### Phase 4: Root Cause Discovery
- **Final Insight**: CloudSubject extended regular Subject, not ReplaySubject
- **Timing Issue**: Test subscribed AFTER CloudSubject had already processed and emitted all backfilled data
- **Core Problem**: Regular Subject doesn't replay emissions to late subscribers

### The Fix: CloudSubject → CloudReplaySubject

```typescript
// Before: Regular Subject (late subscribers miss emissions)
export class CloudSubject<T> extends Subject<T>

// After: ReplaySubject (late subscribers get full history)
export class CloudReplaySubject<T> extends ReplaySubject<T>
```

### Comprehensive Rebranding

1. **File Renaming**: `cloud.ts` → `cloud-replay.ts`
2. **Class Renaming**: `CloudSubject` → `CloudReplaySubject`
3. **Export Updates**: Updated all index files and main exports
4. **Test Updates**: Updated all test references
5. **Documentation**: Updated README.md with new naming and examples
6. **Verification**: All tests pass, TypeScript compiles, linting passes

### Architecture Insights Gained

#### Memory Provider Deep Dive
- **Purpose**: Accurately simulates DynamoDB Stream behavior for testing
- **Page Simulation**: Emits arrays `Record[]` not individual records, matching DynamoDB pagination
- **Empty Pages**: Regular `[]` emissions simulate polling empty stream tail
- **Timing Control**: Configurable delays for initialization, emission intervals, and storage operations
- **ReplaySubject Usage**: Unlimited buffer for `_all` stream enables proper backfill testing

#### Base Class Stream Architecture
- **Interface Consistency**: `stream(all=true)` returns `Observable<TEvent>` (individual records)
- **Flattening Logic**: Uses `concatAll()` to flatten provider's `Observable<TEvent[]>` into individual events
- **Type Safety**: Maintains consistent interfaces while handling provider-specific pagination

#### CloudReplaySubject Design Pattern
- **Dual Role**: Both accepts new emissions (Subject behavior) AND replays historical data (ReplaySubject behavior)
- **Provider Integration**: Seamlessly integrates with any CloudProvider via standardized interfaces
- **Backfill Guarantee**: Late subscribers guaranteed to receive complete historical data
- **Performance**: ReplaySubject buffer managed by RxJS, efficient memory usage

### Lessons Learned

1. **Debugging Strategy**: Comprehensive logging at each pipeline stage reveals exactly where issues occur
2. **Assumption Validation**: Initial assumptions about where problems lie are often wrong - systematic investigation essential
3. **Architecture Understanding**: Deep understanding of how ReplaySubject vs Subject affects subscription timing
4. **Testing Patterns**: Backfill scenarios require careful consideration of subscription timing relative to data emission
5. **Naming Accuracy**: Class names should accurately reflect their inheritance and behavior (ReplaySubject vs Subject)

### Best Practices Established

1. **Logging for Debugging**: Add detailed pipeline logging when investigating complex data flow issues
2. **Subscription Timing**: Always consider when subscribers join relative to when data is emitted
3. **Subject Type Selection**: Choose Subject type (Subject, ReplaySubject, BehaviorSubject) based on replay requirements
4. **Interface Consistency**: Maintain consistent interfaces across providers while accommodating provider-specific behaviors
5. **Comprehensive Testing**: Test both immediate subscription and late subscription scenarios for backfill functionality

## Recent Session: Comprehensive Project Analysis & Documentation Update (2025-07-09)

### Complete Architecture Analysis

**Project Structure Deep Dive**:
- **Base Architecture**: Analyzed `src/providers/base.ts` with CloudProvider abstract class and sophisticated error handling
- **Provider Implementations**: Detailed analysis of both DynamoDB and Memory providers with their distinct architectures
- **Operator System**: Comprehensive analysis of persist, persistReplay, and semaphore operators
- **Subject Architecture**: Deep dive into CloudReplaySubject with dual subscription model
- **Testing Infrastructure**: Complete analysis of Jest configuration, test containers, and logging systems

**Key Architectural Insights**:
- **Singleton Pattern**: CloudProvider instances cached by ID for resource efficiency
- **Dual Subscription Model**: CloudReplaySubject uses separate streams for persistence and replay
- **Provider Agnostic Design**: All operators work with any CloudProvider implementation
- **Comprehensive Error Handling**: Clear distinction between RetryError and FatalError
- **Resource Management**: Sophisticated cleanup with abort controllers and subscription management

### Testing Strategy Analysis

**Multi-Provider Testing**:
- **Same Test Suite**: Identical tests run against both Memory and DynamoDB providers
- **Realistic Integration**: DynamoDB Local containers for true integration testing
- **Timing Control**: Configurable delays for race condition and timing scenario testing
- **Resource Cleanup**: Comprehensive cleanup patterns with abort controllers

**Test Pattern Categories**:
- **Provider Tests**: Singleton behavior, streaming, error handling, resource management
- **Operator Tests**: Observable type coverage, timing scenarios, completion logic, error propagation
- **Subject Tests**: Backfill scenarios, cross-instance sharing, persistence integration, snapshot testing
- **Integration Tests**: Full DynamoDB Local integration with real streaming

### Development Workflow Enhancement

**Comprehensive Build System**:
- **TypeScript Configuration**: Strict mode with complete type safety
- **Source Maps**: Full debugging support with source map generation
- **Declaration Files**: Automatic .d.ts generation for library consumers
- **Multi-Format Output**: ES modules and CommonJS for broad compatibility

**Quality Assurance**:
- **Pre-Commit Checklist**: Mandatory linting, type checking, testing, and build verification
- **Test Execution Variants**: Standard, verbose, silent, and watch modes
- **Integration Verification**: DynamoDB Local testing for real-world scenarios
- **Performance Testing**: Memory usage and resource cleanup verification

### Documentation Completeness

**Architectural Documentation**:
- **Component Deep Dives**: Detailed analysis of each architectural component
- **Design Pattern Explanations**: Comprehensive explanation of singleton, observer, factory, and strategy patterns
- **Testing Philosophy**: Complete testing approach with multi-provider coverage
- **Error Handling Strategy**: Detailed error classification and handling approaches

**Development Guidelines**:
- **Best Practices**: Comprehensive coding standards and architectural principles
- **Test Development**: Detailed testing patterns and helper function usage
- **Performance Considerations**: Memory management and resource efficiency guidelines
- **Security Notes**: Credential handling and permission management

### Future Architecture Considerations

**Extensibility Features**:
- **Provider Interface**: Well-defined interface for adding new cloud providers
- **Logger Interface**: Flexible logging support for various logging libraries
- **Configuration System**: Extensive configuration options for all components
- **Generic Type System**: Comprehensive TypeScript generics for type safety

**Performance Optimizations**:
- **Stream Optimization**: Efficient stream sharing with shareReplay(1)
- **Memory Management**: Proper subscription cleanup and resource disposal
- **Concurrency Control**: Semaphore operator for cloud provider rate limiting
- **Caching Strategy**: Provider instance caching for resource efficiency

### Session Learnings

**Documentation Strategy**:
- **Complete Coverage**: Document not just functionality but internal architecture and design decisions
- **Testing Integration**: Include comprehensive testing patterns and infrastructure details
- **Development Workflow**: Complete development process from code changes to deployment
- **Architecture Evolution**: Track how patterns mature through usage and testing

**Best Practices Established**:
- **Systematic Analysis**: Comprehensive project analysis reveals architectural patterns
- **Multi-Provider Design**: Architecture supports multiple cloud providers seamlessly
- **Testing Excellence**: Sophisticated testing infrastructure with real cloud integration
- **Documentation Completeness**: Comprehensive documentation enables effective maintenance and extension