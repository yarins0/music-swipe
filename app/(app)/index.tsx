import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  SectionList,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { createSpotifyAdapter } from '@/auth/AuthGateway';
import { getUserPlaylists, resolvePlaylistFromUrl } from '@/playlist/PlaylistResolver';
import { PlaylistRow } from '@/components/PlaylistRow';
import type { Playlist } from '@/adapters/interface';
import { LIKED_SONGS_PLAYLIST_ID } from '@/adapters/interface';

type Section = { title: string; data: Playlist[] };

export default function SourcePickerScreen() {
  const router = useRouter();
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const [sections, setSections] = useState<Section[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isResolvingUrl, setIsResolvingUrl] = useState(false);

  const loadPlaylists = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const adapter = createSpotifyAdapter();
      const { owned, followed } = await getUserPlaylists(adapter);

      const built: Section[] = [{ title: 'My Playlists', data: owned }];
      if (followed.length > 0) {
        built.push({ title: 'Following', data: followed });
      }
      setSections(built);
    } catch (err) {
      console.error('[SourcePicker] loadPlaylists error:', err);
      setLoadError('Failed to load playlists. Pull to retry.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlaylists();
  }, [loadPlaylists]);

  const handleSelectPlaylist = (playlist: Playlist) => {
    router.push({
      pathname: '/(app)/destination',
      params: { playlistId: playlist.id, playlistName: playlist.name },
    });
  };

  const handleUrlSubmit = async () => {
    if (!urlInput.trim()) return;
    setUrlError(null);
    setIsResolvingUrl(true);

    try {
      const adapter = createSpotifyAdapter();
      const playlist = await resolvePlaylistFromUrl(urlInput, adapter);
      handleSelectPlaylist(playlist);
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : 'Could not resolve playlist');
    } finally {
      setIsResolvingUrl(false);
    }
  };

  const ownedPlaylists = sections.find((s) => s.title === 'My Playlists')?.data ?? [];
  const onlyLikedSongs =
    ownedPlaylists.length === 1 && ownedPlaylists[0]?.id === LIKED_SONGS_PLAYLIST_ID;

  const ListHeader = (
    <View style={styles.header}>
      <TouchableOpacity style={styles.logoutButton} onPress={clearAuth}>
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>
      <View style={styles.urlRow}>
        <TextInput
          style={styles.urlInput}
          placeholder="Paste Spotify playlist URL or ID"
          placeholderTextColor="#9ca3af"
          value={urlInput}
          onChangeText={setUrlInput}
          onSubmitEditing={handleUrlSubmit}
          returnKeyType="go"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {isResolvingUrl ? (
          <ActivityIndicator style={styles.urlLoader} />
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
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{loadError}</Text>
        <TouchableOpacity onPress={loadPlaylists} style={styles.retryButton}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <PlaylistRow playlist={item} onPress={handleSelectPlaylist} />
      )}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
        </View>
      )}
      renderSectionFooter={({ section }) =>
        section.title === 'My Playlists' && onlyLikedSongs ? (
          <View style={styles.nudge}>
            <Text style={styles.nudgeText}>
              Browse Spotify to discover playlists to follow
            </Text>
          </View>
        ) : null
      }
      ListHeaderComponent={ListHeader}
      stickySectionHeadersEnabled
      style={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: '#f9fafb' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: { backgroundColor: '#fff', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  urlRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  urlInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#111',
    backgroundColor: '#f9fafb',
  },
  urlButton: {
    backgroundColor: '#1DB954',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  urlButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  urlLoader: { marginHorizontal: 8 },
  urlError: { color: '#e53e3e', fontSize: 13, marginTop: 6 },
  sectionHeader: {
    backgroundColor: '#f9fafb',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  nudge: { paddingHorizontal: 16, paddingVertical: 12 },
  nudgeText: { fontSize: 14, color: '#6b7280', textAlign: 'center' },
  errorText: { fontSize: 15, color: '#374151', textAlign: 'center', marginBottom: 16 },
  retryButton: { backgroundColor: '#1DB954', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: '600' },
  logoutButton: { alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: 8, marginBottom: 8 },
  logoutText: { color: '#6b7280', fontSize: 13 },
});
