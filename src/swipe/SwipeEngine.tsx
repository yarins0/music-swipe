import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
    // v1: playlist removal on undo is not yet implemented — state is already reverted by undo()
    if (record.status === 'liked' || record.status === 'super_liked') {
      console.warn('[SwipeEngine] Undo playlist removal not yet implemented for v1');
    }
    resetCardRef.current();
  }, [undo]);

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

  return (
    <View style={styles.container}>
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
    paddingBottom: 24,
    gap: 16,
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
    opacity: 0.85,
  },
  destEditButton: {
    alignSelf: 'flex-end',
    minWidth: 36,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 18,
    paddingHorizontal: 10,
  },
  destEditIcon: {
    color: '#ffffff',
    fontSize: 18,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#121212',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 18,
  },
});
