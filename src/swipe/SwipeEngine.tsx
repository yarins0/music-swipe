import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { colors } from '@/theme';
import { TabHeader } from '@/components/TabHeader';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSwipeStore } from '@/stores/swipeStore';
import { SwipeCard } from '@/swipe/SwipeCard';
import { SwipeFrontCard } from '@/swipe/SwipeFrontCard';
import { ButtonBar } from '@/swipe/ButtonBar';
import { DestinationEditor } from '@/swipe/DestinationEditor';
import type { TrackPlayer } from '@/player/TrackPlayer';
import type { PlaylistWriter } from '@/services/PlaylistWriter';
import type { SessionTracker } from '@/services/SessionTracker';
import type { BackendSync } from '@/services/BackendSync';
import { PlatformError, PlatformErrorCode, LIKED_SONGS_PLAYLIST_ID } from '@/adapters/interface';
import type { MusicPlatformAdapter, Playlist } from '@/adapters/interface';
import { openPlatformDeepLink } from '@/deeplink/PlatformDeepLink';
import { useSessionStore } from '@/stores/sessionStore';
import { usePrefsStore } from '@/stores/prefsStore';
import type { SwipeDirection } from '@/swipe/useSwipeGesture';

// DEBUG: visual aids for the swipe-card flicker investigation.
// When true, paints red border + track label on the front card and blue
// border + track label on the back card so we can see exactly which view
// holds which content during the swipe transition. Flip to false to remove.
const DEBUG_FLICKER = false;

// Tap-to-seek step: one-eighth of the track length, floored at 20s so short
// tracks still move a meaningful amount. (durationMs / 8 is below 20s exactly
// when the track is shorter than 160s.)
const SEEK_MIN_STEP_MS = 20000;
function computeSeekStepMs(durationMs: number): number {
  return Math.max(SEEK_MIN_STEP_MS, Math.round(durationMs / 8));
}

