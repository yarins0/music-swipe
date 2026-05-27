import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  SectionList,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/authStore';
import { createSpotifyAdapter } from '@/auth/AuthGateway';
import { getUserPlaylists, resolvePlaylistFromUrl } from '@/playlist/PlaylistResolver';
import { PlaylistRow } from '@/components/PlaylistRow';
import { TabHeader } from '@/components/TabHeader';
import { AppModal } from '@/components/AppModal';
import type { Playlist, MusicPlatformAdapter } from '@/adapters/interface';
import { LIKED_SONGS_PLAYLIST_ID } from '@/adapters/interface';
import { colors, spacing, radius } from '@/theme';

type Section = { title: string; data: Playlist[] };

export default function SourcePickerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const clearAuth = useAuthStore((s) => s.clearAuth);

  const [sections, setSections] = useState<Section[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);

  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isResolvingUrl, setIsResolvingUrl] = useState(false);

  const [unownedPlaylist, setUnownedPlaylist] = useState<Playlist | null>(null);
  const adapterRef = useRef<MusicPlatformAdapter | null>(null);

  const loadPlaylists = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const adapter = createSpotifyAdapter();
      adapterRef.current = adapter;
      const { owned, followed } = await getUserPlaylists(adapter);
      const built: Section[] = [{ title: 'My Playlists', data: owned }];
      if (followed.length > 0) built.push({ title: 'Following', data: followed });
      setSections(built);
    } catch (err) {
      console.error('[SourcePicker] loadPlaylists error:', err);
      setLoadError('Failed to load playlists. Tap to retry.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadPlaylists(); }, [loadPlaylists]);

  const handleNext = () => {
    if (!selectedPlaylist) return;
    const adapter = adapterRef.current;
    if (adapter && !adapter.capabilities.canReadUnownedPlaylists && !selectedPlaylist.isOwned) {
      setUnownedPlaylist(selectedPlaylist);
      return;
    }
    router.push({
      pathname: '/(app)/destination',
      params: { playlistId: selectedPlaylist.id, playlistName: selectedPlaylist.name },
    });
  };

  const handleUrlSubmit = async () => {
    if (!urlInput.trim()) return;
    setUrlError(null);
    setIsResolvingUrl(true);
    try {
      const adapter = adapterRef.current ?? createSpotifyAdapter();
      adapterRef.current = adapter;
      const playlist = await resolvePlaylistFromUrl(urlInput, adapter);
      if (!adapter.capabilities.canReadUnownedPlaylists && !playlist.isOwned) {
        setUnownedPlaylist(playlist);
        return;
      }
      router.push({ pathname: '/(app)/destination', params: { playlistId: playlist.id, playlistName: playlist.name } });
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : 'Could not resolve playlist');
    } finally {
      setIsResolvingUrl(false);
    }
  };

  const handleOpenUnownedInApp = async () => {
    if (!unownedPlaylist || !adapterRef.current) return;
    await adapterRef.current.openPlaylistInApp(unownedPlaylist.id);
    setUnownedPlaylist(null);
  };

  const ownedPlaylists = sections.find((s) => s.title === 'My Playlists')?.data ?? [];
  const onlyLikedSongs = ownedPlaylists.length === 1 && ownedPlaylists[0]?.id === LIKED_SONGS_PLAYLIST_ID;

  const ListHeader = (
    <View style={styles.listHeader}>
      <Text style={styles.sectionTag}>YOUR LIBRARY</Text>
      <Text style={styles.sectionSubtitle}>Choose a playlist to sync with MusicSwipe.</Text>
      {/* URL paste input */}
      <View style={styles.urlRow}>
        <TextInput
          style={styles.urlInput}
          placeholder="Paste Spotify playlist URL or ID…"
          placeholderTextColor={colors.outline}
          value={urlInput}
          onChangeText={setUrlInput}
          onSubmitEditing={handleUrlSubmit}
          returnKeyType="go"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {isResolvingUrl ? (
          <ActivityIndicator style={styles.urlLoader} color={colors.primary} />
        ) : (
          <TouchableOpacity style={styles.urlButton} onPress={handleUrlSubmit}>
            <Text style={styles.urlButtonText}>Go</Text>
          </TouchableOpacity>
        )}
      </View>
      {urlError ? <Text style={styles.urlError}>{urlError}</Text> : null}
    </View>
  );

  if (isLoading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{loadError}</Text>
        <TouchableOpacity onPress={loadPlaylists} style={styles.retryButton}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <TabHeader title="Playlists" />

      {/* List */}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PlaylistRow
            playlist={item}
            onPress={setSelectedPlaylist}
            isSelected={selectedPlaylist?.id === item.id}
          />
        )}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>{section.title === 'My Playlists' ? '' : section.title}</Text>
        )}
        renderSectionFooter={({ section }) =>
          section.title === 'My Playlists' && onlyLikedSongs ? (
            <Text style={styles.nudgeText}>Browse Spotify to discover playlists to follow</Text>
          ) : null
        }
        ListHeaderComponent={ListHeader}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.listContent}
        style={styles.list}
      />

      {/* Footer: Next button */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.nextBtn, !selectedPlaylist && styles.nextBtnDisabled]}
          onPress={handleNext}
          disabled={!selectedPlaylist}
        >
          <Text style={[styles.nextBtnText, !selectedPlaylist && styles.nextBtnTextDisabled]}>
            Next →
          </Text>
        </TouchableOpacity>
      </View>

      <AppModal
        visible={unownedPlaylist !== null}
        title="Copy this playlist first"
        message={`"${unownedPlaylist?.name ?? 'This playlist'}" belongs to someone else. Spotify only lets you read tracks from playlists you own — make a copy in Spotify, then come back and select your copy.`}
        confirmLabel="Open in Spotify"
        cancelLabel="Go back"
        onConfirm={handleOpenUnownedInApp}
        onCancel={() => setUnownedPlaylist(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: 16 },
  listHeader: { paddingTop: spacing.lg, paddingBottom: spacing.sm },
  sectionTag: {
    fontSize: 11,
    fontFamily: 'Outfit_600SemiBold',
    color: colors.onSurfaceVariant,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    fontFamily: 'Outfit_400Regular',
    color: colors.onSurfaceVariant,
    marginBottom: spacing.md,
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 4,
  },
  urlInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    fontFamily: 'Outfit_400Regular',
    color: colors.onSurface,
    backgroundColor: colors.surface,
  },
  urlButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.lg,
  },
  urlButtonText: { color: '#fff', fontFamily: 'Outfit_600SemiBold', fontSize: 14 },
  urlLoader: { marginHorizontal: spacing.sm },
  urlError: {
    fontSize: 12,
    color: colors.nope,
    fontFamily: 'Outfit_400Regular',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: 'Outfit_600SemiBold',
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  nudgeText: {
    fontSize: 13,
    color: colors.onSurfaceVariant,
    fontFamily: 'Outfit_400Regular',
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: colors.background },
  errorText: { fontSize: 15, color: colors.onSurface, textAlign: 'center', marginBottom: spacing.md, fontFamily: 'Outfit_400Regular' },
  retryButton: { backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: radius.full },
  retryText: { color: '#fff', fontFamily: 'Outfit_600SemiBold', fontSize: 15 },
  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerHigh,
  },
  nextBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  nextBtnDisabled: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  nextBtnText: {
    color: '#fff',
    fontFamily: 'Outfit_700Bold',
    fontSize: 16,
  },
  nextBtnTextDisabled: {
    color: colors.onSurfaceVariant,
  },
});
