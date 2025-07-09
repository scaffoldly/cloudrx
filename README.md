# CloudRx

TypeScript library for streaming cloud provider events using RxJS. It provides reactive interfaces for cloud services like DynamoDB Streams with automatic persistence and replay capabilities.

## Prerequisites

CloudRx extends RxJS to provide cloud-backed reactive streams. It requires:

- [`rxjs`](https://www.npmjs.com/package/rxjs): `v7` or higher
- Node.js: `v20` or higher

## Installation

CloudRx is built on top of RxJS 7+ and provides cloud-backed extensions to standard RxJS operators and subjects.

```bash
# Install RxJS if not already installed
npm install rxjs

# Install CloudRx
npm install cloudrx@beta
```

## Usage

> [!NOTE]
> **Coming Soon**: `CloudAsyncSubject` and `CloudBehaviorSubject` are planned for future releases to provide cloud-backed versions of all RxJS subject types.

### `CloudReplaySubject<T>` (`extends ReplaySubject<T>`)

CloudReplaySubject is a cloud-backed RxJS ReplaySubject that automatically persists all emissions to a cloud provider and replays historical data to new subscribers. Multiple CloudReplaySubjects using the same provider automatically share all events, making it perfect for distributed event streaming and cross-instance communication.

#### DynamoDB

```typescript
import { CloudReplaySubject, DynamoDB } from 'cloudrx';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

// Create cloud-backed replay subjects using the same DynamoDB table
const provider = DynamoDB.from('events')
  .withClient(new DynamoDBClient({ region: 'us-east-1' }));

const subject0 = new CloudReplaySubject(provider);
const subject1 = new CloudReplaySubject(provider);
const subject2 = new CloudReplaySubject(provider);

// Emit a 'login' event to subject0
subject0.next({
  type: 'user-action',
  data: { userId: 123, action: 'login' },
});

// Emit a 'purchase' event to subject1
subject1.next({
  type: 'user-action',
  data: { userId: 123, action: 'purchase' },
});

// Emit a 'purchase' event to subject1
subject2.next({
  type: 'user-action',
  data: { userId: 123, action: 'processing' },
});

// Both subjects automatically recieve both events
subject1.subscribe((event) => {
  console.log('Subject1 received:', event);
});

subject2.subscribe((event) => {
  console.log('Subject2 received:', event);
});

// Output for subject1:
// Subject1 received: { type: 'user-action', data: { userId: 123, action: 'login' } }
// Subject1 received: { type: 'user-action', data: { userId: 123, action: 'purchase' } }
// Subject1 received: { type: 'user-action', data: { userId: 123, action: 'processing' } }

// Output for subject2:
// Subject2 received: { type: 'user-action', data: { userId: 123, action: 'login' } }
// Subject2 received: { type: 'user-action', data: { userId: 123, action: 'purchase' } }
// Subject2 received: { type: 'user-action', data: { userId: 123, action: 'processing' } }
```

##### DynamoDB Builder

The `DynamoDB.from()` method returns a builder that allows for fluent configuration of the DynamoDB provider:

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CloudReplaySubject, DynamoDB } from 'cloudrx';

const subject = new CloudReplaySubject(
  DynamoDB.from('user-events')
    .withClient(new DynamoDBClient({ region: 'us-east-1' }))
    .withHashKey('userId')
    .withRangeKey('timestamp')
    .withTtlAttribute('expiresAt')
    .withPollInterval(3000)
    .withLogger(console)
);
```

**Available Builder Methods**:

| Method                    | Parameter Type     | Default                | Description                                             |
| ------------------------- | ------------------ | ---------------------- | ------------------------------------------------------- |
| `withClient()`            | `DynamoDBClient`   | `new DynamoDBClient()` | Set the DynamoDB client                                 |
| `withHashKey()`           | `string`           | `'hashKey'`            | Set the hash key attribute name                          |
| `withRangeKey()`          | `string`           | `'rangeKey'`           | Set the range key attribute name                         |
| `withTtlAttribute()`      | `string`           | `'expires'`            | Set the TTL attribute name                               |
| `withPollInterval()`      | `number`           | `5000`                 | Set the poll interval in milliseconds                   |
| `withLogger()`            | `Logger`           | `undefined`            | Set the logger (console-compatible interface)           |
| `withSignal()`            | `AbortSignal`      | `undefined`            | Set the abort signal for graceful cleanup               |

**Table Management:**

The DynamoDB provider automatically:

- Creates the table if it doesn't exist with the specified hash and range keys
- Enables DynamoDB Streams with `NEW_AND_OLD_IMAGES` view type
- Configures TTL on the specified attribute
- Validates existing table schema matches the specified keys
- Sets up proper indexes and billing mode (`PAY_PER_REQUEST`)

**Generated Table Name:**

Tables are automatically named with the pattern `cloudrx-{id}` where `{id}` is the first parameter passed to `DynamoDB.from()`.

## Features

- 🌩️ **DynamoDB Streams Integration** - Real-time streaming from DynamoDB with automatic persistence
- 🔄 **RxJS Operators** - `persist` and `persistReplay` operators for seamless integration
- 📡 **CloudReplaySubject** - Cloud-backed ReplaySubject with automatic persistence and replay
- 🎯 **Event Replay** - Automatic replay of persisted events on subscription using DynamoDB Streams
- 🚀 **Reactive Persistence** - Store and retrieve data reactively with Observable patterns
- 📦 **TypeScript First** - Full type safety and IntelliSense support
- 🧪 **Battle Tested** - Comprehensive test coverage with DynamoDB Local integration

## Core Components

### Operators

- **`persist(provider$)`** - Stores each emitted value and returns it after successful persistence
- **`persistReplay(provider$)`** - Stores values and replays all previously persisted items on subscription

### Providers

- **`DynamoDB`** - AWS DynamoDB with DynamoDB Streams for real-time event streaming
  - Builder pattern for fluent configuration
  - Configurable TTL for automatic cleanup
  - Shard-based streaming with automatic discovery
  - Error handling with retry/fatal error distinction
- **`Memory`** - In-memory provider for testing
  - Builder pattern for fluent configuration
  - Configurable delays for initialization, emission, and storage

## Subjects

### CloudReplaySubject

The CloudReplaySubject is a cloud-backed RxJS ReplaySubject that automatically persists emissions and replays historical data for late subscribers.

**Key Features:**

- **Automatic Persistence** - All emitted values are automatically stored to the cloud provider
- **Historical Replay** - Late subscribers receive all previously persisted data
- **Cross-Instance Sharing** - Multiple CloudReplaySubjects using the same provider (e.g., `DynamoDB.from('events')`) automatically share all historical events
- **Provider Integration** - Works with any CloudProvider (DynamoDB, Memory, etc.)
- **ReplaySubject Behavior** - Maintains standard RxJS ReplaySubject semantics

## Development

### Prerequisites

- Node.js >= 20
- npm or yarn

### Setup

```bash
# Clone the repository
git clone <repository-url>
cd cloudrx

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

### Available Scripts

- `npm run build` - Compile TypeScript
- `npm run clean` - Remove dist directory
- `npm test` - Run unit tests with 30s timeout
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues automatically
- `npx tsc --noEmit` - TypeScript compilation check

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass: `npm test`
6. Ensure code quality: `npm run lint`
7. Submit a pull request

## License

[Apache License 2.0](LICENSE.txt)
