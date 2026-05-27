## Agent Registry
<!-- Never delete entries from this table. Add a row when a new agent is created. -->

| Agent | Description | Owns | Highest ID used |
|-------|-------------|------|-----------------|
| A | Settings / Prefs domain | `src/stores/prefsStore.ts`, `app/(app)/settings.tsx`, `app/(app)/privacy-policy.tsx`, `app/(app)/terms-of-service.tsx`, `app/(app)/contact.tsx` | A5 |
| B | Swipe card UI & gesture | `src/swipe/SwipeCard.tsx`, `src/swipe/SwipeEngine.tsx`, `src/swipe/useSwipeGesture.ts`, `src/components/TabHeader.tsx` | B3 |
| C | Preview player integration | `app/(app)/swipe/[playlistId].tsx`, `src/player/usePreviewPlayer.ts`, `src/player/TrackPlayer.ts` | C1 |
| D | Filter mode feature | `app/(app)/destination.tsx`, `src/stores/sessionStore.ts`, `src/swipe/SwipeEngine.tsx`, `src/swipe/ButtonBar.tsx`, `app/(app)/session-end.tsx` | D4 |

---

## Agent A — Settings / Prefs

## A1 · Persisted prefs store + wire settings.tsx

**What:** Create `src/stores/prefsStore.ts` — a Zustand store with AsyncStorage persist middleware — holding all user preference flags. Replace the five `useState` calls in `settings.tsx` with reads/writes from this store so values survive app restarts.

**Why:** Every toggle currently resets on restart because they're local component state. The store is also the prerequisite for B1, B2, and C1, which need to read prefs at runtime.

**What to change:**
- Create `src/stores/prefsStore.ts`. Fields: `showAlbumArt: boolean` (default `true`), `autoPlayPreviews: boolean` (default `false`), `hapticFeedback: boolean` (default `true`), `weeklyReminders: boolean` (default `true`).
- Use `create` + `persist` from `zustand/middleware` with the `AsyncStorage` adapter (same pattern as `swipeStore`).
- In `app/(app)/settings.tsx`: replace `const [showAlbumArt, setShowAlbumArt] = useState(true)` etc. with `usePrefsStore` selector/action calls. Remove all five `useState` declarations for prefs.

**Effort:** S
**Priority:** P0

---

---

---

## A4 · Privacy Policy and Terms of Service screens

**What:** Replace the `handleComingSoon` Alert on both "Privacy Policy" and "Terms of Service" rows with navigation to real in-app screens. Create `app/(app)/privacy-policy.tsx` and `app/(app)/terms-of-service.tsx` as scrollable static-content screens with placeholder text formatted as section headers + paragraphs.

**Why:** The "Coming Soon" alert makes the app look unfinished and is a blocker for App Store submission (both documents are required).

**What to change:**
- Create `app/(app)/privacy-policy.tsx` and `app/(app)/terms-of-service.tsx`. Each is a full-screen `ScrollView` with a back button, the document title, and placeholder section text (e.g. "Data Collection", "Contact", "Governing Law"). Use the same header pattern as `destination.tsx` (`insets.top + 12`, back `←` button, centred title).
- `app/(app)/settings.tsx`: replace `handleComingSoon` calls on Privacy/ToS rows with `router.push('/(app)/privacy-policy')` and `router.push('/(app)/terms-of-service')`. Import `useRouter`.

**Effort:** S
**Priority:** P2

---

## A5 · Contact Me screen

**What:** Create `app/(app)/contact.tsx` — a simple screen with tappable action rows for emailing the developer, opening GitHub Issues, and (optionally) rating the app. Wire the ABOUT section "Contact" row in settings to navigate there.

**Why:** There is currently no way for users to reach out from inside the app. The settings screen has no contact entry at all.

**What to change:**
- Create `app/(app)/contact.tsx`. Rows (use `expo-web-browser` / `Linking`):
  - "Send Feedback" → `Linking.openURL('mailto:your@email.com?subject=MusicSwipe Feedback')`
  - "Report a Bug" → `WebBrowser.openBrowserAsync('https://github.com/yarins0/music-swipe/issues')`
  - "View on GitHub" → `WebBrowser.openBrowserAsync('https://github.com/yarins0/music-swipe')`
  - Use the same full-screen layout as the policy screens (back button, section card rows).
- `app/(app)/settings.tsx`: add a "Contact" `<LinkRow onPress={() => router.push('/(app)/contact')}>` inside the ABOUT section, above the Version row.

**Effort:** S
**Priority:** P2

---

## Agent B — Swipe Card UI & Gesture

## B1 · Wire showAlbumArt pref to SwipeCard

