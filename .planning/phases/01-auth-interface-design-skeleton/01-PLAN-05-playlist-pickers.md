---
id: 01-PLAN-05
title: Playlist Picker Screens
wave: 3
depends_on:
  - 01-PLAN-03
  - 01-PLAN-04
files_modified:
  - app/(app)/index.tsx
  - app/(app)/destination.tsx
  - src/playlist/PlaylistResolver.ts
  - src/components/PlaylistRow.tsx
  - src/components/PlaylistAccessGuard.tsx
  - src/stores/sessionStore.ts
autonomous: true
requirements_addressed:
  - REQ-001
  - REQ-003
  - REQ-005
---

# Plan 05: Playlist Picker Screens

## Objective

Build the two playlist picker screens: source picker (two-section list with Liked Songs first, URL paste, URL validation) and destination picker (multi-select checkboxes, inline playlist creation). After completing this plan, a user can: log in → see their playlists → pick a source → pick destinations → reach a swipe screen stub.

Phase 1 success criteria 2 and 3 are delivered by this plan.

## Tasks

<task id="T05-01">
<title>Create src/playlist/PlaylistResolver.ts</title>

<read_first>
- src/adapters/interface.ts (MusicPlatformAdapter, Playlist, LIKED_SONGS_PLAYLIST_ID)
- src/auth/AuthGateway.ts (createSpotifyAdapter)
- .planning/phases/01-auth-interface-design-skeleton/01-CONTEXT.md (D-04, D-05, D-06, D-07)
- .planning/phases/01-auth-interface-design-skeleton/01-RESEARCH.md (Section 10 — source picker implementation, URL parse)
</read_first>

<action>
Create src/playlist/PlaylistResolver.ts:

Export class or set of functions:

**`getUserPlaylists(adapter: MusicPlatformAdapter): Promise<{ owned: Playlist[]; followed: Playlist[] }>`**:
- Call adapter.getUserPlaylists() — already returns [likedSongs, ...rest]
- Split result: owned = all where isOwned === true (includes Liked Songs), followed = all where isOwned === false
- Return { owned, followed }
- owned array: Liked Songs is first (because getUserPlaylists guarantees it), then remaining owned sorted by name
- followed array: sorted by name

**`resolvePlaylistFromUrl(url: string, adapter: MusicPlatformAdapter): Promise<Playlist>`**:
- Accepts three URL shapes:
  1. https://open.spotify.com/playlist/{id} — extract id with regex /\/playlist\/([A-Za-z0-9]+)/
  2. spotify:playlist:{id} — extract id after last ':'
  3. Raw 22-char base62 ID — use as-is (validate: /^[A-Za-z0-9]{22}$/)
- If none match: throw new Error('Invalid Spotify playlist URL or ID')
- Call adapter.getPlaylistById(id)
- If adapter throws PlatformError(NOT_FOUND): re-throw with user-friendly message 'Playlist not found or private'
- Return the Playlist

**`getPendingTracks(playlistId: string, userId: string, adapter: MusicPlatformAdapter)`**:
- Stub only in Phase 1 (implemented in Phase 2 when swipe backend is ready)
- Return []
</action>

<acceptance_criteria>
- src/playlist/PlaylistResolver.ts exports getUserPlaylists and resolvePlaylistFromUrl
- getUserPlaylists returns owned and followed as separate arrays
- Liked Songs is always first in the owned array (id === LIKED_SONGS_PLAYLIST_ID)
- resolvePlaylistFromUrl extracts playlist ID from https://open.spotify.com/playlist/{id}
- resolvePlaylistFromUrl extracts playlist ID from spotify:playlist:{id}
- resolvePlaylistFromUrl throws on unrecognized format
- `npx tsc --noEmit` exits 0
</acceptance_criteria>
</task>

<task id="T05-02">
<title>Create src/components/PlaylistRow.tsx</title>

<read_first>
- src/adapters/interface.ts (Playlist interface — id, name, coverArtUrl, trackCount, isOwned, isFollowed)
</read_first>

<action>
Create src/components/PlaylistRow.tsx:

Props interface:
- playlist: Playlist
- onPress: (playlist: Playlist) => void
- isSelected?: boolean (for checkbox mode in destination picker)
- showCheckbox?: boolean

Renders:
- Cover art thumbnail (Image from expo-image or React Native Image) — if coverArtUrl is null, show a grey placeholder square
- Playlist name (Text, single line, ellipsize)
- Track count (Text, secondary color)
- If showCheckbox: a checkbox on the right (Checkbox from expo-checkbox or custom)
- Liked Songs row (id === LIKED_SONGS_PLAYLIST_ID): show a heart icon instead of cover art

Accessibility: role="button", accessibilityLabel={`${playlist.name}, ${playlist.trackCount} tracks`}
</action>

