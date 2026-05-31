/**
 * Shared runtime configuration.
 *
 * BACKEND_URL is the base URL of the Express backend. It is defined here once so
 * every caller agrees on the same value — previously each screen redeclared its
 * own default and they disagreed (3000 vs 3001), so a missing env var silently
 * broke whichever screens used the wrong port. The default matches the backend's
 * own default port (see backend/src/index.ts: `PORT ?? 3000`).
 */
export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';
