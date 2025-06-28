# Claude Notes for CloudRx Project

## Project Overview

CloudRx is a TypeScript library for streaming cloud provider events using RxJS. It provides reactive interfaces for cloud services like DynamoDB Streams.

## Usage Examples

### Basic DynamoDB Streaming with `persistTo`

```typescript
import { of } from 'rxjs';
import { DynamoDBProvider, persistTo } from 'cloudrx';

// Create provider configuration
const options = {
  client: dynamoDbClient,
  hashKey: 'id',
  rangeKey: 'timestamp',
  signal: abortController.signal,
};

// Create provider observable
const provider$ = DynamoDBProvider.from('my-table', options);

// Data to persist
const data = [
  { message: 'hello', timestamp: Date.now() },
  { message: 'world', timestamp: Date.now() + 1 }
];

// Persist data and get it back from the stream
const result$ = of(...data).pipe(
  persistTo(provider$)
);

// Subscribe to get confirmed stored items
result$.subscribe(item => {
  console.log('Item stored and confirmed:', item);
});
```

## Key Architecture Components

### CloudProvider Abstract Class (`src/providers/index.ts`)

- **Generic Type**: Uses `StreamEvent` (not `Event` to avoid DOM conflicts)
- **EventEmitter**: Uses Node.js 'events' module for type safety
- **Stream Method**: Returns `StreamController` with cleanup capabilities
- **Error Handling**: Distinguishes between `RetryError` and `FatalError`

### DynamoDB Provider (`src/providers/aws/dynamodb.ts`)

- **Singleton Pattern**: Uses `shareReplay(1)` to prevent race conditions
- **Shard Polling**: Configurable interval (default 5000ms) with error handling
- **Configuration**: TTL attribute configurable (default 'expires')
- **Resource Cleanup**: Proper subscription management with abort signals

### RxJS Operators (`src/operators/`)

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

## Testing Notes

### DynamoDB Local

- Uses DynamoDB Local container for integration tests
- Stream polling requires actual DynamoDB Streams (not mocked)
- TTL settings need time to propagate in real AWS

### Test Structure

- Unit tests in `tests/` directory
- Integration tests in `integration-tests/` directory
- Test utilities in `tests/setup/`

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

- **RxJS**: Core reactive programming library
- **AWS SDK v3**: For DynamoDB and DynamoDB Streams
- **Jest**: Testing framework
- **ESLint**: Code linting with TypeScript support

## Performance Considerations

- Empty event arrays are delayed by 100ms to prevent tight polling loops
- Shard discovery happens independently of record polling
- Use `concatAll()` to flatten event streams efficiently

## Security Notes

- Never log or expose AWS credentials
- Use IAM roles with minimal required permissions
- AbortSignal provides secure stream termination

## Development Workflow

- after you make changes, run `npm run lint` and fix any issues
- always run `npm test` and `npx tsc --noEmit` before committing to ensure all tests pass
- fix any failing tests or type errors before committing

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