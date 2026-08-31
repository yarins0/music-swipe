## Agent Registry
<!-- Never delete entries from this table. Add a row when a new agent is created. -->

| Agent | Description | Owns | Highest ID used |
|-------|-------------|------|-----------------|
| A | Settings / Prefs domain | `src/stores/prefsStore.ts`, `app/(tabs)/settings.tsx`, `app/(tabs)/privacy-policy.tsx`, `app/(tabs)/terms-of-service.tsx`, `app/(tabs)/contact.tsx` | A5 |
| B | Swipe card UI & gesture | `src/swipe/SwipeCard.tsx`, `src/swipe/SwipeEngine.tsx`, `src/swipe/useSwipeGesture.ts`, `src/components/TabHeader.tsx` | B3 |
| C | Preview player integration | `app/(tabs)/swipe/[playlistId].tsx`, `src/player/usePreviewPlayer.ts`, `src/player/TrackPlayer.ts` | C1 |
| D | Filter mode feature | `app/(tabs)/destination.tsx`, `src/stores/sessionStore.ts`, `src/swipe/SwipeEngine.tsx`, `src/swipe/ButtonBar.tsx`, `app/(tabs)/session-end.tsx` | D4 |
| Q | Manual QA — testing only | n/a | Q4 |

---

## Agent A — Settings / Prefs

## Agent B — Swipe Card UI & Gesture

## Agent C — Preview Player

## C1 · Wire auto-play previews end-to-end

**What:** When "Auto-play Previews" is on, automatically start the 30-second preview via `usePreviewPlayer` when the Spotify adapter fails for the current track. Pause and reset the preview player on every swipe so the next card starts fresh.

**Why:** `usePreviewPlayer` is already called in `swipe/[playlistId].tsx` (line 60) but its return value is discarded — nothing ever calls `player.play()`. `TrackPlayer` already fires `setPreviewUrl` (its `onPreviewRequired` callback) when the adapter fails and a preview URL exists, but the audio never starts.

**What to change:**
- `app/(tabs)/swipe/[playlistId].tsx`:
  - Capture the return value: `const previewPlayer = usePreviewPlayer(previewUrl)`.
  - Add a `useEffect([previewUrl])`: when `previewUrl` is non-null and `autoPlayPreviews` pref is on, call `previewPlayer.play()`.
  - When `autoPlayPreviews` is off, pass `null` instead of `setPreviewUrl` to the `TrackPlayer` constructor so the adapter-failure preview path is fully skipped: `new TrackPlayer(adapter, autoPlayPreviews ? setPreviewUrl : null)`.
  - On every card swipe (hook into `handleSessionEnd` or expose a prop from `SwipeEngine`): call `previewPlayer.pause()` and `setPreviewUrl(null)` to stop the preview and reset for the next track.
- Note: `expo-audio` (`~0.3.5`) is already installed. The hook guards against Expo Go (native module unavailable) via its try/require pattern.

**Effort:** M
**Priority:** P1
**Depends on:** A1

---

## Agent D — Filter Mode

## D1 · Filter mode detection + destination picker guard

**What:** When the user selects the source playlist as a destination in `destination.tsx`, clear all other selections, lock the picker to source-only, and display an `AppModal` warning before navigating to the swipe screen. Add `isFilterMode: boolean` and `setFilterMode(value: boolean)` to `sessionStore`. Set it to `true` only after explicit confirmation.

**Why:** Without a guard, the user could accidentally enter filter mode (deleting tracks) believing it was a normal session. The confirmation modal makes the destructive semantics explicit.

**What to change:**
- `src/stores/sessionStore.ts`: add `isFilterMode: boolean` (default `false`) and `setFilterMode(value: boolean)` action. Add `clearSession()` call to reset it alongside the existing fields.
- `app/(tabs)/destination.tsx`: in `handleToggle`, when the toggled ID equals `playlistId` (the source) and it's being added: call `setSelectedIds(new Set([playlistId]))` (clears others, locks to source). Show a filter mode banner/chip below the search bar while source is selected ("Filter Mode — left swipe will delete from this playlist"). In `handleConfirm`: if source is in `selectedIds`, show a `AppModal` explaining the semantics ("You're entering Filter Mode. Swipe LEFT to delete tracks, swipe RIGHT to keep them. This is permanent."). On modal confirm: `setIsFilterMode(true)` then navigate. On cancel: do nothing.
- Import `AppModal` and `useSessionStore` in destination.tsx.

**Effort:** M
**Priority:** P0

---

## D2 · SwipeEngine: filter mode reverse semantics + undo

**What:** When `isFilterMode` is true, swipe LEFT calls `adapter.removeFromPlaylist(sourcePlaylistId, trackId)` directly and skips `playlistWriter`. Swipe RIGHT/UP skip all `playlistWriter` calls (track stays in place). Undo of a filter-mode left swipe re-adds the track via `playlistWriter.write()`.

