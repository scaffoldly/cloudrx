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