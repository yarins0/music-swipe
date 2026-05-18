---
phase: 1
slug: auth-interface-design-skeleton
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-17
---

# Phase 1 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Mobile ↔ Spotify OAuth | Expo AuthSession PKCE flow to Spotify accounts.spotify.com | Authorization code, access token, refresh token |
| Mobile ↔ Backend | HTTPS POST /auth/register after PKCE completes | Spotify access token (transit only, never stored) |
| Backend ↔ Spotify API | Backend calls api.spotify.com/v1/me to verify token | Spotify user ID, display name, email |
| Backend ↔ Supabase | Supabase service-role client for user management and JWT issuance | User identity, Supabase JWT |
| Device SecureStore | Expo SecureStore (iOS Keychain / Android Keystore) stores all tokens | Spotify access/refresh tokens, Supabase JWT |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T01-S | Spoofing | `POST /auth/register` | Mitigate | Backend calls `GET /me` on Spotify to verify token authenticity before any account operation | closed |
| T02-S | Spoofing | `requireAuth` middleware | Mitigate | `supabase.auth.getUser(token)` performs server-side JWT signature + expiry verification | closed |
| T03-S | Spoofing — PKCE interception | `useSpotifyAuth.ts` | Mitigate | `usePKCE: true` in `useAuthRequest` — authorization code is worthless without the code_verifier held only by the requesting app | closed |
| T04-T | Tampering — backend URL | `EXPO_PUBLIC_BACKEND_URL` | Mitigate | Variable is baked at EAS build time for production builds; runtime mutation not possible in a published binary | closed |
| T05-T | Tampering — register body | `/auth/register` body | Accept | By design: account is created for whoever owns the provided Spotify token. No target-user impersonation possible. | closed |
| T06-R | Repudiation — audit trail | Registration flow | Accept | AR-01 — see Accepted Risks Log | closed |
| T07-I | Info Disclosure — Spotify token in logs | `backend/src/routes/auth.ts` | Mitigate | Token passed only to `getSpotifyUser()`; no logging of request body; token discarded after `/me` call | closed |
| T08-I | Info Disclosure — error verbosity | `backend/src/index.ts` | Mitigate | Global error handler returns `{ error: 'Internal server error' }` with no stack trace; all route handlers return sanitized messages | closed |
| T09-I | Info Disclosure — token storage | `src/stores/authStore.ts` | Mitigate | `expo-secure-store` backed by iOS Keychain and Android Keystore; not readable without device unlock | closed |
| T10-I | Info Disclosure — weak KDF | `backend/src/routes/auth.ts:deriveUserPassword()` | Mitigate | **FIXED 2026-05-17**: Replaced SHA-256 with HKDF-SHA256 (`hkdfSync`); proper extract-then-expand with static app salt and per-user info context | closed |
| T11-D | Denial of Service — no rate limit | `POST /auth/register` | Mitigate | **FIXED 2026-05-17**: `express-rate-limit` applied — 10 requests per IP per 15-minute window; standard headers returned | closed |
| T12-D | Denial of Service — Supabase per-request | `requireAuth` middleware | Accept | AR-02 — see Accepted Risks Log | closed |
| T13-E | Elevation of Privilege — req.userId forgery | `requireAuth` middleware | Mitigate | `req.userId` set from Supabase server-side verification result, never from client-supplied JWT payload | closed |
| T14-E | Elevation of Privilege — CORS | `backend/src/index.ts` | Mitigate | CORS configured with explicit `allowedOrigins` from `ALLOWED_ORIGINS` env var; no wildcard | closed |
| T15-E | Elevation of Privilege — adapter boundary | ESLint rule | Mitigate | `no-spotify-outside-adapters` ESLint rule blocks direct `src/adapters/spotify/` imports from outside the boundary at lint time | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T06-R | Phase 1 MVP — no user-facing audit requirement. Access logging deferred to Phase 5 (Hardening & Launch). Server error paths log via `console.error`; success paths have no structured audit trail. | gsd-secure-phase | 2026-05-17 |
| AR-02 | T12-D | Supabase availability and per-request verification latency are third-party concerns. Circuit breakers, caching, and availability SLAs deferred to Phase 5 (Hardening & Launch). | gsd-secure-phase | 2026-05-17 |

---

## Code Changes

| Change | File | Commit |
|--------|------|--------|
| T10-I: SHA-256 → HKDF-SHA256 in `deriveUserPassword()` | `backend/src/routes/auth.ts` | 2026-05-17 |
| T11-D: Added `express-rate-limit` (10 req / 15 min / IP) to `POST /auth/register` | `backend/src/routes/auth.ts`, `backend/package.json` | 2026-05-17 |

> **Key rotation note**: changing `SUPABASE_SERVICE_ROLE_KEY` invalidates all HKDF-derived user passwords. Treat key rotation as a breaking migration requiring re-registration for all existing users.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-17 | 15 | 15 | 0 | /gsd:secure-phase 1 (retroactive-STRIDE) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-17
