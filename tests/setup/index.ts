import { runLintCheck } from './lint-check';
import { runTypeCheck } from './type-check';
import pino from 'pino';

const logger = pino({
  name: 'cloudrx-test-setup',
  level: 'info',
});

// Global setup that runs before all tests
beforeAll(async () => {
  logger.info('🚀 Running pre-test checks...\n');

  try {
    // Run TypeScript type checking first
    runTypeCheck();

    // Then run ESLint checking
    await runLintCheck();

    logger.info('\n✅ All pre-test checks passed!\n');
  } catch (error) {
    logger.error({ error }, '\n❌ Pre-test checks failed');
    logger.error('\n💡 Fix linting/type errors before running tests.\n');

    // Fail the test suite immediately
    throw error;
  }
}, 30000); // 30 second timeout for checks
