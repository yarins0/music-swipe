---
title: Button Bar & Gesture Design
date: 2026-05-15
context: Exploration session — swipe mechanic refinement
---

## Button Bar Layout

Mirrors Tinder's button row. Left to right:

| Button | Icon | Action | Equivalent gesture |
|--------|------|--------|--------------------|
| Undo | ↩ | Go back to previous track | — |
| Skip | ✕ | Not interested — skips track | Swipe left |
| Super Like | ⭐ | Strong like | Swipe up |
| Like | ♥ | Standard like | Swipe right |
| Decide Later | ⏱ | Re-queue for later in session | — |

Tinder's "Boost" button position (far right) is repurposed as "Decide Later."

## Gesture Mapping

- **Swipe left** → Skip
- **Swipe right** → Like
- **Swipe up** → Super Like

No swipe-down action (reserved / not used). Tap zones (left/right halves of card) remain wired to `SegmentNavigator` for ±20s seeking — gesture directions are distinct from tap zones, so there is no conflict.

## Rationale

The button bar makes all actions discoverable without requiring gesture knowledge. Gestures are a power-user shortcut, not the only path. This mirrors how Tinder works and reduces the learning curve for new users.

Decide Later is button-only (no gesture) because there is no available swipe direction that wouldn't conflict with existing interactions.
