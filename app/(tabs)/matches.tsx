import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Animated, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Swipeable } from 'react-native-gesture-handler';
import { spacing, radius, type Colors } from '@/theme';
import { useTheme } from '@/hooks/useTheme';
import { createSpotifyAdapter } from '@/auth/AuthGateway';
import { useSwipeStore } from '@/stores/swipeStore';
import type { SessionEntry } from '@/stores/swipeStore';
import type { MusicPlatformAdapter } from '@/adapters/interface';
import { LIKED_SONGS_PLAYLIST_ID } from '@/adapters/interface';
import { PlaylistWriter } from '@/services/PlaylistWriter';
import { TabHeader } from '@/components/TabHeader';
import { SessionCard } from '@/components/SessionCard';
import { AppModal } from '@/components/AppModal';

/**
 * History tab — a stack of the user's recent swipe sessions. Each card shows the session's
 * source/destinations, progress and counts, with a Resume action (in-progress sessions) and
 * an expandable list of its liked tracks (removable). Swiping a card left reveals a Delete
 * action that removes the session (and its cached likes) from History after confirmation.
 */
export default function MatchesScreen(): React.ReactElement {
  const router = useRouter();
  const sessions = useSwipeStore((s) => s.sessions);
  const setActiveSession = useSwipeStore((s) => s.setActiveSession);
  const removeSwipeFromSession = useSwipeStore((s) => s.removeSwipeFromSession);
  const deleteSession = useSwipeStore((s) => s.deleteSession);

  const { activeColors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(activeColors), [isDark]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  // Session awaiting delete confirmation (set by the swipe-to-reveal Delete action).
  const [pendingDelete, setPendingDelete] = useState<SessionEntry | null>(null);

  const adapterRef = useRef<MusicPlatformAdapter | null>(null);
  const getAdapter = (): MusicPlatformAdapter => {
    if (!adapterRef.current) adapterRef.current = createSpotifyAdapter();
    return adapterRef.current;
  };

  // Most-recently-touched session first.
  const ordered = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [sessions],
  );

  const handleResume = useCallback(
    (session: SessionEntry): void => {
      setActiveSession(session.sessionId);
      router.navigate({
        pathname: '/(tabs)/swipe/[playlistId]',
        params: { playlistId: session.sourcePlaylistId },
      });
    },
    [setActiveSession, router],
  );

  const handleRemoveTrack = useCallback(
    async (session: SessionEntry, swipedAt: string): Promise<void> => {
      const record = session.likedSwipes.find((r) => r.swipedAt === swipedAt);
      if (!record) return;
      setRemovingIds((prev) => new Set(prev).add(swipedAt));
      try {
        const writer = new PlaylistWriter(getAdapter());
        // Remove from regular playlists first — this gates the history update.
        const regularIds = record.destinationPlaylistIds.filter((id) => id !== LIKED_SONGS_PLAYLIST_ID);
        await writer.undoWriteAsync(record.track.id, regularIds);

        removeSwipeFromSession(session.sessionId, swipedAt);

        // Best-effort: also remove from Liked Songs if we added it this session.
        if (record.likedSongsWrittenByUs === true) {
          writer.undoWriteAsync(record.track.id, [LIKED_SONGS_PLAYLIST_ID]).catch((err: unknown) => {
            console.warn('[History] removeFromLikedSongs failed:', err);
          });
        }
      } catch {
        Alert.alert('Error', 'Could not remove track. Please try again.');
      } finally {
        setRemovingIds((prev) => {
          const next = new Set(prev);
          next.delete(swipedAt);
          return next;
        });
      }
    },
    [removeSwipeFromSession],
  );

  // Red Delete action revealed by swiping a card left. Closes the row, then opens the
  // confirmation modal (the actual delete happens on confirm). Uses the classic (Animated-
  // based) Swipeable — ReanimatedSwipeable in this RNGH version reads shared values during
  // render, which warns and freezes the JS thread when a row is removed mid-animation.
  const renderRightActions = useCallback(
    (session: SessionEntry) =>
      // This is a Swipeable render-prop callback, not a React component definition.
      // eslint-disable-next-line react/display-name
      (
        _progress: Animated.AnimatedInterpolation<number>,
        _drag: Animated.AnimatedInterpolation<number>,
        swipeable: Swipeable,
      ): React.ReactElement => (
        <Pressable
          style={styles.deleteAction}
          onPress={() => {
            swipeable.close();
            setPendingDelete(session);
          }}
          accessibilityRole="button"
          accessibilityLabel="Delete session"
        >
          <Ionicons name="trash-outline" size={22} color="#fff" />
          <Text style={styles.deleteActionText}>Delete</Text>
        </Pressable>
      ),
    [styles],
  );

  const renderItem = useCallback(
    ({ item }: { item: SessionEntry }) => (
      <Swipeable
        renderRightActions={renderRightActions(item)}
        rightThreshold={40}
        friction={2}
        overshootRight={false}
      >
        <SessionCard
          session={item}
          isExpanded={expandedId === item.sessionId}
          onToggleExpand={() =>
            setExpandedId((prev) => (prev === item.sessionId ? null : item.sessionId))
          }
          onResume={() => handleResume(item)}
          onRemoveTrack={(swipedAt) => void handleRemoveTrack(item, swipedAt)}
          removingIds={removingIds}
        />
      </Swipeable>
    ),
    [expandedId, removingIds, handleResume, handleRemoveTrack, renderRightActions],
  );

  return (
    <View style={styles.container}>
      <TabHeader title="History" />
      <FlatList
        data={ordered}
        keyExtractor={(item) => item.sessionId}
        renderItem={renderItem}
        contentContainerStyle={ordered.length === 0 ? styles.emptyContainer : styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No sessions yet</Text>
          </View>
        }
      />

      <AppModal
        visible={pendingDelete !== null}
        title="Delete this session?"
        message={
          pendingDelete
            ? `This removes the "${pendingDelete.sourcePlaylistName}" session and its ${pendingDelete.likedSwipes.length} saved like${pendingDelete.likedSwipes.length === 1 ? '' : 's'} from your History on this device.`
            : ''
        }
        warning="Tracks already added to your Spotify playlists are not affected."
        confirmLabel="Delete"
        confirmDestructive
        cancelLabel="Cancel"
        onConfirm={() => {
          if (pendingDelete) deleteSession(pendingDelete.sessionId);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </View>
  );
}

function createStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    listContent: { paddingVertical: spacing.sm },
    emptyContainer: { flex: 1 },
    emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
    emptyText: { color: c.onSurfaceVariant, fontSize: 16, fontFamily: 'Outfit_400Regular' },
    // Aligned to the card's right inset + bottom gap so the red action matches the card.
    deleteAction: {
      backgroundColor: c.nope,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 4,
      width: 84,
      marginRight: spacing.md,
      marginBottom: spacing.sm,
      borderRadius: radius.lg,
    },
    deleteActionText: { color: '#fff', fontFamily: 'Outfit_600SemiBold', fontSize: 12 },
  });
}
