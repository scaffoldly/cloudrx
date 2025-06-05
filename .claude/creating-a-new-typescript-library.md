# Creating a New TypeScript Library - Template Instructions

This document provides step-by-step instructions for creating a professional TypeScript library with the same structure and configuration as CloudRx.

## Step 1: Project Initialization

### Create Directory Structure
```bash
mkdir -p <project-name>/src
mkdir -p <project-name>/tests
mkdir -p <project-name>/integration-tests
mkdir -p <project-name>/.github/workflows
cd <project-name>
```

## Step 2: Core Configuration Files

### package.json
Create with the following structure:
```json
{
  "name": "<project-name>",
  "version": "0.1.0",
  "description": "<project description>",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": [
    "dist/**/*.js",
    "dist/**/*.d.ts",
    "dist/**/*.js.map"
  ],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist",
    "prepublishOnly": "npm run clean && npm run build",
    "lint": "eslint src --ext .ts",
    "lint:fix": "eslint src --ext .ts --fix",
    "format": "prettier --write src/**/*.ts",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:integration": "jest --config jest.integration.config.js",
    "test:integration:watch": "jest --config jest.integration.config.js --watch",
    "test:all": "npm run test && npm run test:integration"
  },
  "keywords": [
    "typescript",
    "library"
  ],
  "author": "",
  "license": "GPL-3.0",
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.0.0",
    "jest": "^29.5.0",
    "prettier": "^3.0.0",
    "ts-jest": "^29.1.0",
    "typescript": "^5.0.0"
  },
  "engines": {
    "node": ">=16"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "inlineSourceMap": false,
    "inlineSources": true,
    "removeComments": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  },
  "include": [
    "src/**/*"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "**/*.test.ts",
    "**/*.spec.ts"
  ]
}
```

### jest.config.js (ES Module syntax)
```javascript
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};
```

### jest.integration.config.js
```javascript
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/integration-tests'],
  testMatch: ['**/*.integration.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/integration-tests/setup.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage-integration',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 30000,
  verbose: true,
};
```

### .eslintrc.js
```javascript
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  extends: [
    '@typescript-eslint/recommended',
  ],
  plugins: [
    '@typescript-eslint',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
  },
  env: {
    node: true,
    jest: true,
  },
};
```

### .prettierrc
```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 80,
  "tabWidth": 2,
  "useTabs": false
}
```

## Step 3: Source Code Structure

### src/index.ts (Main Export File)
```typescript
export * from './[main-class-name]';
// Add additional exports as needed
```

### src/[main-class-name].ts
```typescript
export class [MainClassName] {
  constructor() {
    // Initialize library
  }

  public hello(): string {
    return 'Hello from [LibraryName]!';
  }
}
```

### Additional Source Files
Create additional TypeScript files in `src/` as needed for your library's functionality.

## Step 4: Test Structure

### tests/[main-class-name].test.ts
```typescript
import { [MainClassName] } from '../src/[main-class-name]';

describe('[MainClassName]', () => {
  let instance: [MainClassName];

  beforeEach(() => {
    instance = new [MainClassName]();
  });

  it('should create an instance', () => {
    expect(instance).toBeDefined();
  });

  it('should return hello message', () => {
    expect(instance.hello()).toBe('Hello from [LibraryName]!');
  });
});
```

### integration-tests/setup.ts
```typescript
export const setupIntegrationTests = (): void => {
  jest.setTimeout(30000);
  console.log('Setting up integration tests...');
};

export const teardownIntegrationTests = (): void => {
  console.log('Tearing down integration tests...');
};
```

### integration-tests/[feature].integration.test.ts
```typescript
import { [MainClassName] } from '../src/[main-class-name]';

describe('[Feature] Integration Tests', () => {
  let instance: [MainClassName];

  beforeEach(() => {
    instance = new [MainClassName]();
  });

  afterEach(async () => {
    // Cleanup resources
  });

  it('should test integration functionality', async () => {
    expect(instance).toBeDefined();
  });
});
```

