module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/integration-tests'],
  testMatch: ['**/*.integration.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/integration-tests/setup.ts'],
  globalTeardown: '<rootDir>/integration-tests/teardown.ts',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage-integration',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 30000, // Timeout per test
  // Clean by default, but allow --verbose flag to show detailed output
  verbose: false,
  silent: false, // Show console output for debugging
  // Ensure tests run serially to avoid Docker conflicts
  maxWorkers: 1,
  // Bail on first failure to avoid hanging containers
  bail: true,
  // Detect open handles for debugging - should be clean now
  detectOpenHandles: true,
};