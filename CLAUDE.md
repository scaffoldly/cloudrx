# CloudRx - Claude Operating Notes

## Project Overview
CloudRx is a TypeScript library that extends RxJS with cloud-backed subjects and observables for persistence and orchestration. It provides reactive streams that automatically persist state to cloud storage and enable distributed coordination across multiple environments.

## Development Workflow

### Build and Test Commands
- `npm run build` - Compile TypeScript to JavaScript
- `npm run dev` - Watch mode compilation
- `npm run test` - Run unit tests
- `npm run test:watch` - Run unit tests in watch mode
- `npm run test:integration` - Run integration tests
- `npm run test:integration:watch` - Run integration tests in watch mode
- `npm run test:all` - Run all tests (unit + integration) with verbose output by default
- `npm run test:verbose` - Run unit tests with verbose output
- `npm run test:integration:verbose` - Run integration tests with verbose output
- `npm run lint` - Check code with ESLint
- `npm run lint:fix` - Auto-fix linting issues
- `npm run format` - Format code with Prettier
- `npm run clean` - Remove dist directory

### Project Structure
```
src/
├── index.ts          # Main export file
├── cloudrx.ts        # Core CloudRx class
├── subjects/         # Cloud-backed RxJS subjects
│   └── index.ts
├── operators/        # Custom RxJS operators for cloud operations
│   └── index.ts
├── providers/        # Cloud storage provider implementations
│   └── index.ts
tests/
├── cloudrx.test.ts   # Unit test files
integration-tests/    # Integration tests for cloud functionality
├── setup.ts          # Integration test setup/teardown
├── subjects/         # Cloud subject integration tests
├── operators/        # Cloud operator integration tests
└── providers/        # Cloud provider integration tests
dist/                 # Compiled output (gitignored)
```

### Core Concepts
- **Cloud Subjects**: RxJS subjects that persist emissions to cloud storage with guaranteed persistence
- **Cloud Observables**: Observables that can replay persisted events
- **Providers**: Abstract base class for cloud storage backends (AWS, Azure, GCP) that implements RxJS TimestampProvider and persistence logic
- **Operators**: Custom RxJS operators for cloud-specific operations
- **Persist Method**: Provider-level method that encapsulates store-then-verify-then-emit pattern for guaranteed persistence

### Data Persistence Guarantees
CloudRx implements a **store-then-verify-then-emit** pattern through the `CloudProvider.persist()` method to ensure data integrity:

- **Guaranteed Persistence**: Values are only emitted to subscribers after successful cloud storage verification
- **Store-Verify-Emit**: Each emission follows: 1) Store to cloud, 2) Retrieve to verify, 3) Emit to subscribers via callback
- **Provider-Level Persistence**: The `persist()` method on CloudProvider encapsulates all persistence logic with proper error handling
- **Callback Pattern**: Uses callback function to emit values only after cloud verification succeeds
- **Fallback Emission**: If cloud storage fails after retries, values are still emitted locally to prevent blocking
- **Eventual Consistency**: Handles cloud storage eventual consistency with 100ms delay and double-check verification
- **Error Resilience**: Automatic retry (1 attempt) with 1s delay, 10s timeout for transient failures
- **Reusable Pattern**: The persist method can be used by any cloud-backed observable implementation

### Provider Readiness Pattern
CloudRx uses a reactive readiness pattern built into the abstract CloudProvider class:

- **Abstract Base Implementation**: `CloudProvider.isReady()` returns `Observable<boolean>` using AsyncSubject pattern
- **AsyncSubject Behavior**: Emits the last value (true) when ready, then completes immediately  
- **Provider-Specific Logic**: Each provider implements `initializeReadiness()` with custom logic
- **Unified Interface**: All providers share the same readiness API through `setReady(boolean)`
- **Automatic Initialization**: Readiness check starts automatically in constructor
- **Test Optimization**: DynamoDB provider assumes immediate readiness in test environments

**Implementation Notes:**
- DynamoDB table creation has inherent latency - readiness check handles this automatically
- All cloud operations (store, retrieve, clear) are gated by readiness check
- Store-then-verify pattern ensures data integrity with 100ms delay for eventual consistency
- Uses RxJS operators: `defer`, `delay`, `switchMap`, `retry`, `catchError`, `tap`, `timeout`
- Ensures consistent reactive patterns throughout the library
- Avoids `timer()` to prevent resource leaks - uses `defer()` + `delay()` pattern instead

