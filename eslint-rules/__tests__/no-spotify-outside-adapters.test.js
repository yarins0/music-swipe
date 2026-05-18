'use strict';

const { RuleTester } = require('eslint');
const rule = require('../no-spotify-outside-adapters');

// RuleTester.run() creates its own describe/it blocks — must be called at top level.
const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2020, sourceType: 'module' },
});

ruleTester.run('no-spotify-outside-adapters', rule, {
  valid: [
    // A file inside src/adapters/ may import from spotify/
    {
      code: "import { SpotifyAdapter } from './SpotifyAdapter';",
      filename: '/project/src/adapters/spotify/helper.ts',
    },
    // A file in src/adapters/__tests__/ is inside the adapter boundary
    {
      code: "import { spotifyFetch } from '../../spotify/spotifyFetch';",
      filename: '/project/src/adapters/__tests__/spotify/spotifyFetch.test.ts',
    },
    // AuthGateway.ts is the sole authorized factory outside src/adapters/
    {
      code: "import { SpotifyAdapter } from './spotify/SpotifyAdapter';",
      filename: '/project/src/auth/AuthGateway.ts',
    },
    // Non-Spotify import from outside adapters/ is always fine
    {
      code: "import { MusicPlatformAdapter } from '@/adapters';",
      filename: '/project/src/components/Something.ts',
    },
  ],
  invalid: [
    // A UI component directly importing SpotifyAdapter
    {
      code: "import { SpotifyAdapter } from '../adapters/spotify/SpotifyAdapter';",
      filename: '/project/src/components/Something.ts',
      errors: [
        {
          message:
            'Do not import from src/adapters/spotify/ outside src/adapters/ — use the MusicPlatformAdapter interface instead.',
        },
      ],
    },
    // A store importing spotifyFetch directly
    {
      code: "import { spotifyFetch } from '../../adapters/spotify/spotifyFetch';",
      filename: '/project/src/stores/authStore.ts',
      errors: [
        {
          message:
            'Do not import from src/adapters/spotify/ outside src/adapters/ — use the MusicPlatformAdapter interface instead.',
        },
      ],
    },
  ],
});
