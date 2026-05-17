---
title: Multi-Destination Playlists
date: 2026-05-15
context: Exploration session — destination playlist design
---

## Core Design

Destination is multi-select — a liked or super liked track is written to **all currently active destination playlists** simultaneously. `PlaylistWriter` fires `addToPlaylist()` for each destination in parallel.

Primary categorization strategy is **assign later in Matches** — no interruption to the swipe flow on each like.

## Mid-Session Destination Editor

A secondary control (not part of the main button bar — positioned at the top of the swipe screen, e.g., a small edit icon). Tapping it opens a destination picker with three scope options:

| Scope | Behavior |
|-------|----------|
| **This track** | Override this track's destinations before swiping — one-off, doesn't change session default |
| **From now on** | Changes the session's active destination list for all future likes |
| **Entire session** | Retroactively applies to all tracks liked so far this session (see below) |

### Retroactive "Entire Session" Logic

- **Adding a playlist**: silently adds all session-liked tracks to the new playlist. No prompt — non-destructive.
- **Removing a playlist**: prompts "Remove these X tracks from [playlist name]?" before acting. Prompt only fires on removal because that's the only destructive action.

## Data Model Implications

The current plan assumes a single destination per swipe. This changes to a list:

- Each liked track must record **which playlists it was actually written to** (not just a single destination ID). The active destination list at the moment of the swipe is captured per-track, since "this track" overrides can differ from the session default.
- The `matches` table (or a join table) needs a `destination_playlists: string[]` column per swipe record.
- Retroactive adds/removes require querying all swipe records for the current session.

## Relationship to Regret Flow

The existing regret/move flow in Matches (Phase 3) handles post-session reassignment. The mid-session editor is for users who want to correct their destination setup while still swiping — not a replacement for the Matches-level editing.
