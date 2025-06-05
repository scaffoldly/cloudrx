import pino from 'pino';

const logger = pino({
  name: 'cloudrx-integration-tests',
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
});

export const setupIntegrationTests = (): void => {
  // Set longer timeout for integration tests
  jest.setTimeout(120000); // Increased for container startup/teardown

  // Setup any global test utilities
  logger.info('Setting up integration tests...');
};

export const teardownIntegrationTests = (): void => {
  // Cleanup any resources after tests
  logger.info('Tearing down integration tests...');
};
