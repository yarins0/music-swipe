---
title: End-of-Session Screen
date: 2026-05-15
context: Exploration session — post-swipe UX
---

## Purpose

The end screen is a celebratory payoff — a moment of satisfaction before the app gets out of the way. It appears after both the main swipe pass and the Decide Later second pass are complete.

## Layout

1. **Album art mosaic** — grid of all tracks liked and super liked in this session
2. **Headline** — "X tracks discovered" (or similar)
3. **Stats row:**
   - Swiped vs. liked ratio (e.g., "You liked 8 of 34")
   - Super like count highlighted separately
   - Top artist from session likes (computed client-side by counting artist occurrences in liked tracks — no extra API calls)
4. **Three CTAs (tiered):**
   - Primary: "Save as playlist" — creates a new playlist from this session's likes
   - Secondary: "View Matches" — opens the full Matches screen
   - Tertiary: "Swipe another playlist" — returns to playlist picker

## Notes

- "Top genre" is a stretch goal — Spotify returns genre at the artist level, not per-track, requiring extra API calls. Start with top artist only.
- The "Save as playlist" action requires `createPlaylist()` on the adapter (see REQ-003).
- Session data must be queryable to reconstruct which tracks were liked *in this session* specifically (not all-time matches). This drives the mosaic and the session playlist contents.
