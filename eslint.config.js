const { FlatCompat } = require('@eslint/eslintrc');
const noSpotifyOutsideAdapters = require('./eslint-rules/no-spotify-outside-adapters');

const compat = new FlatCompat({ baseDirectory: process.cwd() });

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  { ignores: ['node_modules/**', 'dist/**', '.expo/**', 'examples/**'] },
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
];
