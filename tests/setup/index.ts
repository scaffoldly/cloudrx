import { runLintCheck } from './lint-check';
import { runTypeCheck } from './type-check';

// Global setup that runs before all tests
beforeAll(async () => {
  console.log('🚀 Running pre-test checks...\n');

  try {
    // Run TypeScript type checking first
    runTypeCheck();

    // Then run ESLint checking - temporarily disabled due to ESLint 9 compatibility issues
    await runLintCheck();

    console.log('\n✅ All pre-test checks passed!\n');
  } catch (error) {
    console.error('\n❌ Pre-test checks failed');
    console.error('\n💡 Fix linting/type errors before running tests.\n');

    // Fail the test suite immediately
    throw error;
  }
}, 30000); // 30 second timeout for checks
