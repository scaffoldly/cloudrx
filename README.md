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

## Quick Start

### CloudReplaySubject for DynamoDB Persistence

```typescript
import { CloudReplaySubject, DynamoDB } from 'cloudrx';

// Create a cloud-backed replay subject
const subject = new CloudReplaySubject(DynamoDB.from('events-table', options));

// Subscribe to persisted events (includes replay)
subject.subscribe((event) => {
  console.log('Received event:', event);
});

// Emit values that are automatically persisted
subject.next({ type: 'user-action', data: { userId: 123 } });
```

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
- **Provider Integration** - Works with any CloudProvider (DynamoDB, Memory, etc.)
- **ReplaySubject Behavior** - Maintains standard RxJS ReplaySubject semantics

**Usage:**

```typescript
import { CloudReplaySubject, DynamoDB } from 'cloudrx';

// Create with DynamoDB provider
const subject = new CloudReplaySubject(DynamoDB.from('events-table', options));

// Subscribe before or after seeding - both get full history
subject.subscribe((item) => console.log('Historical + Live:', item));

// Emit new data that gets persisted and replayed
subject.next({ message: 'new data' });
```

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

GNU General Public License v3.0
