export const setupIntegrationTests = (): void => {
  // Set longer timeout for integration tests
  jest.setTimeout(120000); // Increased for container startup/teardown
};

export const teardownIntegrationTests = (): void => {
  // Cleanup any resources after tests
};