### Timestamp Management
- **CloudProvider Abstract Class**: Implements RxJS `TimestampProvider` interface with configurable options
- **UTC Timestamps**: Always uses UTC time regardless of system timezone for consistent global ordering
- **Custom TimestampProvider Support**: Pass your own `TimestampProvider` via `CloudProviderOptions`
- **High-Resolution Default**: Uses `performance.now()` for sub-millisecond precision when no custom provider given
- **Consistent Timing**: All providers use the same timestamp source for event ordering
- **Cross-Platform**: Default implementation works in both Node.js and browser environments

**Usage Example:**
```typescript
// Using default high-resolution UTC timestamps (options are optional)
const provider = new DynamoDBProvider({ tableName: 'my-table' });

// Using custom timestamp provider
const customProvider = new DynamoDBProvider({ 
  tableName: 'my-table',
  timestampProvider: { now: () => Date.now() } // UTC millisecond precision
});
```

### Testing Best Practices
- **Resource Cleanup**: Always expect Jest to exit cleanly without open handles
- **Test Timeouts**: Set individual test timeouts (5-10s) rather than relying on global timeouts
- **Subscription Management**: Properly unsubscribe from all observables in test cleanup
- **Provider Disposal**: Call `dispose()` on providers in afterEach to clean up readiness subscriptions
- **Integration Test Structure**: Use proper setup/teardown with container lifecycle management
- **Error Handling**: Use `from(promise)` not `of(promise)` in RxJS chains to properly catch Promise rejections
- **Error Visibility**: Use `level: 'error'` in test loggers to show errors while suppressing info/debug noise
- **Jest-Friendly Logging**: Don't silence errors completely - let Jest display them for debugging
- **Console.log in Tests**: ESLint configured to allow console.log in test files for Jest interception
- **Friendly Test Output**: Use emoji indicators and progress messages for better test visibility
- **Verbose by Default**: All test scripts use verbose output for better debugging experience
- **Test Verification**: ALWAYS run `npm run test:all` and verify ALL tests pass before considering work complete

### Code Standards
- Strict TypeScript configuration enabled
- ESLint with TypeScript rules
- Prettier for code formatting
- Jest for testing
- Export everything through `src/index.ts`

### Before Commits
Always run these commands to ensure code quality:
1. `npm run lint` - Check for linting errors
2. `npm run build` - Ensure TypeScript compiles without errors
3. `npm run test:all` - Ensure ALL tests pass (unit + integration) and Jest exits cleanly

**CRITICAL**: Always actually run `npm run test:all` and verify all tests pass before claiming work is complete. Do not assume tests pass without running them.

### Dependencies
- TypeScript 5.x
- Jest for testing
- ESLint + Prettier for code quality
- Node.js >= 16 required

### Memory Tracking
- Keep `.claude/creating-a-new-typescript-library.md` up-to-date based on any fundamental package/structure/configuration changes we make to the project. If unsure if it's a "fundamental" project need, confirm before updating.

### Workflow Memory
**CRITICAL**: At the end of each objective you complete, ALWAYS update CLAUDE.md with relevant architecture and patterns that were discovered and implemented. This is mandatory, not optional.

**COMPLETION CHECKLIST**:
1. Update CLAUDE.md with architecture/patterns learned
2. Run `npm run test:all` and verify ALL tests pass  
3. Ensure Jest exits cleanly without open handles
4. Only then consider objective complete

### Architecture Evolution
**Recent Refactoring (Completed)**:
- Moved `storeAndVerifyThenEmit` method from CloudSubject to CloudProvider as `persist()` method
- Improved separation of concerns - persistence logic now properly encapsulated at provider level
- CloudSubject.next() simplified to use provider.persist() with callback pattern
- All existing functionality preserved with cleaner, more maintainable architecture
- Persist method is reusable for future cloud-backed observable implementations

### ESLint Configuration
- Console.log allowed in test files: `'no-console': 'off'` for `tests/**/*.ts` and `integration-tests/**/*.ts`
- Enables Jest console interception for better test debugging

### Jest Configuration
- Both unit and integration tests configured with `silent: false` for console output visibility
- Verbose mode disabled by default but available via dedicated scripts
- Integration tests run with `maxWorkers: 1` and `bail: true` for Docker container management

### Workflow Notes
- always read your notes, especially for CRITICAL notes
- always keep a .claude/current-objective.md and update it frequently so we can pick off where we left off
- Update both CLAUDE.md and .claude/current-objective.md at the end of each session 