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

> [!NOTE] > **Coming Soon**: `CloudAsyncSubject` and `CloudBehaviorSubject` are planned for future releases to provide cloud-backed versions of all RxJS subject types.

### `CloudReplaySubject<T>` (`extends ReplaySubject<T>`)

CloudReplaySubject is a cloud-backed RxJS ReplaySubject that automatically persists all emissions to a cloud provider and replays historical data to new subscribers. Multiple CloudReplaySubjects using the same provider automatically share all events, making it perfect for distributed event streaming and cross-instance communication.

#### DynamoDB

##### Imports

```typescript
import { CloudReplaySubject, DynamoDB } from 'cloudrx';
import { filter } from 'rxjs';
```

##### Example Usage

```typescript
type UserEvent = {
  action: 'login' | 'clicked' | 'purchase' | 'purchased';
  userId: number;
  productId?: number;
  transactionId?: number;
};

// Create cloud-backed replay subjects using the same DynamoDB table
// - These can be on different machines, different processes, etc.
const auth = new CloudReplaySubject<UserEvent>(DynamoDB.from('my-site'));
const cart = new CloudReplaySubject<UserEvent>(DynamoDB.from('my-site'));
const user = new CloudReplaySubject<UserEvent>(DynamoDB.from('my-site'));

// Emit a 'login' event, which will broadcast to all subjects
auth.next(
  {
    action: 'login',
    userId: 123,
  },
  new Date(Date.now() + 5000) // Emit an 'expire' event in 5 seconds
);

// Emit a 'pruchase' event, which will broadcast to all subjects
cart.next({
  action: 'purchase',
  userId: 123,
  productId: 456,
});

// Emit a 'purchased' event, which will broadcast to all subjects
user.next({
  action: 'purchased',
  userId: 123,
  transactionId: 789,
});

// All subjects receive all events
auth
  // Only listen for 'login' events
  .pipe(filter((event) => event.action === 'login'))
  .subscribe((event) => {
    console.log('Auth received:', event);
  });

cart.subscribe((event) => {
  console.log('Cart received:', event);
});

user.subscribe((event) => {
  console.log('User received:', event);
});

// (Optional) Listen for expired events for additional handling for each subject
user.on('expired', (event) => {
  if (event.action === 'login') {
    console.log('User received expired login event:', event);
  }
});

// Auth Output:
// - Note: Only 'login' events because of the filter
// Auth received: { action: 'login', userId: 123 }

// Cart Output:
// Cart received: { action: 'login', userId: 123 }
// Cart received: { action: 'purchase', userId: 123, productId: 456 }
// Cart received: { action: 'purchased', userId: 123, transactionId: 789 }

// User Output:
// User received: { action: 'login', userId: 123 }
// User received: { action: 'purchase', userId: 123, productId: 456 }
// User received: { action: 'purchased', userId: 123, transactionId: 789 }
// ... 5 seconds later:
// User session received expired login event: { action: 'login', userId: 123 }
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
- ⏰ **TTL Support** - Time To Live functionality with automatic expiration and expired event handling
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
- **TTL Support** - Items can be emitted with optional expiration times using `next(value, expiresDate)`
- **Expired Event Handling** - Listen for expired events using `subject.on('expired', callback)`
- **Provider Integration** - Works with any CloudProvider (DynamoDB, Memory, etc.)
- **ReplaySubject Behavior** - Maintains standard RxJS ReplaySubject semantics

**TTL and Expiration:**

CloudReplaySubject supports Time To Live (TTL) functionality for automatic data expiration:

```typescript
const subject = new CloudReplaySubject(DynamoDB.from('events'));

// Listen for expired events
subject.on('expired', (expiredData) => {
  console.log('Data expired:', expiredData);
});

// Emit data with expiration
const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now
subject.next({ message: 'This will expire in 1 hour' }, expiresAt);

// Emit data without expiration (persists indefinitely)
subject.next({ message: 'This persists forever' });
```

**Event Listener Methods:**

- `subject.on('expired', callback)` - Listen for expired events
- `subject.off('expired', callback)` - Remove expired event listener
- `subject.removeAllListeners('expired')` - Remove all expired event listeners

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