**Why:** The swipe engine currently always calls `playlistWriter.write()` on a like and does nothing to the playlist on a skip. Filter mode inverts this: left = destructive delete, right = no-op (keep).

**What to change:**
- `src/swipe/SwipeEngine.tsx`:
  - Read `isFilterMode` and `sourcePlaylistId` from `useSessionStore`.
  - In `handleSwipe`: gate all `playlistWriter.write()` / `playlistWriter.superLike()` calls behind `!isFilterMode`. When `isFilterMode && status === 'skipped'`: call `void adapterRef.removeFromPlaylist(sourcePlaylistId, currentTrack.id)` (fire-and-forget with a logged catch — same pattern as the bulk-remove flow). Note: `SwipeEngine` receives `trackPlayer` but not the adapter directly — pass `adapter` as a new prop from `swipe/[playlistId].tsx` (which already holds `adapterRef.current`), typed as `MusicPlatformAdapter`.
  - In `handleUndo`: when `isFilterMode && record.status === 'skipped'`: call `playlistWriter.write(record.track.id, [sourcePlaylistId])` to re-add. When `isFilterMode && (record.status === 'liked' || record.status === 'super_liked')`: no-op (nothing was written).
  - Normal mode undo logic is unchanged.

**Effort:** M
**Priority:** P0
**Depends on:** D1

---

## D3 · ButtonBar filter mode labels

**What:** When `isFilterMode` is true, the skip (left) button on the `ButtonBar` shows a red delete icon/label instead of the neutral skip icon, so the destructive action is visually distinct.

**Why:** In normal mode, the left button means "skip" — neutral. In filter mode it means "delete from playlist" — irreversible. The visual difference prevents accidental deletions.

**What to change:**
- `src/swipe/ButtonBar.tsx`: add an `isFilterMode?: boolean` prop. When true, change the skip button's icon to `Ionicons trash-outline` (or similar) in `colors.nope` (red). Optionally show a small "DELETE" label beneath it. All other buttons unchanged.
- `src/swipe/SwipeEngine.tsx`: pass `isFilterMode` to `<ButtonBar>`.

**Effort:** S
**Priority:** P1
**Depends on:** D1

---

## D4 · Session-end screen: filter mode summary

**What:** When `isFilterMode` is true, relabel the session-end stats ("KEPT" / "DELETED" instead of "ADDED" / "DISCARDED"), retitle the liked tracks section to "Tracks You Kept", hide the "Save as Playlist" CTA (the source IS the playlist), and update the hero subtitle.

**Why:** The existing session-end screen describes curation into new playlists. In filter mode the user was culling an existing playlist — the framing is entirely different and the "save as playlist" action is redundant/confusing.

**What to change:**
- `app/(tabs)/session-end.tsx`:
  - Read `isFilterMode` from `useSessionStore`.
  - Stats row: when filter mode, `addedCount` label → "TRACKS KEPT", `discardedCount` label → "TRACKS DELETED".
  - Hero subtitle: "You've finished filtering. Here's what you decided to keep and delete."
  - "Your Liked Tracks" section title → "Tracks You Kept" (these are the right-swiped 'liked'/'super_liked' records).
  - Remove the per-track `✕` remove button when filter mode (re-deleting a kept track from the end screen is too confusing).
  - Hide the "Save as Playlist" `Pressable` when filter mode.

**Effort:** S
**Priority:** P1
**Depends on:** D1

---

## Agent Q — Manual QA (testing only)

> Owns: n/a — these are manual verification steps, not automatable tasks.

## Q3 · Preview Player QA

**What:** Verify auto-play previews trigger, stop on swipe, and respect the pref toggle.

**Checks:**
[] "Auto-play Previews" on + no active device → 30s preview plays automatically when adapter fails  - RESULT: I dont know what that means, is that what causes the first track to not play?
TODO: incostitant behavior - try solving by adding an reconnect spotify buttron under the setting swith which will open spotify in the background, also clicking pn "No Previe" on swipe screen should send the use to this setting (have the setting blink twice when opened)
[x] Swipe to next track → previous preview stops, no audio bleed from prior track
[] "Auto-play Previews" off → no audio plays even when adapter fails
ISSUE : at first it does - than when turned on it starts working - turned off again it still works
[] "Auto-play Previews" off → `previewUrl` state never gets set during a session
ISSUE: cant really test that mabually - add a log
[] Queue exhausted and session ends → no lingering preview audio
ISSUE: music continues
[x] Undo (step back to previous card) → preview resets cleanly, no double-play or stale audio

**Effort:** S
**Priority:** P1

---

## Q4 · Filter Mode QA

**What:** Verify the full filter mode flow — selection lock, confirmation modal, swipe semantics, undo, and session-end screen.

