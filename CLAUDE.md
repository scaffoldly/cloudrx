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

#### `persistTo` Operator

- **Purpose**: Stores items to a cloud provider and waits for them to appear back in the stream
- **Usage**: `source$.pipe(persistTo(provider$))`
- **Key Features**:
  - Handles async provider initialization per emission to support hot observables
  - Uses `mergeMap` to store each source value via `provider.store()`
  - Returns the original item after successful storage and stream confirmation
  - Proper cleanup via provider's abort signal handling
  - **Hot Observable Support**: No explicit provider initialization required - operator handles timing internally
- **Observable Compatibility**: Works with all RxJS observable types:
  - **Cold Observables** (`of()`, `from()`) - Immediate emission on subscription
  - **Subject** - Hot observable, no initial value, no replay
  - **BehaviorSubject** - Hot observable with initial value
  - **ReplaySubject** - Hot observable that buffers and replays values
  - **AsyncSubject** - Only emits the final value when completed
- **Testing Patterns**:
  - **Cold Observables**: Use `of()` for simple, predictable test scenarios
  - **Hot Observables**: No explicit provider initialization needed - `persistTo` handles timing automatically
  - **Timing Control**: Use `setTimeout()` for async emissions in hot observable tests  
  - **Proper Cleanup**: Always call `subject.complete()` to prevent memory leaks

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

## Known Issues & Considerations

### Memory Management

- Singleton pattern in `CloudProvider.from()` doesn't clean up instances
- Consider using WeakMap for automatic cleanup in future versions

### Rate Limiting

- DynamoDB shard polling interval should be tuned for production
- Consider exponential backoff for error scenarios

### TypeScript

- Generic type `StreamEvent` avoids conflicts with DOM Event type
- Strict typing on AWS SDK responses with proper null checks

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

## Session Learnings and Recommendations

### Objective: Update Memory File with Session Insights

- **Lesson Learned**: Systematic documentation of development insights is crucial for maintaining project knowledge
- **Recommendation**: Consistently update this memory file after each significant development milestone or when key architectural decisions are made
- **Best Practice**: Use this section to capture not just technical details, but also reasoning behind design choices and potential future improvements
- **Continuous Improvement**: Treat this memory file as a living document that evolves with the project's complexity and maturity