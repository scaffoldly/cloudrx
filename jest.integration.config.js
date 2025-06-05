module.exports = {
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
  testTimeout: 120000, // Increased for container startup/teardown
  verbose: true,
  // Ensure tests run serially to avoid Docker conflicts
  maxWorkers: 1,
  // Bail on first failure to avoid hanging containers
  bail: true,
};