**What:** When the "Show Album Art" pref is off, replace the full-bleed `<Image>` in `SwipeCard` with a solid `colors.surfaceContainerHigh` background and a centered `Ionicons musical-note` icon. Track title and artist text overlays remain unchanged.

**Why:** The card currently always renders the album image unconditionally. There's no way for the user to get a distraction-free, icon-only card view even after toggling the setting.

**What to change:**
- `src/swipe/SwipeCard.tsx`: add a `showAlbumArt: boolean` prop (default `true`). Render the `<Image>` only when `showAlbumArt` is true; otherwise render a `<View style={styles.artPlaceholder}>` with a centered `<Ionicons name="musical-note" size={48} color={colors.onSurfaceVariant} />`.
- `src/swipe/SwipeEngine.tsx`: read `showAlbumArt` from `usePrefsStore` and pass it to both `<SwipeCard>` instances (current and next card).

**Effort:** S
**Priority:** P1
**Depends on:** A1

---

## B2 · Haptic feedback on swipe + next-card scale animation

**What:** Fire a haptic impact when a swipe commits. Animate the back card's scale (0.97 → 1.0) and opacity (0.6 → 1.0) proportionally as the top card is dragged, so the deck feels alive during the gesture.

**Why:** Swipes currently have no tactile feedback, and the back card sits static at scale 0.97 / opacity 0.6 the whole time — there is no sense of the deck responding to the drag.

**What to change:**
- Run `npx expo install expo-haptics` first.
- `src/swipe/useSwipeGesture.ts`: add an optional `onHaptic?: () => void` callback to `UseSwipeGestureOptions`. Call it via `runOnJS(onHaptic)()` inside the `direction !== null` branch of `.onEnd`. Also export two new shared values `dragProgress` (0→1, based on absolute horizontal travel / SCREEN_WIDTH) so callers can drive secondary animations.
- `src/swipe/SwipeEngine.tsx`: read `hapticFeedback` from `usePrefsStore`. Pass `onHaptic={() => { if (hapticFeedback) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}` to `useSwipeGesture`. Use the returned `dragProgress` shared value with `useAnimatedStyle` on the `nextCard` view: interpolate `scale` from `0.97` to `1.0` and `opacity` from `0.6` to `1.0` as `dragProgress` goes 0 → 1.

**Effort:** S
**Priority:** P1
**Depends on:** A1

---

## Agent C — Preview Player

## C1 · Wire auto-play previews end-to-end

**What:** When "Auto-play Previews" is on, automatically start the 30-second preview via `usePreviewPlayer` when the Spotify adapter fails for the current track. Pause and reset the preview player on every swipe so the next card starts fresh.

**Why:** `usePreviewPlayer` is already called in `swipe/[playlistId].tsx` (line 60) but its return value is discarded — nothing ever calls `player.play()`. `TrackPlayer` already fires `setPreviewUrl` (its `onPreviewRequired` callback) when the adapter fails and a preview URL exists, but the audio never starts.

**What to change:**
- `app/(app)/swipe/[playlistId].tsx`:
  - Capture the return value: `const previewPlayer = usePreviewPlayer(previewUrl)`.
  - Add a `useEffect([previewUrl])`: when `previewUrl` is non-null and `autoPlayPreviews` pref is on, call `previewPlayer.play()`.
  - When `autoPlayPreviews` is off, pass `null` instead of `setPreviewUrl` to the `TrackPlayer` constructor so the adapter-failure preview path is fully skipped: `new TrackPlayer(adapter, autoPlayPreviews ? setPreviewUrl : null)`.
  - On every card swipe (hook into `handleSessionEnd` or expose a prop from `SwipeEngine`): call `previewPlayer.pause()` and `setPreviewUrl(null)` to stop the preview and reset for the next track.
- Note: `expo-audio` (`~0.3.5`) is already installed. The hook guards against Expo Go (native module unavailable) via its try/require pattern.

**Effort:** M
**Priority:** P1
**Depends on:** A1

---

## B3 · Move destination editor button to swipe header

**What:** Add a `rightAction?: React.ReactNode` prop to `TabHeader` and move the floating pencil button from `SwipeEngine`'s content area into the header's right slot. The button triggers `DestinationEditor` — the wiring is already complete (`setShowDestEditor(true)` / modal rendering) but the button is easy to miss in its current position.

**Why:** The current `destEditButton` sits between the card stack and the button bar — it's a small `✎` circle that users don't discover. The header right slot is the conventional location for a screen-level action and puts it alongside the "Source → Dest" subtitle, which is exactly the context the editor changes.

