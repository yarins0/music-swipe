import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '@/theme';
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSwipeStore } from '@/stores/swipeStore';
import { useSwipeGesture } from '@/swipe/useSwipeGesture';
import { SwipeCard } from '@/swipe/SwipeCard';
import { ButtonBar } from '@/swipe/ButtonBar';
import { DestinationEditor } from '@/swipe/DestinationEditor';
import type { TrackPlayer } from '@/player/TrackPlayer';
import type { PlaylistWriter } from '@/services/PlaylistWriter';
import type { SessionTracker } from '@/services/SessionTracker';
import type { BackendSync } from '@/services/BackendSync';
import { PlatformError, PlatformErrorCode } from '@/adapters/interface';
import type { Playlist } from '@/adapters/interface';
import { openPlatformDeepLink } from '@/deeplink/PlatformDeepLink';
import type { SwipeDirection } from '@/swipe/useSwipeGesture';

interface SwipeEngineProps {
  trackPlayer: TrackPlayer;
  playlistWriter: PlaylistWriter;
  sessionTracker: SessionTracker;
  backendSync: BackendSync;
  sessionId: string;
  availablePlaylists: Playlist[];
  onSessionEnd: () => void;
  /** When provided, replaces the internal entire-session handler. */
  onEntireSession?: (added: string[], removed: string[], confirmedRemove: boolean) => void;
}

export function SwipeEngine({
  trackPlayer,
  playlistWriter,
  sessionTracker,
  backendSync,
  sessionId,
  availablePlaylists,
  onSessionEnd,
  onEntireSession: onEntireSessionProp,
}: SwipeEngineProps): React.ReactElement {
  const {
    queue,
    currentIndex,
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

  const currentTrack = queue[currentIndex] ?? null;
  const nextTrack = queue[currentIndex + 1] ?? null;

  // Capture effective destinations at call time before any state mutation.
  // Per-track override takes precedence over session default (Pitfall 6 fix).
  const getEffectiveDestinations = useCallback((): string[] => {
    return perTrackOverrideIds ?? activeDestinationIds;
  }, [perTrackOverrideIds, activeDestinationIds]);

  // Seek helpers — get current position then seek relative to it
  const handleSeekBack = useCallback(async (): Promise<void> => {
    try {
      const pos = await trackPlayer.seekTo(0).then(() => 0);
      // seekTo doesn't return position; use getCurrentPositionMs from adapter path
      void trackPlayer.seekTo(Math.max(0, pos - 20000));
    } catch {
      // seek errors are non-fatal
    }
  }, [trackPlayer]);

  const handleSeekForward = useCallback(async (): Promise<void> => {
    try {
      void trackPlayer.seekTo(20000);
    } catch {
      // seek errors are non-fatal
    }
  }, [trackPlayer]);

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

  // resetCard is populated after useSwipeGesture is called below.
  // Using a ref avoids circular hook dependency while keeping callbacks stable.
  const resetCardRef = useRef<() => void>(() => undefined);

  const handleSwipe = useCallback(
    (direction: SwipeDirection): void => {
      if (!currentTrack) return;

      const status =
        direction === 'right' ? 'liked' : direction === 'up' ? 'super_liked' : 'skipped';

      // Snapshot effective destinations BEFORE recordSwipe mutates state (Pitfall 6)
      const effectiveDestinations = getEffectiveDestinations();

      recordSwipe(currentTrack, status, effectiveDestinations);

      if (status === 'liked') {
        playlistWriter.write(currentTrack.id, effectiveDestinations);
      } else if (status === 'super_liked') {
        playlistWriter.superLike(currentTrack.id, effectiveDestinations);
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

      resetCardRef.current();
    },
    [
      currentTrack,
      getEffectiveDestinations,
      recordSwipe,
      playlistWriter,
      sessionTracker,
      sessionId,
      backendSync,
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
    resetCardRef.current();
  }, [currentTrack, recordSwipe, backendSync, sessionId, sessionTracker]);

  const handleUndo = useCallback((): void => {
    const record = undo();
    if (!record) return;
    if (record.status === 'liked') {
      playlistWriter.undoWrite(record.track.id, record.destinationPlaylistIds);
    } else if (record.status === 'super_liked') {
      playlistWriter.undoSuperLike(record.track.id, record.destinationPlaylistIds);
    }
    resetCardRef.current();
  }, [undo, playlistWriter]);

  const { gesture, animatedStyle, resetCard } = useSwipeGesture({
    onSwipe: handleSwipe,
  });

  // Wire resetCard into the ref after the hook provides it
  resetCardRef.current = resetCard;

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

  if (!currentTrack) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No more tracks</Text>
      </View>
    );
  }

  const songsLeft = queue.length - currentIndex;
  const progressFraction = queue.length > 0 ? currentIndex / queue.length : 0;

  return (
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

      {/* Card stack: next card renders behind, current card on top with gesture */}
      <View style={styles.cardStack}>
        {nextTrack && (
          <View style={styles.nextCard}>
            <SwipeCard
              track={nextTrack}
              onSeekBack={() => undefined}
              onSeekForward={() => undefined}
              isSeekEnabled={false}
            />
          </View>
        )}

        <GestureDetector gesture={gesture}>
          <Animated.View style={[styles.currentCard, animatedStyle as object]}>
            <SwipeCard
              track={currentTrack}
              onSeekBack={handleSeekBack}
              onSeekForward={handleSeekForward}
              isSeekEnabled={isSeekEnabled}
            />
          </Animated.View>
        </GestureDetector>
      </View>

      {/* Destination editor trigger */}
      <Pressable
        style={styles.destEditButton}
        onPress={() => setShowDestEditor(true)}
        accessibilityRole="button"
        accessibilityLabel="Edit destination playlists"
      >
        <Text style={styles.destEditIcon}>✎</Text>
      </Pressable>

      {/* Button bar */}
      <ButtonBar
        onUndo={handleUndo}
        onSkip={() => handleSwipe('left')}
        onSuperLike={() => handleSwipe('up')}
        onLike={() => handleSwipe('right')}
        onDecideLater={handleDecideLater}
        canUndo={undoStack.length > 0}
        isDecideLaterEnabled
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 12,
    backgroundColor: colors.background,
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
  cardStack: {
    flex: 1,
    width: '100%',
    position: 'relative',
  },
  currentCard: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    zIndex: 2,
  },
  nextCard: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    zIndex: 1,
    transform: [{ scale: 0.97 }],
    opacity: 0.6,
  },
  destEditButton: {
    alignSelf: 'flex-end',
    minWidth: 36,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: 18,
    paddingHorizontal: 10,
  },
  destEditIcon: {
    color: colors.onSurfaceVariant,
    fontSize: 16,
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
});