interface SwipeEngineProps {
  trackPlayer: TrackPlayer;
  playlistWriter: PlaylistWriter;
  sessionTracker: SessionTracker;
  backendSync: BackendSync;
  /** Adapter instance — required for filter mode destructive removes. */
  adapter: MusicPlatformAdapter;
  sessionId: string;
  availablePlaylists: Playlist[];
  /** Total tracks in the source playlist (from the API, not the loaded slice). */
  totalTracks: number;
  onSessionEnd: () => void;
  /** When provided, replaces the internal entire-session handler. */
  onEntireSession?: (added: string[], removed: string[], confirmedRemove: boolean) => void;
}
export function SwipeEngine({
  trackPlayer,
  playlistWriter,
  sessionTracker,
  backendSync,
  adapter,
  sessionId,
  availablePlaylists,
  totalTracks,
  onSessionEnd,
  onEntireSession: onEntireSessionProp,
}: SwipeEngineProps): React.ReactElement {
  const {
    queue,
    currentIndex,
    absoluteIndex,
    activeDestinationIds,
    undoStack,
    recordSwipe,
    undo,
    setActiveDestinations,
  } = useSwipeStore();

  // Playback strategy for current track — determines isSeekEnabled on SwipeCard
  const [isSeekEnabled, setIsSeekEnabled] = useState(false);
  // Per-track destination override (null = use session default)
  const [perTrackOverrideIds, setPerTrackOverrideIds] = useState<string[] | null>(null);
  // Destination editor modal visibility
  const [showDestEditor, setShowDestEditor] = useState(false);

  const sourcePlaylistName = useSessionStore((s) => s.sourcePlaylistName);
  const sourcePlaylistId = useSessionStore((s) => s.sourcePlaylistId);
  const isFilterMode = useSessionStore((s) => s.isFilterMode);

  // User preferences that affect swipe-card rendering and gesture behaviour
  const showAlbumArt = usePrefsStore((s) => s.showAlbumArt);
  const hapticFeedback = usePrefsStore((s) => s.hapticFeedback);

  // Build a human-readable subtitle: "Source Name  →  Dest1, Dest2"
  const headerSubtitle = React.useMemo(() => {
    if (!sourcePlaylistName) return undefined;
    const destNames = activeDestinationIds.map((id) => {
      if (id === LIKED_SONGS_PLAYLIST_ID) return 'Liked Songs';
      return availablePlaylists.find((p) => p.id === id)?.name ?? id;
    });
    const destLabel = destNames.length > 0 ? destNames.join(', ') : 'No destinations';
    return `${sourcePlaylistName}  →  ${destLabel}`;
  }, [sourcePlaylistName, activeDestinationIds, availablePlaylists]);

  const resolveDestNames = useCallback(
    (ids: string[]): string[] =>
      ids.map((id) => {
        if (id === LIKED_SONGS_PLAYLIST_ID) return 'Liked Songs';
        return availablePlaylists.find((p) => p.id === id)?.name ?? id;
      }),
    [availablePlaylists],
  );

  const currentTrack = queue[currentIndex] ?? null;
  const nextTrack = queue[currentIndex + 1] ?? null;

  // Capture effective destinations at call time before any state mutation.
  // Per-track override takes precedence over session default (Pitfall 6 fix).
  const getEffectiveDestinations = useCallback((): string[] => {
    return perTrackOverrideIds ?? activeDestinationIds;
  }, [perTrackOverrideIds, activeDestinationIds]);

  // Seek helpers — read the live position, then seek one step relative to it.
  // Step is one-eighth of the track (min 20s); see computeSeekStepMs.
  const handleSeekBack = useCallback(async (): Promise<void> => {
    if (!currentTrack) return;
    try {
      const position = await trackPlayer.getCurrentPositionMs();
      const step = computeSeekStepMs(currentTrack.durationMs);
      await trackPlayer.seekTo(Math.max(0, position - step));
    } catch {
      // seek errors are non-fatal
    }
  }, [trackPlayer, currentTrack]);

  const handleSeekForward = useCallback(async (): Promise<void> => {
    if (!currentTrack) return;
    try {
      const position = await trackPlayer.getCurrentPositionMs();
      const step = computeSeekStepMs(currentTrack.durationMs);
      const target = position + step;
      // Clamp to the track end when the duration is known so we never seek past it.
      const clamped =
        currentTrack.durationMs > 0 ? Math.min(target, currentTrack.durationMs) : target;
      await trackPlayer.seekTo(clamped);
    } catch {
      // seek errors are non-fatal
    }
  }, [trackPlayer, currentTrack]);

  // Play the track at queue[idx] and update seek availability
  const playTrackAt = useCallback(
    async (idx: number): Promise<void> => {
      const track = queue[idx];
      if (!track) return;
      try {
        const result = await trackPlayer.play(track);
        setIsSeekEnabled(result.strategy === 'adapter');
      } catch (err) {
        setIsSeekEnabled(false);
        if (err instanceof PlatformError && err.code === PlatformErrorCode.NO_ACTIVE_DEVICE) {
          console.log('[SwipeEngine] NO_ACTIVE_DEVICE during play — opening Spotify deep link');
          void openPlatformDeepLink('spotify:');
          Alert.alert(
            'Open Spotify',
            'Start playing something in Spotify, then come back to MusicSwipe.',
            [{ text: 'OK' }],
          );
        }
      }
    },
    [queue, trackPlayer],
  );

  // Track initial play on mount / when currentIndex changes
  const lastPlayedIndex = useRef<number>(-1);
  useEffect(() => {
    if (currentTrack && lastPlayedIndex.current !== currentIndex) {
      lastPlayedIndex.current = currentIndex;
      void playTrackAt(currentIndex);
    }
  }, [currentIndex, currentTrack, playTrackAt]);

  // Session end when queue is exhausted
  useEffect(() => {
    if (queue.length > 0 && currentIndex >= queue.length) {
      onSessionEnd();
    }
  }, [currentIndex, queue.length, onSessionEnd]);

  // Preload upcoming tracks' album art so back-card image swaps don't flicker.
  // When the back card's track prop swaps in place (D → E), expo-image must
  // load E's URL from network if it isn't cached, leaving the Image area blank
  // for a frame. Prefetching ~3 ahead ensures the URL is in the cache before
  // it appears in any visible slot.
  useEffect(() => {
    const PRELOAD_AHEAD = 3;
    const upcoming = queue.slice(currentIndex + 1, currentIndex + 1 + PRELOAD_AHEAD);
    upcoming.forEach((track) => {
      if (track?.albumArtUrl) {
        Image.prefetch(track.albumArtUrl);
      }
    });
  }, [currentIndex, queue]);

  const handleSwipe = useCallback(
    (direction: SwipeDirection): void => {
      if (!currentTrack) return;

      const status =
        direction === 'right' ? 'liked' : direction === 'up' ? 'super_liked' : 'skipped';

      // Snapshot effective destinations BEFORE recordSwipe mutates state (Pitfall 6)
      const effectiveDestinations = getEffectiveDestinations();
      const effectiveDestNames = resolveDestNames(effectiveDestinations);

      recordSwipe(currentTrack, status, effectiveDestinations, effectiveDestNames);

      if (isFilterMode) {
        // Filter mode: left = delete from source; up = save to Liked Songs; right = keep (no-op).
        if (status === 'skipped' && sourcePlaylistId) {
          void adapter.removeFromPlaylist(sourcePlaylistId, currentTrack.id).catch((err: unknown) => {
            console.warn('[SwipeEngine] filter mode removeFromPlaylist failed:', err);
          });
        } else if (status === 'super_liked') {
          // No destination playlists in filter mode — save to Liked Songs only.
          playlistWriter.superLike(currentTrack.id, []);
        }
        // Right swipe = keep, no-op.
      } else {
        if (status === 'liked') {
          playlistWriter.write(currentTrack.id, effectiveDestinations);
        } else if (status === 'super_liked') {
          playlistWriter.superLike(currentTrack.id, effectiveDestinations);
        }
      }

      sessionTracker.incrementCounts(sessionId, {
        liked: status === 'liked' ? 1 : undefined,
        superLiked: status === 'super_liked' ? 1 : undefined,
        skipped: status === 'skipped' ? 1 : undefined,
      });

      backendSync.postSwipe({
        sessionId,
        trackId: currentTrack.id,
        direction: status,
        destinationPlaylistIds: effectiveDestinations,
        timestamp: new Date().toISOString(),
      });

      // Clear per-track override after each swipe
      setPerTrackOverrideIds(null);
    },
    [
      currentTrack,
      getEffectiveDestinations,
      resolveDestNames,
      recordSwipe,
      playlistWriter,
      sessionTracker,
      sessionId,
      backendSync,
      isFilterMode,
      sourcePlaylistId,
      adapter,
    ],
  );

  const handleDecideLater = useCallback((): void => {
    if (!currentTrack) return;
    recordSwipe(currentTrack, 'pending', []);
    backendSync.postSwipe({
      sessionId,
      trackId: currentTrack.id,
      direction: 'pending',
      destinationPlaylistIds: [],
      timestamp: new Date().toISOString(),
    });
    sessionTracker.incrementCounts(sessionId, { skipped: 1 });
  }, [currentTrack, recordSwipe, backendSync, sessionId, sessionTracker]);

  const handleUndo = useCallback((): void => {
    const record = undo();
    if (!record) return;

    if (isFilterMode) {
      if (record.status === 'skipped' && sourcePlaylistId) {
        // Call adapter directly to bypass PlaylistWriter's writtenPairs deduplication,
        // which would silently skip re-adding tracks previously liked to this playlist.
        void adapter.addToPlaylist(sourcePlaylistId, record.track.id).catch((err: unknown) => {
          console.warn('[SwipeEngine] filter mode undo addToPlaylist failed:', err);
        });
      } else if (record.status === 'super_liked') {
        playlistWriter.undoSuperLike(record.track.id, []);
      }
      // liked = keep (no-op), nothing to reverse
    } else {
      if (record.status === 'liked') {
        playlistWriter.undoWrite(record.track.id, record.destinationPlaylistIds);
      } else if (record.status === 'super_liked') {
        playlistWriter.undoSuperLike(record.track.id, record.destinationPlaylistIds);
      }
    }

  }, [undo, playlistWriter, isFilterMode, sourcePlaylistId, adapter]);

  const hapticCallback = hapticFeedback
    ? () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }
    : undefined;

  // DestinationEditor handlers
  const handleThisTrack = useCallback((playlistIds: string[]): void => {
    setPerTrackOverrideIds(playlistIds);
    setShowDestEditor(false);
  }, []);

  const handleFromNowOn = useCallback(
    (playlistIds: string[]): void => {
      setActiveDestinations(playlistIds);
      setShowDestEditor(false);
    },
    [setActiveDestinations],
  );

  const handleEntireSession = useCallback(
    (added: string[], removed: string[], confirmedRemove: boolean): void => {
      if (!confirmedRemove && removed.length > 0) return;

      // Apply retroactive adds/removes to session default
      const newDestinations = [
        ...activeDestinationIds.filter((id) => !removed.includes(id)),
        ...added.filter((id) => !activeDestinationIds.includes(id)),
      ];
      setActiveDestinations(newDestinations);
      setShowDestEditor(false);

      // Forward to screen-level handler for adapter-backed retroactive writes
      onEntireSessionProp?.(added, removed, confirmedRemove);
    },
    [activeDestinationIds, setActiveDestinations, onEntireSessionProp],
  );

  // The pencil button lives in the TabHeader's right slot — conventional location for
  // a screen-level action and keeps it next to the "Source → Dest" subtitle it edits.
  const destEditorButton = (
    <Pressable
      onPress={() => setShowDestEditor(true)}
      accessibilityRole="button"
      accessibilityLabel="Edit destination playlists"
      style={styles.headerActionButton}
    >
      <Ionicons name="create-outline" size={20} color={colors.onSurfaceVariant} />
    </Pressable>
  );

  if (!currentTrack) {
    return (
      <View style={styles.screen}>
        <TabHeader title="Discover" subtitle={headerSubtitle} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No more tracks</Text>
        </View>
      </View>
    );
  }

  // Use absoluteIndex (total playlist tracks consumed) over the full trackCount
  // so the bar reflects true playlist progress, not just the loaded slice.
  const songsLeft = Math.max(0, totalTracks - absoluteIndex);
  const progressFraction = totalTracks > 0 ? absoluteIndex / totalTracks : 0;

  return (
    <View style={styles.screen}>
      <TabHeader title="Discover" subtitle={headerSubtitle} />
      <View style={styles.container}>
      {/* Progress section */}
      <View style={styles.progressSection}>
        <View style={styles.progressLabels}>
          <Text style={styles.queueLabel}>DISCOVERY QUEUE</Text>
          <Text style={styles.songsLeft}>{songsLeft} songs left</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progressFraction * 100)}%` }]} />
        </View>
      </View>

      {/* cardArea holds the back card and the GestureDetector as siblings so
          the nextCard is completely outside the gesture view hierarchy.
          nextCard renders first (behind) by natural stacking order. */}
      <View style={styles.cardArea}>
        {nextTrack && (
          <View
            style={[styles.nextCard, DEBUG_FLICKER && styles.debugBackBorder]}
            pointerEvents="none"
          >
            <SwipeCard
              track={nextTrack}
              onSeekBack={() => undefined}
              onSeekForward={() => undefined}
              isSeekEnabled={false}
              showAlbumArt={showAlbumArt}
            />
            {DEBUG_FLICKER && (
              <View style={styles.debugLabelBack} pointerEvents="none">
                <Text style={styles.debugLabelText}>
                  BACK · {nextTrack.title.slice(0, 20)} · id={nextTrack.id.slice(-6)}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* NOT keyed — same instance across tracks. Image updates in-place from
            memory cache (no flash). Gesture state reset happens via useEffect
            inside SwipeFrontCard when track.id changes. */}
        <SwipeFrontCard
          track={currentTrack}
          onSwipe={handleSwipe}
          onHaptic={hapticCallback}
          onSeekBack={handleSeekBack}
          onSeekForward={handleSeekForward}
          isSeekEnabled={isSeekEnabled}
          showAlbumArt={showAlbumArt}
          debug={DEBUG_FLICKER}
        />
      </View>

      {/* Button bar */}
      <ButtonBar
        onUndo={handleUndo}
        onSkip={() => handleSwipe('left')}
        onSuperLike={() => handleSwipe('up')}
        onLike={() => handleSwipe('right')}
        onDecideLater={handleDecideLater}
        canUndo={undoStack.length > 0}
        isDecideLaterEnabled
        isFilterMode={isFilterMode}
      />

      {/* Destination editor modal */}
      {showDestEditor && (
        <DestinationEditor
          availablePlaylists={availablePlaylists}
          sessionDestinationIds={activeDestinationIds}
          perTrackOverrideIds={perTrackOverrideIds}
          onClose={() => setShowDestEditor(false)}
          onThisTrack={handleThisTrack}
          onFromNowOn={handleFromNowOn}
          onEntireSession={handleEntireSession}
        />
      )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 12,
  },
  progressSection: { width: '100%' },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  queueLabel: {
    fontSize: 11,
    fontFamily: 'Outfit_600SemiBold',
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  songsLeft: {
    fontSize: 11,
    fontFamily: 'Outfit_600SemiBold',
    color: colors.primary,
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  cardArea: {
    flex: 1,
    width: '100%',
  },
  nextCard: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  headerActionButton: {
    padding: 8,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  emptyText: {
    color: colors.onSurfaceVariant,
    fontSize: 18,
    fontFamily: 'Outfit_400Regular',
  },
  // DEBUG styles — used only when DEBUG_FLICKER is true.
  // (Front debug styles live in SwipeFrontCard.tsx.)
  debugBackBorder: {
    borderWidth: 4,
    borderColor: 'blue',
  },
  debugLabelBack: {
    position: 'absolute',
    top: 50,
    left: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,255,0.85)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  debugLabelText: {
    color: 'white',
    fontSize: 12,
    fontFamily: 'Outfit_700Bold',
  },
});
