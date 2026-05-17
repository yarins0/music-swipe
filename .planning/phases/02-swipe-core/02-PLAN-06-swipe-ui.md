---
id: 02-PLAN-06
title: SwipeEngine + SwipeCard + ButtonBar + DestinationEditor
wave: 3
depends_on:
  - 02-PLAN-02
  - 02-PLAN-04
  - 02-PLAN-05
files_modified:
  - src/swipe/SwipeEngine.tsx
  - src/swipe/SwipeCard.tsx
  - src/swipe/ButtonBar.tsx
  - src/swipe/DestinationEditor.tsx
autonomous: true
requirements_addressed:
  - REQ-002
  - REQ-005
  - REQ-006
---

# Plan 06: Swipe UI Components

## Objective

Build the four swipe UI components: `SwipeEngine` (card stack + gesture orchestrator), `SwipeCard` (single card visual), `ButtonBar` (five-button action row), and `DestinationEditor` (mid-session destination modal). These consume all the services and hooks from Waves 1 and 2.

Purpose: This is the visual heart of the app. The swipe screen (Plan 07) wraps SwipeEngine — it does not contain any swipe logic itself.

Output: Four component files under `src/swipe/`.

## Interfaces

From previous plans (do not re-read files — use these extracted contracts):

```typescript
// src/stores/swipeStore.ts
useSwipeStore() returns:
  queue: Track[]
  currentIndex: number
  activeDestinationIds: string[]
  undoStack: SwipeRecord[]
  recordSwipe(track, status, destinationIds): void
  undo(): SwipeRecord | null
  setActiveDestinations(ids): void

// src/swipe/useSwipeGesture.ts
useSwipeGesture(onSwipe: (direction: SwipeDirection) => void):
  { gesture: Pan gesture, animatedStyle, resetCard(): void }
type SwipeDirection = 'left' | 'right' | 'up'

// src/services/PlaylistWriter.ts
class PlaylistWriter
  write(trackId: string, destinationIds: string[]): void
  superLike(trackId: string, destinationIds: string[]): void

// src/services/SessionTracker.ts
class SessionTracker
  incrementCounts(sessionId, { swiped, liked, superLiked }): void

// src/services/BackendSync.ts
class BackendSync
  postSwipe(payload: SwipePayload): void

// src/player/TrackPlayer.ts
class TrackPlayer
  play(track: Track): Promise<PlaybackResult>
  pause(): Promise<void>
  seekTo(positionMs: number): Promise<void>
  getCurrentPositionMs(): Promise<number>

// src/adapters/interface.ts
interface Track { id, uri, title, artist, albumArtUrl, durationMs, previewUrl: string|null }
```

## Tasks

<task id="T02-06-1">
<title>Task 1: SwipeCard + ButtonBar components</title>

<read_first>
- src/adapters/interface.ts (Track interface shape — card displays title, artist, albumArtUrl; previewUrl for null check)
- .planning/phases/02-swipe-core/02-RESEARCH.md (Code Examples — Card Stack 2-card render approach; Pitfall 4 — null previewUrl must show "No preview" label, not crash)
- .planning/notes/button-bar-gesture-design.md (Button layout: Undo / Skip / SuperLike / Like / DecideLater; gesture mapping table)
- src/player/SegmentNavigator.tsx (SegmentNavigator props — SwipeCard embeds it for tap-to-seek)
- CLAUDE.md (component rules: max ~150 lines, explicit prop interfaces)
</read_first>

<action>
Create src/swipe/SwipeCard.tsx.

Props interface:
```typescript
interface SwipeCardProps {
  track: Track;
  onSeekBack: () => void;
  onSeekForward: () => void;
  isSeekEnabled: boolean;  // false when no active playback
}
```

