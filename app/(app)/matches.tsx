import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing, radius } from '@/theme';
import { Image } from 'expo-image';
import { createSpotifyAdapter } from '@/auth/AuthGateway';
import { useMatchesStore, type MatchRecord } from '@/matches/useMatchesStore';
import { useSwipeStore } from '@/stores/swipeStore';
import type { MusicPlatformAdapter } from '@/adapters/interface';
import { LIKED_SONGS_PLAYLIST_ID } from '@/adapters/interface';
import { PlaylistWriter } from '@/services/PlaylistWriter';
import { TabHeader } from '@/components/TabHeader';

// ---------------------------------------------------------------------------
// Session grouping helpers
// ---------------------------------------------------------------------------

interface SessionHeader {
  type: 'header';
  key: string;
  sessionId: string | undefined;
  sourcePlaylistName: string | undefined;
  destinationNames: string[] | undefined;
  date: string;
}

interface TrackItem {
  type: 'track';
  key: string;
  record: MatchRecord;
}

type ListItem = SessionHeader | TrackItem;

function buildSessionGroups(matches: MatchRecord[]): ListItem[] {
  const items: ListItem[] = [];
  let lastSessionId: string | undefined = undefined;

  for (const record of matches) {
    const sid = record.sessionId ?? '__legacy__';

    if (sid !== lastSessionId) {
      lastSessionId = sid;
      const date = new Date(record.swipedAt).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
      });
      items.push({
        type: 'header',
        key: `header-${sid}-${record.swipedAt}`,
        sessionId: record.sessionId,
        sourcePlaylistName: record.sourcePlaylistName,
        destinationNames: record.destinationPlaylistNames,
        date,
      });
    }

    items.push({ type: 'track', key: record.swipedAt, record });
  }

  return items;
}

function SessionDivider({ item }: { item: SessionHeader }): React.ReactElement {
  const title = item.sourcePlaylistName ?? 'Session';
  const destLabel = item.destinationNames && item.destinationNames.length > 0
    ? item.destinationNames.join(', ')
    : null;

  return (
    <View style={dividerStyles.container}>
      <View style={dividerStyles.line} />
      <View style={dividerStyles.pill}>
        <Text style={dividerStyles.source} numberOfLines={1}>{title}</Text>
        {destLabel ? (
          <Text style={dividerStyles.dest} numberOfLines={1}>→ {destLabel}</Text>
        ) : null}
        <Text style={dividerStyles.date}>{item.date}</Text>
      </View>
      <View style={dividerStyles.line} />
    </View>
  );
}

function StatusBadge({ status }: { status: MatchRecord['status'] }): React.ReactElement {
  const isSuperLiked = status === 'super_liked';
  return (
    <View style={[styles.badge, isSuperLiked ? styles.badgeSuperLiked : styles.badgeLiked]}>
      <Text style={styles.badgeIcon}>{isSuperLiked ? '⭐' : '❤️'}</Text>
    </View>
  );
}

interface TrackRowProps {
  item: MatchRecord;
  isRemoving: boolean;
  onRemove: (record: MatchRecord) => void;
}

function TrackRow({ item, isRemoving, onRemove }: TrackRowProps): React.ReactElement {
  return (
    <View style={styles.row}>
      <Image
        source={{ uri: item.track.albumArtUrl }}
        style={styles.thumbnail}
        contentFit="cover"
      />
      <View style={styles.trackInfo}>
        <Text style={styles.trackTitle} numberOfLines={1}>
          {item.track.title}
        </Text>
        <Text style={styles.trackArtist} numberOfLines={1}>
          {item.track.artist}
        </Text>
      </View>
      <StatusBadge status={item.status} />
      <Pressable
        style={[styles.removeButton, isRemoving && styles.removeButtonDisabled]}
        onPress={() => onRemove(item)}
        disabled={isRemoving}
      >
        {isRemoving ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.removeText}>Cancel</Text>
        )}
      </Pressable>
    </View>
  );
}

