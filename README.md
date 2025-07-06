# CloudRx

TypeScript library for streaming cloud provider events using RxJS. It provides reactive interfaces for cloud services like DynamoDB Streams with automatic persistence and replay capabilities.

## Installation

```bash
npm install cloudrx
```

## Quick Start

### Basic DynamoDB Streaming with `persist` Operator

```typescript
import { of } from 'rxjs';
import { DynamoDBProvider, persist } from 'cloudrx';

// Create DynamoDB provider
const provider$ = DynamoDBProvider.from('my-table', {
  client: dynamoDbClient,
  hashKey: 'id',
  rangeKey: 'timestamp'
});

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

### CloudSubject for Reactive Persistence

```typescript
import { CloudSubject } from 'cloudrx';
import { DynamoDBProvider } from 'cloudrx/providers';

// Create a cloud-backed subject
const subject = new CloudSubject(
  DynamoDBProvider.from('events-table', options)
);

// Subscribe to persisted events (includes replay)
subject.subscribe(event => {
  console.log('Received event:', event);
});

// Emit values that are automatically persisted
subject.next({ type: 'user-action', data: { userId: 123 } });
```

## Features

- 🌩️ **DynamoDB Streams Integration** - Real-time streaming from DynamoDB with automatic persistence
- 🔄 **RxJS Operators** - `persist` and `persistReplay` operators for seamless integration
- 📡 **CloudSubject** - Cloud-backed Subject with automatic persistence and replay
- 🎯 **Event Replay** - Automatic replay of persisted events on subscription using DynamoDB Streams
- 🚀 **Reactive Persistence** - Store and retrieve data reactively with Observable patterns
- 📦 **TypeScript First** - Full type safety and IntelliSense support
- 🧪 **Battle Tested** - Comprehensive test coverage with DynamoDB Local integration

## Core Components

### Operators

- **`persist(provider$)`** - Stores each emitted value and returns it after successful persistence
- **`persistReplay(provider$)`** - Stores values and replays all previously persisted items on subscription

### Providers

- **`DynamoDBProvider`** - AWS DynamoDB with DynamoDB Streams for real-time event streaming
  - Configurable TTL for automatic cleanup
  - Shard-based streaming with automatic discovery
  - Error handling with retry/fatal error distinction

### Subjects

- **`CloudSubject`** - RxJS Subject that automatically persists emissions and replays persisted data

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