Layout (using StyleSheet, no third-party UI library):
- Full-width, tall card with rounded corners (borderRadius: 16)
- Album art fills the top ~70% of the card using expo-image (already installed)
- Track title (bold, large) and artist name stacked at the bottom of the card on a semi-transparent overlay
- If track.previewUrl is null AND playback strategy is unknown (card doesn't know): show a small "No full preview" label in the corner — the card receives isSeekEnabled=false in this state and the label appears whenever isSeekEnabled is false
- SegmentNavigator overlays the album art area for tap-to-seek; disabled={!isSeekEnabled}
- Do not use any Spotify-specific component or string — albumArtUrl is a generic URL from the Track interface

Create src/swipe/ButtonBar.tsx.

Props interface:
```typescript
interface ButtonBarProps {
  onSkip: () => void;
  onLike: () => void;
  onSuperLike: () => void;
  onDecideLater: () => void;
  onUndo: () => void;
  canUndo: boolean;       // false when undoStack is empty
  isDecideLaterEnabled: boolean;  // always true for now; reserved for queue-end state
}
```

Layout: five buttons in a horizontal row, centered, with generous tap targets (min 48x48 touchable area). Left to right: Undo (↩) / Skip (✕) / SuperLike (⭐) / Like (♥) / DecideLater (⏱). Undo button is dimmed (opacity: 0.3) and disabled when canUndo is false. Use Pressable for all buttons.

Do not implement gesture logic in ButtonBar — it calls the provided callbacks only. The caller (SwipeEngine) maps these callbacks to swipe actions.
</action>

<acceptance_criteria>
- src/swipe/SwipeCard.tsx exists; props interface has track, onSeekBack, onSeekForward, isSeekEnabled
- src/swipe/ButtonBar.tsx exists; props interface has all five callbacks plus canUndo and isDecideLaterEnabled
- No import from src/adapters/spotify/ in either file
- No Spotify-specific string literals or type names in either file
- `npx tsc --noEmit` exits 0
- `npx expo lint` exits 0
</acceptance_criteria>
</task>

<task id="T02-06-2">
<title>Task 2: SwipeEngine (card stack orchestrator) + DestinationEditor modal</title>

<read_first>
- src/swipe/SwipeCard.tsx (just created — props interface for embedding in SwipeEngine)
- src/swipe/ButtonBar.tsx (just created — props interface for embedding in SwipeEngine)
- src/swipe/useSwipeGesture.ts (gesture hook return shape: { gesture, animatedStyle, resetCard })
- src/stores/swipeStore.ts (useSwipeStore — all state and actions SwipeEngine needs)
- src/services/PlaylistWriter.ts (write() and superLike() — called from swipe handler)
- src/services/SessionTracker.ts (incrementCounts() — called from swipe handler)
- src/services/BackendSync.ts (postSwipe() — called from swipe handler)
- src/player/TrackPlayer.ts (play/pause/seekTo — called for track transitions)
- .planning/phases/02-swipe-core/02-RESEARCH.md (Pattern 1 — 2-card render approach with GestureDetector; Pitfall 2 — runOnJS; Pitfall 3 — isAnimating guard; Pattern 5 — swipe handler pattern; Pitfall 6 — super like destination snapshot timing)
- .planning/notes/multi-destination-playlists.md (mid-session editor three scopes: this-track, from-now-on, entire-session; retroactive add/remove behavior)
- CLAUDE.md (architectural rules — swipe events local-first; never await PlaylistWriter; never call Spotify directly)
</read_first>

<action>
Create src/swipe/SwipeEngine.tsx.

Props interface:
```typescript
interface SwipeEngineProps {
  trackPlayer: TrackPlayer;
  playlistWriter: PlaylistWriter;
  sessionTracker: SessionTracker;
  backendSync: BackendSync;
  sessionId: string;
  onSessionEnd: () => void;  // called when queue is exhausted
}
```

Internal state (in addition to useSwipeStore):
- currentPlaybackStrategy: 'connect' | 'preview' | 'none' (from TrackPlayer.play result)
- currentPositionMs: number (polled or from TrackPlayer.getCurrentPositionMs)

Render structure:
```
<View style={{ flex: 1 }}>
  {/* Card stack */}
  <View style={styles.cardStack}>
    {nextTrack && <SwipeCard track={nextTrack} ... />}     // z-index lower
    {currentTrack && (
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.currentCard, animatedStyle]}>
          <SwipeCard track={currentTrack} ... />
        </Animated.View>
      </GestureDetector>
    )}
  </View>

  {/* ButtonBar */}
  <ButtonBar ... />

  {/* Destination editor trigger */}
  <Pressable onPress={() => setShowDestEditor(true)}>
    {/* small edit icon */}
  </Pressable>

  {/* DestinationEditor modal */}
  {showDestEditor && <DestinationEditor ... />}
</View>
```

handleSwipe(direction: SwipeDirection):
1. Compute status: 'right' → 'liked', 'up' → 'super_liked', 'left' → 'skipped'
2. Read effective destinations at call time: check per-track override first (from local state), else activeDestinationIds from store
3. Call recordSwipe(track, status, effectiveDestinations) — synchronous, updates local state immediately
4. If status === 'liked': playlistWriter.write(track.id, effectiveDestinations) — do NOT await
5. If status === 'super_liked': playlistWriter.superLike(track.id, effectiveDestinations) — do NOT await
6. sessionTracker.incrementCounts(sessionId, { swiped: 1, liked: status === 'liked' ? 1 : 0, superLiked: status === 'super_liked' ? 1 : 0 }) — do NOT await
7. backendSync.postSwipe({ sessionId, trackId: track.id, status, destinationPlaylistIds: effectiveDestinations, swipedAt: new Date().toISOString() })
8. Clear per-track override (reset to session default)
9. Call resetCard() on the gesture hook
10. Start playing the next track: trackPlayer.play(queue[currentIndex + 1]) — do NOT await; handle PlaybackResult to update currentPlaybackStrategy

handleDecideLater():
1. recordSwipe(track, 'pending', []) — pending tracks have no destinations
2. backendSync.postSwipe with status: 'pending', destinationPlaylistIds: []
3. sessionTracker.incrementCounts(sessionId, { swiped: 1 })
4. resetCard()

handleUndo():
1. Call undo() from store → returns SwipeRecord or null
2. If null: no-op
3. If record had status 'liked' or 'super_liked': fire PlaylistWriter to remove (call adapter.removeFromPlaylist via a new path — for v1, log a warning "Undo playlist removal not yet implemented" rather than blocking undo). Undo still completes.
4. resetCard()

Track transition on card advance:
- When currentIndex changes, call trackPlayer.play(queue[currentIndex]) — update currentPlaybackStrategy from result
- seekBack: trackPlayer.getCurrentPositionMs() then trackPlayer.seekTo(Math.max(0, pos - 20000))
- seekForward: trackPlayer.getCurrentPositionMs() then trackPlayer.seekTo(pos + 20000)

When queue is exhausted (currentIndex >= queue.length): call onSessionEnd()

---

Create src/swipe/DestinationEditor.tsx.

Props interface:
```typescript
interface DestinationEditorProps {
  availablePlaylists: Playlist[];       // user's owned playlists to choose from
  sessionDestinationIds: string[];      // current session default
  perTrackOverrideIds: string[] | null; // null means "no per-track override active"
  onClose: () => void;
  onThisTrack: (playlistIds: string[]) => void;   // sets per-track override only
  onFromNowOn: (playlistIds: string[]) => void;   // updates session default in store
  onEntireSession: (                              // retroactive change
    added: string[],
    removed: string[],
    confirmedRemove: boolean,
  ) => void;
}
```

Internal state: selectedIds (string[]) initialized from perTrackOverrideIds ?? sessionDestinationIds; activeScope ('this-track' | 'from-now-on' | 'entire-session').

Render as a Modal (React Native's built-in Modal with transparent backdrop):
- Three scope selector buttons at the top (radio-button style)
- Scrollable checkbox list of availablePlaylists
- "Confirm" button at the bottom
- When activeScope is 'entire-session' and removed.length > 0: show confirmation section "Remove X tracks from [playlist names]?" with "Yes, remove" and "Cancel" options before firing onEntireSession

Confirm button logic:
- 'this-track': call onThisTrack(selectedIds); close
- 'from-now-on': call onFromNowOn(selectedIds); close
- 'entire-session': compute added = selectedIds - sessionDestinationIds, removed = sessionDestinationIds - selectedIds; if removed.length > 0 and confirmedRemove is false, show confirmation UI; else call onEntireSession(added, removed, true); close

The parent (SwipeEngine) is responsible for executing the actual batch add/remove via PlaylistWriter and BackendSync. DestinationEditor only communicates intent via callbacks.
</action>

<acceptance_criteria>
- src/swipe/SwipeEngine.tsx exists; props interface has trackPlayer, playlistWriter, sessionTracker, backendSync, sessionId, onSessionEnd
- handleSwipe does not await PlaylistWriter calls (confirmed by reading the implementation)
- The current track's effective destinations are captured before calling recordSwipe (per-track override → session default) — Pitfall 6 fix
- Per-track override is cleared after each swipe
- src/swipe/DestinationEditor.tsx exists; all three scopes (this-track, from-now-on, entire-session) are handled
- Removal in "entire-session" scope shows a confirmation before firing onEntireSession
- No import from src/adapters/spotify/ in any new file
- `npx tsc --noEmit` exits 0
- `npx expo lint` exits 0
</acceptance_criteria>
</task>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| User gesture/button tap → SwipeEngine | User input drives swipe actions |
| SwipeEngine → Services (PlaylistWriter, SessionTracker, BackendSync) | Fire-and-forget calls; failures never surface to UI |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-06-01 | Tampering | DestinationEditor — "Entire session" retroactive add | accept | Addition is non-destructive; silently adds all liked tracks to new playlist. No server-side side-effects other than adapter.addToPlaylist calls (authenticated via token in adapter auth context) |
| T-02-06-02 | Tampering | DestinationEditor — "Entire session" retroactive remove | mitigate | Destructive action gated behind explicit in-modal confirmation ("Yes, remove"). User must confirm before onEntireSession fires with confirmed=true |
| T-02-06-03 | Information Disclosure | SwipeEngine — Spotify-specific code | mitigate | No Spotify imports in any swipe/ file; adapter boundary enforced by ESLint rule from Phase 1 |
</threat_model>

<verification>
- `npx tsc --noEmit` exits 0
- `npx expo lint` exits 0
- Grep confirms no import from 'adapters/spotify' in src/swipe/:
  `grep -r "adapters/spotify" src/swipe/` returns no results
</verification>

<success_criteria>
- SwipeEngine orchestrates gestures, button presses, track playback, and fire-and-forget service calls
- Every swipe records local state first, then fires services — card advance never waits for any service call
- DestinationEditor handles all three scope modes including the destructive-remove confirmation
</success_criteria>

<output>
Create `.planning/phases/02-swipe-core/02-06-SUMMARY.md` when done
</output>
