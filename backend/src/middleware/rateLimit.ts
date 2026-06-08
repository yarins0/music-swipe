import rateLimit from 'express-rate-limit';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import type { Request } from 'express';

// Global throttle defaults. A single real client fires a small burst on session
// start (GET /sessions fans out to several Supabase queries), so the window is
// kept short and the cap generous — enough to absorb normal bursts while still
// stopping a runaway loop or abusive caller from hammering the database.
const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX = 100;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Collapses an IPv6 address to its /64 prefix so a single host can't bypass the
// limit by rotating the low 64 bits it controls. IPv4 and unknown values pass
// through unchanged.
function normaliseIp(ip: string): string {
  if (!ip.includes(':')) {
    return ip;
  }
  const segments = ip.split(':');
  return segments.slice(0, 4).join(':');
}

// Authenticated routes resolve req.userId in requireAuth, so per-user keying
// applies wherever userId is populated before this runs; everything else
// (unauthenticated routes, pre-auth requests) falls back to a normalised IP key.
function resolveClientKey(req: Request): string {
  return req.userId ?? normaliseIp(req.ip ?? '');
}

interface RateLimiterOptions {
  windowMs?: number;
  max?: number;
}

// Factory so tests can construct a limiter with a low cap without depending on
// process-wide env state.
export function createRateLimiter(options: RateLimiterOptions = {}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs ?? parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
    max: options.max ?? parsePositiveInt(process.env.RATE_LIMIT_MAX, DEFAULT_MAX),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: resolveClientKey,
    message: { error: 'Too many requests, please try again later' },
    // resolveClientKey already normalises the IP, so the library's built-in
    // IP validation (which assumes raw req.ip usage in the key) is redundant.
    validate: { ip: false },
  });
}

export const globalRateLimiter = createRateLimiter();
