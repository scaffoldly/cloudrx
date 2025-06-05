export const setupIntegrationTests = (): void => {
  // Set longer timeout for integration tests
  jest.setTimeout(30000);
  
  // Setup any global test utilities
  console.log('Setting up integration tests...');
};

export const teardownIntegrationTests = (): void => {
  // Cleanup any resources after tests
  console.log('Tearing down integration tests...');
};