export default function MatchesScreen(): React.ReactElement {
  const { matches } = useMatchesStore();
  const removeFromHistory = useSwipeStore((s) => s.removeFromHistory);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  const listData = useMemo(() => buildSessionGroups(matches), [matches]);

  const adapterRef = useRef<MusicPlatformAdapter | null>(null);
  const getAdapter = (): MusicPlatformAdapter => {
    if (!adapterRef.current) {
      adapterRef.current = createSpotifyAdapter();
    }
    return adapterRef.current;
  };

  const handleRemove = useCallback(
    async (record: MatchRecord): Promise<void> => {
      const { swipedAt } = record;
      const trackId = record.track.id;
      setRemovingIds((prev) => new Set(prev).add(swipedAt));

      try {
        const adapter = getAdapter();
        const writer = new PlaylistWriter(adapter);

        // Remove from regular playlists — this gates the UI update.
        const regularIds = record.destinationPlaylistIds.filter((id) => id !== LIKED_SONGS_PLAYLIST_ID);
        await writer.undoWriteAsync(trackId, regularIds);

        // Remove from persistent history — only reached if regular undo succeeded.
        removeFromHistory(swipedAt);

        // Best-effort: also remove from Liked Songs if we added it this session.
        // Runs after UI update so a failure here never aborts the visible removal.
        if (record.likedSongsWrittenByUs === true) {
          writer.undoWriteAsync(trackId, [LIKED_SONGS_PLAYLIST_ID]).catch((err: unknown) => {
            console.warn('[Matches] removeFromLikedSongs failed:', err);
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
    [removeFromHistory],
  );

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === 'header') return <SessionDivider item={item} />;
      return (
        <TrackRow
          item={item.record}
          isRemoving={removingIds.has(item.record.swipedAt)}
          onRemove={(record) => void handleRemove(record)}
        />
      );
    },
    [removingIds, handleRemove],
  );

  const keyExtractor = useCallback((item: ListItem) => item.key, []);

  return (
    <View style={styles.container}>
      <TabHeader title="History" />

      <FlatList
        data={listData}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={
          matches.length === 0 ? styles.emptyContainer : styles.listContent
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No liked tracks yet</Text>
          </View>
        }
      />
    </View>
  );
}

const dividerStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.surfaceContainerHigh,
  },
  pill: {
    alignItems: 'center',
    gap: 2,
    maxWidth: '70%',
  },
  source: {
    fontSize: 12,
    fontFamily: 'Outfit_600SemiBold',
    color: colors.onSurface,
    textAlign: 'center',
  },
  dest: {
    fontSize: 11,
    fontFamily: 'Outfit_400Regular',
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  date: {
    fontSize: 10,
    fontFamily: 'Outfit_400Regular',
    color: colors.outlineVariant,
    textAlign: 'center',
    marginTop: 1,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    paddingVertical: spacing.sm,
  },
  emptyContainer: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    color: colors.onSurfaceVariant,
    fontSize: 16,
    fontFamily: 'Outfit_400Regular',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceContainerHigh,
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerHigh,
  },
  trackInfo: {
    flex: 1,
    gap: 4,
  },
  trackTitle: {
    color: colors.onSurface,
    fontSize: 15,
    fontFamily: 'Outfit_600SemiBold',
  },
  trackArtist: {
    color: colors.onSurfaceVariant,
    fontSize: 13,
    fontFamily: 'Outfit_400Regular',
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLiked: {
    backgroundColor: 'rgba(253,41,123,0.12)',
  },
  badgeSuperLiked: {
    backgroundColor: 'rgba(245,211,0,0.15)',
  },
  badgeIcon: {
    fontSize: 16,
  },
  removeButton: {
    backgroundColor: colors.surfaceContainerHigh,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.full,
    minWidth: 72,
    alignItems: 'center',
  },
  removeButtonDisabled: {
    opacity: 0.5,
  },
  removeText: {
    color: colors.onSurfaceVariant,
    fontSize: 13,
    fontFamily: 'Outfit_600SemiBold',
  },
});
