import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { type Colors } from '@/theme';
import { useTheme } from '@/hooks/useTheme';
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
import type { BackendSync } from '@/services/BackendSync';
import { PlatformError, PlatformErrorCode, LIKED_SONGS_PLAYLIST_ID } from '@/adapters/interface';
import type { MusicPlatformAdapter, Playlist } from '@/adapters/interface';
import { openPlatformDeepLink } from '@/deeplink/PlatformDeepLink';
import { useSessionStore } from '@/stores/sessionStore';
import { usePrefsStore } from '@/stores/prefsStore';
import { useUiStore } from '@/stores/uiStore';
import { useRouter } from 'expo-router';
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

// How many cards ahead of the loaded queue end to request the next lazy page. A buffer
// this size means the fetch almost always resolves before the user reaches the gap.
const PREFETCH_AHEAD = 10;

// How often to poll the adapter for playback position to drive the segment-progress
// dots. getCurrentPositionMs() makes a real Spotify HTTP request, so this interval
// trades dot responsiveness for staying well clear of rate limits.
const POSITION_POLL_INTERVAL_MS = 4000;

// After a manual seek, Spotify's reported position can lag the real (just-seeked-to)
// position by a few seconds — polling during that window would overwrite the correct,
// optimistically-set dot with a stale pre-seek value, then "bounce" back once Spotify
// catches up. Suppressing polls for this long (longer than one poll interval, so at
// least one tick is skipped) lets the reported position settle before trusting it again.
const SEEK_SETTLE_GRACE_MS = 6000;

