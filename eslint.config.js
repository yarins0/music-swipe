const { FlatCompat } = require('@eslint/eslintrc');
const noSpotifyOutsideAdapters = require('./eslint-rules/no-spotify-outside-adapters');

const compat = new FlatCompat({ baseDirectory: process.cwd() });

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  { ignores: ['**/node_modules/**', '**/dist/**', '.expo/**', 'examples/**'] },
  ...compat.extends('expo'),
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: {
      local: {
        rules: {
          'no-spotify-outside-adapters': noSpotifyOutsideAdapters,
        },
      },
    },
    rules: {
      'local/no-spotify-outside-adapters': 'error',
    },
  },
  {
    // Jest test files put jest.mock() calls before imports (the mock-before-import
    // pattern jest's hoisting requires) and use dynamic require() after mocks are
    // installed. Both are idiomatic for tests but trip import-ordering / no-require
    // rules, so disable those two rules for test files only.
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      'import/first': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
