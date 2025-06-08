/**
 * ESLint configuration
 * @type {import('eslint').Linter.Config}
 */
module.exports = {
  // Root configuration - don't look for configs in parent directories
  root: true,

  // File patterns to lint
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'coverage/',
    'coverage-integration/',
    '*.d.ts',
    'examples/*/node_modules/',
  ],

  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'deprecation', 'prettier'],
  extends: [
    'prettier', // Disables ESLint rules that conflict with Prettier
  ],
  overrides: [
    {
      files: ['src/**/*.ts', 'tests/**/*.ts', 'integration-tests/**/*.ts'],
      parserOptions: {
        project: './tsconfig.json',
      },
      rules: {
        'deprecation/deprecation': 'error',
      },
    },
    {
      files: ['tests/**/*.ts', 'integration-tests/**/*.ts'],
      rules: {
        'no-console': 'off', // Allow console.log in tests for Jest interception
      },
    },
    {
      files: ['examples/**/*.js'],
      rules: {
        'no-console': 'off', // Allow console.log in examples for demonstration
        '@typescript-eslint/no-unused-vars': 'off', // Allow unused vars in examples
      },
    },
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/no-explicit-any': 'error',
    'no-console': 'error',
    'prettier/prettier': 'error', // Run Prettier as an ESLint rule
  },
  env: {
    node: true,
    jest: true,
  },
};
