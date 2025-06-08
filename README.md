# CloudRx

RxJS extensions with cloud-backed subjects and observables for persistence and orchestration.

CloudRx extends the RxJS ecosystem by providing reactive streams that automatically persist state to cloud storage and enable distributed orchestration across multiple environments. Perfect for building resilient, scalable applications that need to maintain state across restarts, crashes, or distributed deployments.

## Installation

```bash
npm install cloudrx
```

## Quick Start

```typescript
import { CloudSubject, CloudObservable } from 'cloudrx';

// Create a subject backed by cloud storage
const cloudSubject = new CloudSubject('my-stream', {
  provider: 'aws-s3',
  bucket: 'my-app-state',
});

// Subscribe to persisted events
cloudSubject.subscribe((value) => {
  console.log('Received:', value);
});

// Emit values that are automatically persisted
cloudSubject.next({ message: 'Hello CloudRx!' });
```

## Features

- 🌩️ **Cloud-Backed Persistence** - Subjects and observables that automatically persist to cloud storage
- 🔄 **RxJS Compatible** - Drop-in replacements for standard RxJS subjects and observables
- 🚀 **Multi-Provider Support** - AWS, Azure, GCP, and custom storage providers
- 🎯 **Event Replay** - Automatic replay of persisted events on subscription
- 🔗 **Distributed Orchestration** - Coordinate reactive streams across multiple instances
- 📦 **TypeScript First** - Full type safety and IntelliSense support
- 🧪 **Comprehensive Testing** - Battle-tested with extensive test coverage

## Development

### Prerequisites

- Node.js >= 16
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

# Run unit tests
npm run test

# Run integration tests
npm run test:integration

# Run all tests
npm run test:all
```

### Available Scripts

- `npm run build` - Compile TypeScript
- `npm run dev` - Watch mode compilation
- `npm run test` - Run unit tests
- `npm run test:watch` - Run unit tests in watch mode
- `npm run test:integration` - Run integration tests
- `npm run test:integration:watch` - Run integration tests in watch mode
- `npm run test:all` - Run all tests (unit + integration)
- `npm run lint` - Check code quality
- `npm run lint:fix` - Fix linting issues
- `npm run format` - Format code with Prettier

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
