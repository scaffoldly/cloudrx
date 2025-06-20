# Claude Notes for CloudRx Project

## Project Overview

CloudRx is a TypeScript library for streaming cloud provider events using RxJS. It provides reactive interfaces for cloud services like DynamoDB Streams.

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

## Development Commands

### Testing

```bash
npm test                    # Run unit tests
npm run test:integration   # Run integration tests
```

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

## Session Learnings and Recommendations

### Objective: Update Memory File with Session Insights

- **Lesson Learned**: Systematic documentation of development insights is crucial for maintaining project knowledge
- **Recommendation**: Consistently update this memory file after each significant development milestone or when key architectural decisions are made
- **Best Practice**: Use this section to capture not just technical details, but also reasoning behind design choices and potential future improvements
- **Continuous Improvement**: Treat this memory file as a living document that evolves with the project's complexity and maturity
