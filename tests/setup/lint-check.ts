import { ESLint } from 'eslint';
import path from 'path';

export async function runLintCheck(): Promise<void> {
  const eslint = new ESLint({
    cwd: path.resolve(__dirname, '../..'),
  });

  console.log('🔍 Running ESLint check...');

  // Use '.' to lint everything (same as 'npm run lint' which does 'eslint .')
  const results = await eslint.lintFiles(['.']);

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
    // Format results manually without loadFormatter to avoid dynamic imports
    console.error('❌ ESLint found issues:');

    for (const result of results) {
      if (result.errorCount > 0 || result.warningCount > 0) {
        console.error(`\n${result.filePath}:`);
        for (const message of result.messages) {
          const type = message.severity === 2 ? 'error' : 'warning';
          const rule = message.ruleId ? ` ${message.ruleId}` : '';
          console.error(
            `  ${message.line}:${message.column}  ${type}  ${message.message}${rule}`
          );
        }
      }
    }

    if (errorCount > 0) {
      console.error(`\n✖ ${errorCount} error(s), ${warningCount} warning(s)`);
      throw new Error(
        `ESLint found ${errorCount} error(s) and ${warningCount} warning(s). Tests cannot proceed with linting errors.`
      );
    } else {
      console.warn(`\n⚠ ${warningCount} warning(s), 0 errors`);
      console.warn('⚠️ ESLint found warnings, but no errors.');
    }
  } else {
    console.log('✅ ESLint check passed - no issues found');
  }
}