interface SwipeEngineProps {
  trackPlayer: TrackPlayer;
  playlistWriter: PlaylistWriter;
  backendSync: BackendSync;
  /** Adapter instance — required for filter mode destructive removes. */
  adapter: MusicPlatformAdapter;
  sessionId: string;
  availablePlaylists: Playlist[];
  /** Total tracks in the source playlist (from the API, not the loaded slice). */
  totalTracks: number;
  onSessionEnd: () => void;
  /**
   * Called when the loaded queue is running low and more source-playlist pages remain.
   * The screen owns the fetch + appendFreshTracks; the engine only signals "buffer low".
   */
  onNeedMoreTracks?: () => void;
  /** When provided, replaces the internal entire-session handler. */
  onEntireSession?: (added: string[], removed: string[], confirmedRemove: boolean) => void;
}
export function SwipeEngine({
  trackPlayer,
  playlistWriter,
  backendSync,
  adapter,
  sessionId,
  availablePlaylists,
  totalTracks,
  onSessionEnd,
  onNeedMoreTracks,
  onEntireSession: onEntireSessionProp,
}: SwipeEngineProps): React.ReactElement {
  const {
    queue,
    currentIndex,
    absoluteIndex,
    nextPageOffset,
    decideQueue,
    secondPassInjected,
    activeDestinationIds,
    undoStack,
    recordSwipe,
    undo,
    injectSecondPass,
    setActiveDestinations,
  } = useSwipeStore();

  const { activeColors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(activeColors), [isDark]);

  // More source-playlist pages remain to lazily load when the paging cursor hasn't
  // reached the reported total. Drives both the prefetch trigger and the session-end guard.
  const hasMoreTracks = nextPageOffset < totalTracks;

  // A decide-later second pass is still owed: tracks were deferred and the re-show band
  // has not been appended yet. Keeps the session alive (and the empty-state showing a
  // loader, not "No more tracks") until injectSecondPass runs.
  const hasPendingSecondPass = !secondPassInjected && decideQueue.length > 0;

  // Playback strategy for current track — determines isSeekEnabled on SwipeCard
  const [isSeekEnabled, setIsSeekEnabled] = useState(false);
  // Polled playback position — drives the segment-progress dots on the front card
  const [positionMs, setPositionMs] = useState(0);
  // Mirrors positionMs synchronously. Refs update immediately (state does not), so
  // this is the authoritative base for back-to-back seek taps: reading positionMs
  // from a closure could see a stale value from before an in-flight render committed,
  // letting rapid taps compute targets from inconsistent bases.
  const positionRef = useRef<number>(0);
  // Timestamp of the last manual seek — see SEEK_SETTLE_GRACE_MS for why polls are
  // briefly suppressed after one fires.
  const lastManualSeekAtRef = useRef<number>(0);

  // Single write path for position changes — keeps positionRef and positionMs in
  // lockstep so the ref never drifts from what's rendered.
  const applyPosition = useCallback((value: number): void => {
    positionRef.current = value;
    setPositionMs(value);
  }, []);
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

  const router = useRouter();

  // The "Audio unavailable" badge means there is no active Spotify device, so playback
  // could not start. Tapping it routes to the Auto-play Music setting (and its
  // "Sync Spotify" button) and asks that row to flash so the fix is obvious.
  const handleAudioUnavailablePress = useCallback((): void => {
    useUiStore.getState().requestAutoPlayHighlight();
    router.navigate('/(tabs)/settings');
  }, [router]);

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

  // Seek helpers — step one segment relative to the locally-tracked position.
  // Step is one-eighth of the track (min 20s); see computeSeekStepMs.
  //
  // Deliberately do NOT re-read trackPlayer.getCurrentPositionMs() here. That makes
  // a real Spotify HTTP request whose reported position lags briefly behind an actual
  // seek/play call — with SegmentNavigator firing taps with no debounce, a slow, stale
  // read from one tap could resolve after a faster, fresher tap and overwrite its
  // (correct) position with a stale-derived one, producing a visible "bounce" once the
  // network round trip completed. Computing from positionRef.current — updated
  // synchronously, in order, on every tap — keeps every step self-consistent and
  // removes the race entirely. The actual seekTo call is fire-and-forget; there is
  // nothing to "correct" against since our local position is authoritative until the
  // next (grace-window-protected) poll.
  const handleSeekBack = useCallback((): void => {
    if (!currentTrack) return;
    const step = computeSeekStepMs(currentTrack.durationMs);
    const target = Math.max(0, positionRef.current - step);
    lastManualSeekAtRef.current = Date.now();
    applyPosition(target);
    void trackPlayer.seekTo(target).catch(() => {
      // seek errors are non-fatal
    });
  }, [trackPlayer, currentTrack, applyPosition]);

  const handleSeekForward = useCallback((): void => {
    if (!currentTrack) return;
    const step = computeSeekStepMs(currentTrack.durationMs);
    const durationMs = currentTrack.durationMs;
    const rawTarget = positionRef.current + step;
    // Clamp to the track end when the duration is known so we never seek past it.
    const target = durationMs > 0 ? Math.min(rawTarget, durationMs) : rawTarget;
    lastManualSeekAtRef.current = Date.now();
    applyPosition(target);
    void trackPlayer.seekTo(target).catch(() => {
      // seek errors are non-fatal
    });
  }, [trackPlayer, currentTrack, applyPosition]);

  // Play the track at queue[idx] and update seek availability. Gated behind the
  // Auto-play Music preference — when off, the card stays silent and there is
  // nothing to seek within, so isSeekEnabled stays false.
  const playTrackAt = useCallback(
    async (idx: number): Promise<void> => {
      const track = queue[idx];
      if (!track) return;
      if (!usePrefsStore.getState().autoPlayMusic) {
        setIsSeekEnabled(false);
        return;
      }
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

  // Reset the polled position whenever the card changes — the new track starts at 0,
  // and waiting for the next poll tick would briefly show the previous track's dot.
  // Also clear the seek-settle suppression so the new track's polls aren't dropped
  // because of a seek made on the previous track.
  useEffect(() => {
    applyPosition(0);
    lastManualSeekAtRef.current = 0;
  }, [currentIndex, applyPosition]);

  // Poll the adapter for playback position so the segment-progress dots advance as the
  // track plays. Only runs while seek is enabled (i.e. the adapter is actually playing
  // this track) — otherwise there is nothing to poll and isSeekEnabled === false anyway.
  useEffect(() => {
    if (!isSeekEnabled || !currentTrack) return;

    const intervalId = setInterval(() => {
      trackPlayer
        .getCurrentPositionMs()
        .then((polled) => {
          // Drop polls that land inside the post-seek settle window — see
          // SEEK_SETTLE_GRACE_MS for why trusting them would make the dots bounce.
          if (Date.now() - lastManualSeekAtRef.current < SEEK_SETTLE_GRACE_MS) return;
          applyPosition(polled);
        })
        .catch(() => {
          // polling errors are non-fatal — the dots simply stop advancing until the next tick
        });
    }, POSITION_POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [isSeekEnabled, currentTrack, trackPlayer, applyPosition]);

  // Segment math mirrors the tap-to-seek step so each dot corresponds to one seek tap.
  const stepMs = currentTrack ? computeSeekStepMs(currentTrack.durationMs) : SEEK_MIN_STEP_MS;
  const totalSegments = currentTrack ? Math.max(1, Math.ceil(currentTrack.durationMs / stepMs)) : 1;
  const currentSegment = Math.min(totalSegments - 1, Math.floor(positionMs / stepMs));

  // Request the next lazy page once the user is within PREFETCH_AHEAD cards of the
  // loaded queue end and more pages remain. The screen guards against concurrent fetches,
  // so firing this repeatedly while a fetch is in flight is harmless.
  useEffect(() => {
    if (hasMoreTracks && currentIndex >= queue.length - PREFETCH_AHEAD) {
      onNeedMoreTracks?.();
    }
  }, [currentIndex, queue.length, hasMoreTracks, onNeedMoreTracks]);

  // Once the fresh queue is exhausted and no more pages remain, append the decide-later
  // tracks for a within-session second pass. Runs before the session-end effect so the
  // session does not end while re-shows are still owed; injectSecondPass is a one-shot
  // (guarded by secondPassInjected), so this can't loop.
  useEffect(() => {
    if (currentIndex >= queue.length && !hasMoreTracks && hasPendingSecondPass) {
      injectSecondPass();
    }
  }, [currentIndex, queue.length, hasMoreTracks, hasPendingSecondPass, injectSecondPass]);

  // Session end when the queue is exhausted, no more pages remain, AND no second pass is
  // still owed. The hasMoreTracks guard prevents ending early at a page boundary; the
  // hasPendingSecondPass guard prevents ending before the decide-later re-shows are injected.
  useEffect(() => {
    if (
      queue.length > 0 &&
      currentIndex >= queue.length &&
      !hasMoreTracks &&
      !hasPendingSecondPass
    ) {
      onSessionEnd();
    }
  }, [currentIndex, queue.length, hasMoreTracks, hasPendingSecondPass, onSessionEnd]);

  // Preload upcoming tracks' album art so back-card image swaps don't flicker.
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

      backendSync.postSwipe({
        sessionId,
        trackId: currentTrack.id,
        direction: status,
        destinationPlaylistIds: effectiveDestinations,
        timestamp: new Date().toISOString(),
        track: currentTrack,
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
      track: currentTrack,
    });
    setPerTrackOverrideIds(null);
  }, [currentTrack, recordSwipe, backendSync, sessionId]);

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
      <Ionicons name="create-outline" size={20} color={activeColors.onSurfaceVariant} />
    </Pressable>
  );

  if (!currentTrack) {
    // hasMoreTracks means the user out-ran an in-flight lazy page; hasPendingSecondPass
    // means the decide-later re-shows are about to be appended. In either case show a
    // loader rather than "No more tracks" so the queue doesn't look prematurely empty.
    return (
      <View style={styles.screen}>
        <TabHeader title="Discover" subtitle={headerSubtitle} />
        <View style={styles.empty}>
          {hasMoreTracks || hasPendingSecondPass ? (
            <ActivityIndicator size="large" color={activeColors.primary} />
          ) : (
            <Text style={styles.emptyText}>No more tracks</Text>
          )}
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
              totalSegments={1}
              currentSegment={0}
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
          totalSegments={totalSegments}
          currentSegment={currentSegment}
          showAlbumArt={showAlbumArt}
          onAudioUnavailablePress={handleAudioUnavailablePress}
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

function createStyles(c: Colors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.background,
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
      color: c.onSurfaceVariant,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    songsLeft: {
      fontSize: 11,
      fontFamily: 'Outfit_600SemiBold',
      color: c.primary,
    },
    progressTrack: {
      height: 6,
      backgroundColor: c.surfaceContainerHighest,
      borderRadius: 3,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: c.primary,
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
      backgroundColor: c.background,
    },
    emptyText: {
      color: c.onSurfaceVariant,
      fontSize: 18,
      fontFamily: 'Outfit_400Regular',
    },
    // DEBUG styles — used only when DEBUG_FLICKER is true.
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
}
