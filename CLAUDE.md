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
- `npm run test:all` - Run all tests (unit + integration)
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
- **Cloud Subjects**: RxJS subjects that persist emissions to cloud storage
- **Cloud Observables**: Observables that can replay persisted events
- **Providers**: Abstraction layer for different cloud storage backends (AWS, Azure, GCP)
- **Operators**: Custom RxJS operators for cloud-specific operations

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
3. `npm run test` - Ensure all tests pass

### Dependencies
- TypeScript 5.x
- Jest for testing
- ESLint + Prettier for code quality
- Node.js >= 16 required

### Memory Tracking
- Keep `.claude/creating-a-new-typescript-library.md` up-to-date based on any fundamental package/structure/configuration changes we make to the project. If unsure if it's a "fundamental" project need, confirm before updating.