## Step 5: Documentation

### README.md Template
```markdown
# [Library Name]

[Brief description of the library purpose]

## Installation

\`\`\`bash
npm install [library-name]
\`\`\`

## Quick Start

\`\`\`typescript
import { [MainClassName] } from '[library-name]';

const instance = new [MainClassName]();
console.log(instance.hello());
\`\`\`

## Features

- Feature 1
- Feature 2
- TypeScript first
- Comprehensive testing

## Development

### Prerequisites
- Node.js >= 16
- npm or yarn

### Setup
\`\`\`bash
git clone <repository-url>
cd [library-name]
npm install
npm run build
npm run test
npm run test:integration
npm run test:all
\`\`\`

### Available Scripts
- \`npm run build\` - Compile TypeScript
- \`npm run dev\` - Watch mode compilation
- \`npm run test\` - Run unit tests
- \`npm run test:watch\` - Run unit tests in watch mode
- \`npm run test:integration\` - Run integration tests
- \`npm run test:integration:watch\` - Run integration tests in watch mode
- \`npm run test:all\` - Run all tests (unit + integration)
- \`npm run lint\` - Check code quality
- \`npm run lint:fix\` - Fix linting issues
- \`npm run format\` - Format code with Prettier

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass: \`npm test\`
6. Ensure code quality: \`npm run lint\`
7. Submit a pull request

## License

GNU General Public License v3.0
```

### CLAUDE.md Template
```markdown
# [Library Name] - Claude Operating Notes

## Project Overview
[Description of what this library does and its purpose]

## Development Workflow

### Build and Test Commands
- \`npm run build\` - Compile TypeScript to JavaScript
- \`npm run dev\` - Watch mode compilation
- \`npm run test\` - Run unit tests
- \`npm run test:watch\` - Run unit tests in watch mode
- \`npm run test:integration\` - Run integration tests
- \`npm run test:integration:watch\` - Run integration tests in watch mode
- \`npm run test:all\` - Run all tests (unit + integration)
- \`npm run lint\` - Check code with ESLint
- \`npm run lint:fix\` - Auto-fix linting issues
- \`npm run format\` - Format code with Prettier
- \`npm run clean\` - Remove dist directory

### Project Structure
\`\`\`
src/
├── index.ts          # Main export file
├── [main-class].ts   # Core class
└── [additional-files].ts  # Additional library functionality
tests/
├── [main-class].test.ts   # Unit test files
integration-tests/    # Integration tests
├── setup.ts          # Integration test setup/teardown
└── [feature].integration.test.ts  # Integration test files
dist/                 # Compiled output (gitignored)
\`\`\`

### Code Standards
- Strict TypeScript configuration enabled
- ESLint with TypeScript rules
- Prettier for code formatting
- Jest for testing
- Export everything through \`src/index.ts\`

### Before Commits
Always run these commands to ensure code quality:
1. \`npm run lint\` - Check for linting errors
2. \`npm run build\` - Ensure TypeScript compiles without errors
3. \`npm run test:all\` - Ensure all tests pass

### Dependencies
- TypeScript 5.x
- Jest for testing
- ESLint + Prettier for code quality
- Node.js >= 16 required
```

## Step 6: Git Configuration

Update .gitignore to include:
```
# Build output
dist/

# Coverage reports
coverage/
coverage-integration/
```

## Step 7: Final Setup Commands

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run all tests
npm run test:all

# Check code quality
npm run lint
```

## Notes

- Replace all `[placeholder]` values with actual project-specific names
- Update package.json keywords and description for the specific library
- Customize integration tests based on the library's functionality
- Keep CLAUDE.md and README.md updated as the project evolves
- Use GPL-3.0 license unless specified otherwise
- Ensure all exports go through the main index.ts file
- Follow strict TypeScript configuration for better code quality