<acceptance_criteria>
- src/components/PlaylistRow.tsx renders without errors given a Playlist object
- PlaylistRow shows grey placeholder when coverArtUrl is null
- PlaylistRow renders a checkbox when showCheckbox is true
- Liked Songs row uses a heart icon or distinct placeholder (not a blank image)
- `npx tsc --noEmit` exits 0
</acceptance_criteria>
</task>

<task id="T05-03">
<title>Create src/components/PlaylistAccessGuard.tsx (stub)</title>

<read_first>
- src/adapters/interface.ts (AdapterCapabilities — requiresExplicitFollow)
- .planning/phases/01-auth-interface-design-skeleton/01-CONTEXT.md (D-06 — PlaylistAccessGuard behavior)
</read_first>

<action>
Create src/components/PlaylistAccessGuard.tsx:

Props: { capabilities: AdapterCapabilities; playlistId: string; children: ReactNode }

In Phase 1: if capabilities.requiresExplicitFollow is false (which it is for SpotifyAdapter), render children directly.
If requiresExplicitFollow is true: render a placeholder UI — "Follow this playlist first to access it" with a "Open in Spotify" button that is a no-op stub in Phase 1.

This component reads the capability flag — never checks `if platform === 'spotify'`.
</action>

<acceptance_criteria>
- src/components/PlaylistAccessGuard.tsx exists and renders children when requiresExplicitFollow is false
- Component uses capabilities.requiresExplicitFollow (capability flag) not a platform identity check
- `npx tsc --noEmit` exits 0
</acceptance_criteria>
</task>

<task id="T05-04">
<title>Build app/(app)/index.tsx — Source Playlist Picker</title>

<read_first>
- src/playlist/PlaylistResolver.ts
- src/components/PlaylistRow.tsx
- src/components/PlaylistAccessGuard.tsx
- src/auth/AuthGateway.ts (createSpotifyAdapter)
- .planning/phases/01-auth-interface-design-skeleton/01-CONTEXT.md (D-04, D-05, D-06, D-07)
- .planning/phases/01-auth-interface-design-skeleton/01-RESEARCH.md (Section 10 — source picker, SectionList, URL paste)
</read_first>

<action>
Replace the placeholder app/(app)/index.tsx with the real source picker:

1. **Data loading**: On mount, call createSpotifyAdapter() and getUserPlaylists(adapter). Store { owned, followed } in state. Show ActivityIndicator while loading. Show error message if loading fails.

2. **SectionList layout**:
   - sections = [{ title: 'My Playlists', data: owned }, { title: 'Following', data: followed }]
   - keyExtractor = item.id
   - renderItem = <PlaylistRow playlist={item} onPress={handleSelectSource} />
   - renderSectionHeader = sticky section title
   - Empty state for Following section: no special treatment (section just has no items)
   - Empty state for My Playlists (only Liked Songs present): show nudge text below the Liked Songs row: "Browse Spotify to discover playlists to follow"

3. **URL paste field**: TextInput at the top of the screen (above the SectionList, in ListHeaderComponent):
   - Placeholder: "Paste Spotify playlist URL or ID"
   - On submit: call resolvePlaylistFromUrl(inputValue, adapter)
   - If successful: navigate to destination picker with the resolved playlist
   - If error: show inline error text below the input

4. **Navigation on playlist select**: When a playlist row is pressed, navigate to `/(app)/destination` passing the selected playlist ID and name as route params.

5. **Screen header**: "Choose a Playlist"
</action>

<acceptance_criteria>
- Screen renders a SectionList with "My Playlists" and "Following" sections
- Liked Songs appears first in "My Playlists" section with a distinct icon
- Pressing a playlist row navigates to the destination picker screen
- URL paste field resolves a valid Spotify playlist URL and navigates to destination picker
- URL paste field shows inline error for invalid input
- Empty "Following" section shows nothing (no crash)
- "My Playlists" with only Liked Songs shows the nudge text
- `npx expo start` — screen loads without errors
</acceptance_criteria>
</task>

<task id="T05-05">
<title>Create src/stores/sessionStore.ts (destination selection state)</title>

<read_first>
- src/adapters/interface.ts (Playlist)
- .planning/REQUIREMENTS.md (REQ-005 — multi-destination)
- .planning/notes/multi-destination-playlists.md (data model implications)
</read_first>

<action>
Create src/stores/sessionStore.ts using Zustand (persisted to AsyncStorage — not SecureStore, this is not sensitive):

State:
- sourcePlaylistId: string | null
- sourcePlaylistName: string | null
- destinationPlaylistIds: string[] (empty array by default)

Actions:
- setSource(playlistId: string, playlistName: string): sets sourcePlaylistId and sourcePlaylistName
- setDestinations(playlistIds: string[]): replaces destinationPlaylistIds
- addDestination(playlistId: string): adds to destinationPlaylistIds if not already present
- removeDestination(playlistId: string): removes from destinationPlaylistIds
- clearSession(): resets all state to initial values

This store is the single source of truth for the current session setup. Phase 2 will extend it with swipe state.
</action>

