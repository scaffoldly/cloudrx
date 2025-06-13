# Claude Notes for CloudRx Project

## Project Overview
CloudRx is a TypeScript library for streaming cloud provider events using RxJS. It provides reactive interfaces for cloud services like DynamoDB Streams.

## Key Architecture Components

### CloudProvider Abstract Class (`src/providers/index.ts`)
- **Generic Type**: Uses `TEvent` (not `Event` to avoid DOM conflicts)
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
- Generic type `TEvent` avoids conflicts with DOM Event type
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