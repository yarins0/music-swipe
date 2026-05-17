---
title: Decide Later — Session Persistence
date: 2026-05-15
context: Exploration session — swipe mechanic refinement
---

## Behavior

When a user taps "Decide Later" on a track:

1. Track is removed from the current card stack.
2. Track is added to an in-session "pending" queue.
3. At the end of the main playlist pass, the pending queue is presented as a second pass.
4. If the user still doesn't decide (likes, super likes, or skips) by session end, the track's status remains `pending` in the database.

## Cross-Session Persistence

On the next session for the same source playlist, `PlaylistResolver` pulls any `pending` tracks for that user+playlist pair and inserts them at the **front** of the queue. The user encounters their held tracks before the remaining unswiped tracks.

## Data Model Implication

The `swipes` table needs a four-value status enum:

```
liked | super_liked | skipped | pending
```

`pending` rows are never shown in the Matches screen. They only re-enter the swipe queue.

## Edge Cases to Handle

- If a `pending` track is removed from the source playlist between sessions, drop the pending record silently.
- If the source playlist is deleted, all pending records for it should be cleaned up.
- Pending tracks from a playlist the user no longer follows should not re-surface.