<acceptance_criteria>
- src/stores/sessionStore.ts exports useSessionStore
- setDestinations(['a','b']) → destinationPlaylistIds equals ['a','b']
- addDestination('c') on ['a','b'] → ['a','b','c']
- addDestination('a') on ['a','b'] → ['a','b'] (no duplicate)
- removeDestination('a') on ['a','b'] → ['b']
- `npx tsc --noEmit` exits 0
</acceptance_criteria>
</task>

<task id="T05-06">
<title>Build app/(app)/destination.tsx — Destination Playlist Picker</title>

<read_first>
- src/stores/sessionStore.ts
- src/playlist/PlaylistResolver.ts
- src/components/PlaylistRow.tsx
- src/auth/AuthGateway.ts
- .planning/phases/01-auth-interface-design-skeleton/01-CONTEXT.md (D-08, D-09)
- .planning/phases/01-auth-interface-design-skeleton/01-RESEARCH.md (Section 11 — destination picker)
- .planning/REQUIREMENTS.md (REQ-005)
</read_first>

<action>
Create app/(app)/destination.tsx:

1. **Read source playlist**: from route params (playlistId, playlistName) passed from index.tsx. Call sessionStore.setSource(playlistId, playlistName) on mount.

2. **Data loading**: Load owned playlists only (not followed) — users can only write to owned playlists. Call getUserPlaylists(adapter) and use only the owned array (excluding Liked Songs — destination picker does not include Liked Songs because super like writes there via saveToLibrary, not addToPlaylist).

3. **Multi-select state**: local state `selectedIds: Set<string>` initialized to empty Set.

4. **Render**: FlatList with PlaylistRow (showCheckbox=true, isSelected=selectedIds.has(item.id)). Tapping toggles the checkbox.

5. **Empty state** (no owned playlists, not counting Liked Songs):
   - Show a "New Playlist" row at the very top of the list (rendered before FlatList via ListHeaderComponent)
   - Tapping opens an Alert.prompt on iOS or a custom TextInput modal on Android
   - On confirm (name entered): call adapter.createPlaylist(name), add the new playlist ID to selectedIds, re-fetch owned playlists to update the list

6. **Bottom bar**: sticky Confirm button. Enabled only when selectedIds.size > 0. On press:
   - Call sessionStore.setDestinations(Array.from(selectedIds))
   - Navigate to `/(app)/swipe/[playlistId]` with sourcePlaylistId from sessionStore (stub screen — just needs to exist as a placeholder)

7. **Screen header**: "Choose Destinations"

8. **Create app/(app)/swipe/[playlistId].tsx** as a placeholder: return View with Text "Swipe Screen — Phase 2"
</action>

<acceptance_criteria>
- Destination picker shows only owned playlists (not Liked Songs, not followed)
- Each row has a checkbox; tapping toggles selection
- Confirm button is disabled when no playlists are selected
- Confirm button calls sessionStore.setDestinations with the selected IDs
- Empty state shows a "New Playlist" option; tapping it calls adapter.createPlaylist()
- Newly created playlist appears in list and is pre-selected
- Confirm navigates to swipe placeholder screen
- `npx expo start` — destination screen loads without errors when navigated from source picker
</acceptance_criteria>
</task>

## Verification

<verification>
### Goal-Backward Check
Phase 1 success criteria 2 and 3:
- Criterion 2: "User sees their owned + followed playlists in a platform-agnostic list" ✓ (SectionList in index.tsx)
- Criterion 3: "User can select a source playlist and one or more destination playlists (multi-select)" ✓ (index.tsx + destination.tsx)

### Manual Test Flow
1. Log in (Plan 04)
2. Source picker: see Liked Songs first, then owned playlists, then following
3. Paste a Spotify playlist URL → navigates to destination picker
4. Destination picker: select 2 playlists → tap Confirm → reach swipe placeholder

### Phase 1 Complete — All 6 success criteria met:
1. OAuth PKCE + SecureStore ✓ (Plan 04)
2. Platform-agnostic playlist list ✓ (this plan)
3. Multi-select destination picker ✓ (this plan)
4. MusicPlatformAdapter fully typed ✓ (Plan 01 + 03)
5. No cross-adapter imports ✓ (Plan 01 ESLint rule)
6. Backend + PostgreSQL schema ✓ (Plan 02)
</verification>

<must_haves>
truths:
  - Source picker uses SectionList with My Playlists (owned) then Following sections
  - Liked Songs is always first in My Playlists section
  - Destination picker shows only owned playlists (not Liked Songs, not followed)
  - selectedIds is a Set (no duplicates possible)
  - sessionStore.setDestinations is called on Confirm with Array.from(selectedIds)
  - createPlaylist() is called on adapter (not backend) when user creates a new playlist inline
  - Swipe placeholder screen exists at app/(app)/swipe/[playlistId].tsx
</must_haves>
