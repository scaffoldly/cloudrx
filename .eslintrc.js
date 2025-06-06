module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: [
    '@typescript-eslint',
    'deprecation',
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
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/no-explicit-any': 'error',
    'no-console': 'error',
  },
  env: {
    node: true,
    jest: true,
  },
};