import { ESLint } from 'eslint';
import { glob } from 'glob';
import path from 'path';

export async function runLintCheck(): Promise<void> {
  const eslint = new ESLint({
    cwd: path.resolve(__dirname, '../..'),
  });

  // Find all TypeScript files in src, tests, and integration-tests directories
  const files = await glob('{src,tests,integration-tests}/**/*.ts', {
    cwd: path.resolve(__dirname, '../..'),
    absolute: true,
  });

  if (files.length === 0) {
    throw new Error('No TypeScript files found to lint');
  }

  console.log(`🔍 Linting ${files.length} TypeScript files...`);

  try {
    const results = await eslint.lintFiles(files);

    // Check if there are any errors or warnings
    const errorCount = results.reduce(
      (sum: number, result) => sum + result.errorCount,
      0
    );
    const warningCount = results.reduce(
      (sum: number, result) => sum + result.warningCount,
      0
    );

    if (errorCount > 0 || warningCount > 0) {
      // Format and display results
      const formatter = await eslint.loadFormatter('stylish');
      const resultText = await formatter.format(results, {
        cwd: path.resolve(__dirname, '../..'),
        rulesMeta: {},
      });

      console.error('❌ ESLint found issues:');
      console.error(resultText);

      if (errorCount > 0) {
        throw new Error(
          `ESLint found ${errorCount} error(s) and ${warningCount} warning(s). Tests cannot proceed with linting errors.`
        );
      } else {
        console.warn(
          `⚠️  ESLint found ${warningCount} warning(s), but no errors.`
        );
      }
    } else {
      console.log('✅ ESLint check passed - no issues found');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('ESLint found')) {
      throw error; // Re-throw our custom error
    }
    console.error('❌ ESLint check failed:', error);
    throw new Error(`ESLint execution failed: ${error}`);
  }
}