**Checks:**
[x] Destination screen: tap source playlist → all other selections clear, only source checked, red "Filter Mode — left swipe will delete from this playlist" banner appears
[x] With source selected, tap "Start Swiping" → filter mode confirmation modal appears with destructive red confirm button and permanent-deletion warning
[x] Cancel modal → no navigation occurs, selection unchanged
[x] Confirm modal → swipe screen opens, skip button shows red trash icon + "DELETE" label instead of ✕
[x] Filter mode: swipe left → track removed from source playlist in Spotify (verify in Spotify app)
[x] Filter mode: swipe right → nothing written, track stays in playlist
[] Filter mode: undo a left swipe → track re-added to source playlist
ISSUES: undo doesnt work - doesnt restore anything - for both a regular platlists and liked
ISSUE: super like doesnt do anything
[x] Session-end after filter mode: "TRACKS KEPT"/"TRACKS DELETED" labels, "Tracks You Kept" title, no per-track remove buttons, no "Save as Playlist" CTA
[x] Normal session (non-filter): skip button shows ✕, labels read "ADDED TO PLAYLISTS"/"DISCARDED", remove buttons present, "Save as Playlist" visible
[x] New session started after filter mode: `isFilterMode` reset — no banner on destination picker, normal ✕ skip button in swipe screen

**Effort:** M
**Priority:** P0

---

# Done ✅

## Q1 · Settings & Prefs QA
**What:** Verify persisted prefs, new screens, and contact rows work correctly in the running app.
**Completed:** 2026-05-30
**Summary:** All pref toggles persist across app restarts. Privacy Policy, Terms of Service, and Contact screens open and navigate correctly. Navbar highlight on settings sub-routes (contact, privacy, terms) is a known routing quirk; deferred.

---

## Q2 · Swipe Card UI QA
**What:** Verify album art toggle, haptics, back-card animation, and header pencil button.
**Completed:** 2026-05-30
**Summary:** Album art toggle, haptics, and no-art icon card all verified. Back-card scale animation works during drag; post-release bounce-back lag is acceptable and deferred. DestinationEditor button removed from header (modal was invisible — feature disabled rather than debugged; code preserved).

---

## B1 · Wire showAlbumArt pref to SwipeCard
**What:** When "Show Album Art" is off, replace the full-bleed image with a solid background and centered musical-note icon.
**Completed:** 2026-05-30
**Summary:** Added `showAlbumArt` prop to `SwipeCard`; renders `Ionicons musical-note` on `surfaceContainerHigh` background when off. `SwipeEngine` reads pref from `usePrefsStore` and passes it to both card instances.

---

## B2 · Haptic feedback on swipe + next-card scale animation
**What:** Fire a haptic impact on swipe commit; animate back card scale/opacity proportionally during drag.
**Completed:** 2026-05-30
**Summary:** Added `onHaptic` callback to `useSwipeGesture`, wired to `expo-haptics` in `SwipeEngine` behind `hapticFeedback` pref. Back card animates scale 0.97→1.0 and opacity 0.6→1.0 proportional to drag via `dragProgress` shared value.

---

## B3 · Move destination editor button to swipe header
**What:** Add `rightAction` prop to `TabHeader` and move the pencil button into the header's right slot.
**Completed:** 2026-05-30
**Summary:** `TabHeader` updated to 3-column layout with `rightAction` slot. Button was moved to header; later removed when `DestinationEditor` was disabled. `TabHeader` layout changes preserved.

---

## A1 · Persisted prefs store + wire settings.tsx
**What:** Create a Zustand + AsyncStorage prefs store and replace `useState` toggles in settings with store reads/writes.
**Completed:** 2026-05-27
**Summary:** Created `src/stores/prefsStore.ts` with `showAlbumArt`, `autoPlayPreviews`, `hapticFeedback`, `weeklyReminders`. Replaced all five `useState` prefs in `settings.tsx` with `usePrefsStore` selectors and actions.

---

## A2 · Remove Spotify Sync toggle
**What:** Delete the "Spotify Sync" toggle and its backing state from `settings.tsx`.
**Completed:** 2026-05-27
**Summary:** Deleted `spotifySync` state and `<ToggleRow label="Spotify Sync" .../>`. MUSIC INTEGRATION section now contains only the Reconnect Service button.

---

## A3 · Dynamic version + GitHub releases link
**What:** Replace hardcoded version string with `expo-constants` and make the Version row open GitHub releases.
**Completed:** 2026-05-27
**Summary:** Removed `APP_VERSION` constant. Version row reads `Constants.expoConfig?.version` and opens the GitHub releases page in-app when tapped.

---

## A4 · Privacy Policy and Terms of Service screens
**What:** Replace "Coming Soon" alerts with real in-app scrollable screens for Privacy Policy and Terms of Service.
**Completed:** 2026-05-27
**Summary:** Created `app/(tabs)/settings/privacy-policy.tsx` and `terms-of-service.tsx` as scrollable screens. Routes placed under `/settings/*` so the Settings navbar tab stays active.

---

## A5 · Contact Me screen
**What:** Create a Contact screen with Send Feedback, Report a Bug, and View on GitHub rows.
**Completed:** 2026-05-27
**Summary:** Created `app/(tabs)/settings/contact.tsx`. Settings navigates to `/(tabs)/settings/contact`.
