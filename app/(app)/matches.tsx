import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { createSpotifyAdapter } from '@/auth/AuthGateway';
import { useMatchesStore, fetchFromBackend, type MatchRecord } from '@/matches/useMatchesStore';
import type { MusicPlatformAdapter } from '@/adapters/interface';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

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
          <Text style={styles.removeText}>Remove</Text>
        )}
      </Pressable>
    </View>
  );
}

export default function MatchesScreen(): React.ReactElement {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const router = useRouter();

  const supabaseToken = useAuthStore((s) => s.supabaseToken);
  const { matches: zustandMatches } = useMatchesStore();

  const [matches, setMatches] = useState<MatchRecord[]>(zustandMatches);
  const [isLoadingBackend, setIsLoadingBackend] = useState(false);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  const adapterRef = useRef<MusicPlatformAdapter | null>(null);
  const getAdapter = (): MusicPlatformAdapter => {
    if (!adapterRef.current) {
      adapterRef.current = createSpotifyAdapter();
    }
    return adapterRef.current;
  };

  // Fallback: if Zustand is empty (clearSession already called), fetch from backend
  useEffect(() => {
    if (zustandMatches.length > 0) {
      setMatches(zustandMatches);
      return;
    }

    if (!sessionId || !supabaseToken) return;

    setIsLoadingBackend(true);
    fetchFromBackend(sessionId, supabaseToken, BACKEND_URL)
      .then((backendMatches) => {
        setMatches(backendMatches);
      })
      .catch((err) => {
        console.warn('[Matches] fetchFromBackend failed:', err);
      })
      .finally(() => {
        setIsLoadingBackend(false);
      });
  }, []);

  const handleRemove = useCallback(
    async (record: MatchRecord): Promise<void> => {
      const trackId = record.track.id;
      setRemovingIds((prev) => new Set(prev).add(trackId));

      try {
        const adapter = getAdapter();
        for (const destId of record.destinationPlaylistIds) {
          await adapter.removeFromPlaylist(destId, trackId);
        }
        // Optimistic removal from local state on success
        setMatches((prev) => prev.filter((m) => m.track.id !== trackId));
      } catch {
        Alert.alert('Error', 'Could not remove track. Please try again.');
      } finally {
        setRemovingIds((prev) => {
          const next = new Set(prev);
          next.delete(trackId);
          return next;
        });
      }
    },
    [],
  );

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)');
    }
  }, [router]);

  const renderItem = useCallback(
    ({ item }: { item: MatchRecord }) => (
      <TrackRow
        item={item}
        isRemoving={removingIds.has(item.track.id)}
        onRemove={(record) => void handleRemove(record)}
      />
    ),
    [removingIds, handleRemove],
  );

  const keyExtractor = useCallback((item: MatchRecord) => item.track.id, []);

  if (isLoadingBackend) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1DB954" />
        <Text style={styles.loadingText}>Loading matches…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.heading}>Matches</Text>
        <View style={styles.backButton} />
      </View>

      <FlatList
        data={matches}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={
          matches.length === 0 ? styles.emptyContainer : styles.listContent
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No liked tracks this session</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    color: colors.onSurfaceVariant,
    fontSize: 15,
    fontFamily: 'Outfit_400Regular',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHigh,
  },
  heading: {
    color: colors.onSurface,
    fontSize: 18,
    fontFamily: 'Outfit_700Bold',
    letterSpacing: -0.3,
  },
  backButton: {
    width: 70,
  },
  backText: {
    color: colors.primary,
    fontSize: 16,
    fontFamily: 'Outfit_600SemiBold',
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
