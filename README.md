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

### `CloudReplaySubject<T>` (`extends ReplaySubject<T>`)

CloudReplaySubject is a cloud-backed RxJS ReplaySubject that automatically persists all emissions to a cloud provider and replays historical data to new subscribers. Multiple CloudReplaySubjects using the same provider automatically share all events, making it perfect for distributed event streaming and cross-instance communication.

#### DynamoDB

```typescript
import { CloudReplaySubject, DynamoDB } from 'cloudrx';

// Create cloud-backed replay subjects using the same DynamoDB table
const subject0 = new CloudReplaySubject(DynamoDB.from('events'));
const subject1 = new CloudReplaySubject(DynamoDB.from('events'));
const subject2 = new CloudReplaySubject(DynamoDB.from('events'));

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

##### DynamoDBOptions

The `DynamoDB.from()` method accepts an optional `DynamoDBOptions` object to configure the DynamoDB provider:

| Option         | Type             | Default                | Description                                             |
| -------------- | ---------------- | ---------------------- | ------------------------------------------------------- |
| `client`       | `DynamoDBClient` | `new DynamoDBClient()` | Pre-configured DynamoDBClient instance                  |
| `hashKey`      | `string`         | `'hashKey'`            | Name of the hash key attribute in the DynamoDB table    |
| `rangeKey`     | `string`         | `'rangeKey'`           | Name of the range key attribute in the DynamoDB table   |
| `ttlAttribute` | `string`         | `'expires'`            | Name of the TTL attribute for automatic record cleanup  |
| `pollInterval` | `number`         | `5000`                 | Stream polling interval in milliseconds                 |
| `logger`       | `Logger`         | `undefined`            | Optional logger instance (console-compatible interface) |
| `signal`       | `AbortSignal`    | `undefined`            | Optional AbortSignal for graceful cleanup               |

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CloudReplaySubject, DynamoDB } from 'cloudrx';

const options = {
  client: new DynamoDBClient({ region: 'us-east-1' }),
  hashKey: 'userId',
  rangeKey: 'timestamp',
  ttlAttribute: 'expiresAt',
  pollInterval: 3000,
  logger: console,
};

const subject = new CloudReplaySubject(DynamoDB.from('user-events', options));
```

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
  - Configurable TTL for automatic cleanup
  - Shard-based streaming with automatic discovery
  - Error handling with retry/fatal error distinction

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
- `npm test` - Run unit tests (info level logs)
- `npm test -- --verbose` - Run with debug level logs
- `npm test -- --silent` - Run with no logs
- `npm run test:watch` - Watch mode for development
- `npm run test:integration` - Run integration tests with DynamoDB Local
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues
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
