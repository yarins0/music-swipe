---
phase: 1
slug: auth-interface-design-skeleton
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-17
---

# Phase 1 — Validation Strategy

> Per-phase validation contract: automated test coverage for all Phase 1 behaviors.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (mobile)** | Jest 29 + jest-expo preset + @testing-library/react-native |
| **Config file (mobile)** | `package.json` → `"jest": { "preset": "jest-expo" }` |
| **Framework (backend)** | Jest 29 + ts-jest |
| **Config file (backend)** | `backend/jest.config.js` |
| **Quick run (mobile)** | `npx jest --watchAll=false` |
| **Quick run (backend)** | `cd backend && npm test` |
| **Full suite** | Both commands above |
| **Estimated runtime** | ~5–8 seconds combined |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --watchAll=false`
- **After every plan wave:** Run both mobile + backend suites
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~8 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Test File | Status |
|---------|------|------|-------------|------------|-----------|--------|
| T01-01 | 01 | 1 | SC-4 | T15-E | `src/adapters/__tests__/interface.test.ts` | ✅ green |
| T01-02 | 01 | 1 | SC-4 | T15-E | `src/adapters/__tests__/interface.test.ts` | ✅ green |
| T01-03 | 01 | 1 | SC-5 | T15-E | `eslint-rules/__tests__/no-spotify-outside-adapters.test.js` | ✅ green |
| T02-04 | 02 | 1 | SC-6 | T02-S | `backend/src/__tests__/middleware/auth.test.ts` | ✅ green |
| T03-01 | 03 | 2 | SC-4 | — | `src/adapters/__tests__/spotify/mappers.test.ts` | ✅ green |
| T03-02 | 03 | 2 | SC-1 | T03-S | `src/adapters/__tests__/spotify/spotifyFetch.test.ts` | ✅ green |
| T04-02 | 04 | 2 | SC-1 | T09-I | `src/__tests__/stores/authStore.test.ts` | ✅ green |
| T05-01 | 05 | 3 | SC-2/SC-3 | — | `src/__tests__/playlist/PlaylistResolver.test.ts` | ✅ green |
| T02-01 | 02 | 1 | SC-6 | — | Manual — see below | ⬜ manual |
| T02-02 | 02 | 1 | SC-6 | — | Manual — see below | ⬜ manual |
| T02-05 | 02 | 1 | SC-6 | T01-S | Manual — see below | ⬜ manual |
| T02-07 | 02 | 1 | SC-6 | T11-D | Manual — see below | ⬜ manual |
| T04-03 | 04 | 2 | SC-1 | T03-S | Manual — see below | ⬜ manual |
| T04-05 | 04 | 2 | SC-1 | — | Manual — see below | ⬜ manual |
| T05-05/T05-06 | 05 | 3 | SC-2/SC-3 | — | Manual — see below | ⬜ manual |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all automated phase requirements. All 7 test files generated and green on 2026-05-17.

**Test files created:**

| File | Covers |
|------|--------|
| `src/adapters/__tests__/interface.test.ts` | T01-01/T01-02: PlatformError, LIKED_SONGS_PLAYLIST_ID |
| `eslint-rules/__tests__/no-spotify-outside-adapters.test.js` | T01-03: Adapter boundary ESLint rule |
| `backend/src/__tests__/middleware/auth.test.ts` | T02-04: requireAuth JWT middleware |
| `src/adapters/__tests__/spotify/mappers.test.ts` | T03-01: mapSpotifyTrack, mapSpotifyPlaylist |
| `src/adapters/__tests__/spotify/spotifyFetch.test.ts` | T03-02: proactive/reactive refresh, error mapping |
| `src/__tests__/stores/authStore.test.ts` | T04-02: clearAuth, updateAccessToken |
| `src/__tests__/playlist/PlaylistResolver.test.ts` | T05-01: URL extraction, playlist sorting |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Backend npm install and build succeed | SC-6 | Requires Node.js environment | `cd backend && npm install && npm run build` |
| schema.sql applies cleanly to Supabase | SC-6 | Requires live PostgreSQL / Supabase project | Apply `backend/src/db/schema.sql` via Supabase dashboard or `psql` |
| POST /auth/register end-to-end (real Spotify token) | SC-6 | Requires real Spotify OAuth token | Complete login flow, POST token, verify supabaseToken returned |
| Express server starts and routes respond | SC-6 | Integration concern | `npm run dev`, `curl http://localhost:3000/users/me` → expect 401 |
| Full PKCE OAuth flow on device | SC-1 | Requires Expo device / simulator | `npx expo start`, tap Connect Spotify, complete OAuth, confirm redirect to home |
| Tokens persisted in SecureStore across app restart | SC-1 | Requires device | Complete login, kill app, reopen — confirm no re-login required |
| Source + destination picker screens render | SC-2/SC-3 | Requires Expo renderer | `npx expo start`, open on device, verify playlist list renders and multi-select works |

---

## Test Run Summary (2026-05-17)

| Suite | Tests | Passing | Failing |
|-------|-------|---------|---------|
| Mobile (jest-expo) | 53 | 53 | 0 |
| Backend (ts-jest) | 4 | 4 | 0 |
| **Total** | **57** | **57** | **0** |

---

## Validation Sign-Off

- [x] All automatable tasks have a test file
- [x] Sampling continuity: no 3+ consecutive tasks without automated verify
- [x] Manual-only items documented with explicit test instructions
- [x] No watch-mode flags in test commands
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** verified 2026-05-17