**What to change:**
- `src/components/TabHeader.tsx`: add `rightAction?: React.ReactNode` to `TabHeaderProps`. Change the header layout from `alignItems: 'center'` (pure center stack) to a 3-column row: a left spacer `<View style={{flex:1}}/>`, a center column containing `title` + `subtitle`, and a right slot `<View style={{flex:1, alignItems:'flex-end'}}>{rightAction}</View>`. Title text should remain centered.
- `src/swipe/SwipeEngine.tsx`: remove the `<Pressable style={styles.destEditButton}>` block and its `destEditButton` + `destEditIcon` style entries. Instead, pass `rightAction` to `<TabHeader>`: a `<Pressable>` wrapping `<Ionicons name="create-outline" size={20} color={colors.onSurfaceVariant} />` that calls `setShowDestEditor(true)`. Add appropriate padding so it's easy to tap.

**Effort:** S
**Priority:** P1

---

---

## Agent D — Filter Mode

## D1 · Filter mode detection + destination picker guard

**What:** When the user selects the source playlist as a destination in `destination.tsx`, clear all other selections, lock the picker to source-only, and display an `AppModal` warning before navigating to the swipe screen. Add `isFilterMode: boolean` and `setFilterMode(value: boolean)` to `sessionStore`. Set it to `true` only after explicit confirmation.

**Why:** Without a guard, the user could accidentally enter filter mode (deleting tracks) believing it was a normal session. The confirmation modal makes the destructive semantics explicit.

**What to change:**
- `src/stores/sessionStore.ts`: add `isFilterMode: boolean` (default `false`) and `setFilterMode(value: boolean)` action. Add `clearSession()` call to reset it alongside the existing fields.
- `app/(app)/destination.tsx`: in `handleToggle`, when the toggled ID equals `playlistId` (the source) and it's being added: call `setSelectedIds(new Set([playlistId]))` (clears others, locks to source). Show a filter mode banner/chip below the search bar while source is selected ("Filter Mode — left swipe will delete from this playlist"). In `handleConfirm`: if source is in `selectedIds`, show a `AppModal` explaining the semantics ("You're entering Filter Mode. Swipe LEFT to delete tracks, swipe RIGHT to keep them. This is permanent."). On modal confirm: `setIsFilterMode(true)` then navigate. On cancel: do nothing.
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
- `app/(app)/session-end.tsx`:
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

# Done ✅

## A3 · Dynamic version + GitHub releases link

**What:** Replace the hardcoded `APP_VERSION = '1.0.0 (1)'` constant with a live value read from `expo-constants`, and make the Version row tappable — tapping opens the app's GitHub releases page in the in-app browser.

**Why:** The hardcoded string will drift out of sync with `app.json` on every release. Using `Constants.expoConfig.version` makes the settings screen authoritative, and the GitHub link lets users see what changed between releases.

**What to change:**
- `app/(app)/settings.tsx`: remove `const APP_VERSION = '1.0.0 (1)'`. Import `Constants` from `expo-constants`. Derive the version string as `Constants.expoConfig?.version ?? '—'`. Optionally append the native build number: `ios.buildNumber` or `android.versionCode` from `Constants.expoConfig`.
- Change the Version `<LinkRow>` from disabled (no `onPress`) to tappable: `onPress={() => void WebBrowser.openBrowserAsync('https://github.com/yarins0/music-swipe/releases')}`. Import `WebBrowser` from `expo-web-browser`. (Update the GitHub URL to the actual repo path if it differs.)

**Effort:** XS
**Priority:** P2
**Completed:** 2026-05-27
**Summary:** Removed `const APP_VERSION = '1.0.0 (1)'`. Added `expo-constants` and `expo-web-browser` imports. Version row now reads `Constants.expoConfig?.version` and opens the GitHub releases page in-app when tapped.

## A2 · Remove Spotify Sync toggle

**What:** Delete the "Spotify Sync" `ToggleRow` and its backing `spotifySync` useState from `settings.tsx`. Remove the toggle from the MUSIC INTEGRATION section, leaving only the Reconnect Service button.

**Why:** There is no meaningful "off" state for this toggle. `PlaylistWriter` and `BackendSync` have no disable path — toggling it off would silently do nothing while implying the app stopped syncing. The Reconnect Service button directly below it is sufficient for the section.

**What to change:**
- `app/(app)/settings.tsx`: delete `const [spotifySync, setSpotifySync] = useState(true)` and the `<ToggleRow label="Spotify Sync" .../>` + the `<View style={styles.divider} />` that precedes the Reconnect button.

**Effort:** XS
**Priority:** P1
**Completed:** 2026-05-27
**Summary:** Deleted `const [spotifySync, setSpotifySync] = useState(true)`, the `<ToggleRow label="Spotify Sync" .../>`, and the `<View style={styles.divider} />` that preceded the Reconnect button in `app/(app)/settings.tsx`. MUSIC INTEGRATION section now contains only the Reconnect Service button.
