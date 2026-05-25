import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createSpotifyAdapter } from '@/auth/AuthGateway';
import { getUserPlaylists } from '@/playlist/PlaylistResolver';
import { PlaylistRow } from '@/components/PlaylistRow';
import { useSessionStore } from '@/stores/sessionStore';
import { LIKED_SONGS_PLAYLIST_ID } from '@/adapters/interface';
import type { Playlist, MusicPlatformAdapter } from '@/adapters/interface';
import { colors, spacing, radius } from '@/theme';

export default function DestinationPickerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { playlistId, playlistName } = useLocalSearchParams<{ playlistId: string; playlistName: string }>();

  const setSource = useSessionStore((s) => s.setSource);
  const setDestinations = useSessionStore((s) => s.setDestinations);

  const [ownedPlaylists, setOwnedPlaylists] = useState<Playlist[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [adapter, setAdapter] = useState<MusicPlatformAdapter | null>(null);

  const [showNewPlaylistModal, setShowNewPlaylistModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (playlistId && playlistName) setSource(playlistId, playlistName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId, playlistName]);

  const loadOwnedPlaylists = useCallback(async (adapterInstance: MusicPlatformAdapter) => {
    setIsLoading(true);
    try {
      const { owned } = await getUserPlaylists(adapterInstance);
      setOwnedPlaylists(owned.filter((p) => p.id !== LIKED_SONGS_PLAYLIST_ID));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const adapterInstance = createSpotifyAdapter();
    setAdapter(adapterInstance);
    loadOwnedPlaylists(adapterInstance);
  }, [loadOwnedPlaylists]);

  const handleToggle = (playlist: Playlist) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(playlist.id)) next.delete(playlist.id);
      else next.add(playlist.id);
      return next;
    });
  };

  const handleCreatePlaylist = async () => {
    if (!adapter || !newPlaylistName.trim()) return;
    setIsCreating(true);
    try {
      const newId = await adapter.createPlaylist(newPlaylistName.trim());
      setShowNewPlaylistModal(false);
      setNewPlaylistName('');
      const newPlaylist: Playlist = { id: newId, name: newPlaylistName.trim(), coverArtUrl: null, trackCount: 0, isOwned: true, isFollowed: false };
      setOwnedPlaylists((prev) => [newPlaylist, ...prev]);
      setSelectedIds((prev) => new Set([...prev, newId]));
    } catch (error) {
      console.error('Playlist creation error:', error);
      Alert.alert('Error', 'Failed to create playlist. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirm = () => {
    console.log('[destination] handleConfirm — playlistId:', playlistId, 'selectedIds:', Array.from(selectedIds));
    setDestinations(Array.from(selectedIds));
    router.push({ pathname: '/(app)/swipe/[playlistId]' as const, params: { playlistId: playlistId ?? '' } });
  };

  const filteredPlaylists = ownedPlaylists.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const ListHeader = (
    <TouchableOpacity style={styles.createRow} onPress={() => setShowNewPlaylistModal(true)}>
      <Text style={styles.createIcon}>⊕</Text>
      <Text style={styles.createText}>Create New Destination</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.headerIconBtn} onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={styles.headerIconText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Select Destinations</Text>
        <View style={styles.headerIconBtn} />
      </View>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search your playlists…"
          placeholderTextColor={colors.outline}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ListHeaderComponent={ListHeader}
          data={filteredPlaylists}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PlaylistRow playlist={item} onPress={handleToggle} isSelected={selectedIds.has(item.id)} showCheckbox />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No owned playlists found. Create one below.</Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
          style={styles.list}
        />
      )}

      {/* Footer: Start Swiping */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.startBtn, selectedIds.size === 0 && styles.startBtnDisabled]}
          onPress={handleConfirm}
          disabled={selectedIds.size === 0}
        >
          <Text style={[styles.startBtnText, selectedIds.size === 0 && styles.startBtnTextDisabled]}>
            Start Swiping ⚡
          </Text>
        </TouchableOpacity>
      </View>

      {/* New Playlist Modal */}
      <Modal visible={showNewPlaylistModal} transparent animationType="fade" onRequestClose={() => setShowNewPlaylistModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Playlist</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Playlist name"
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreatePlaylist}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setShowNewPlaylistModal(false); setNewPlaylistName(''); }} style={styles.modalCancel}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCreatePlaylist}
                style={[styles.modalCreate, (!newPlaylistName.trim() || isCreating) && styles.modalCreateDisabled]}
                disabled={!newPlaylistName.trim() || isCreating}
              >
                {isCreating ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalCreateText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHigh,
  },
  headerTitle: { fontSize: 18, fontFamily: 'Outfit_700Bold', color: colors.onSurface, letterSpacing: -0.3 },
  headerIconBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerIconText: { fontSize: 20, color: colors.primary },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: spacing.md,
    paddingHorizontal: spacing.md,
    height: 48,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    gap: spacing.sm,
  },
  searchIcon: { fontSize: 18, color: colors.outline },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Outfit_400Regular', color: colors.onSurface },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { padding: 24, alignItems: 'center' },
  emptyText: { fontSize: 14, color: colors.onSurfaceVariant, textAlign: 'center', fontFamily: 'Outfit_400Regular' },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    marginTop: spacing.sm,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
  },
  createIcon: { fontSize: 22, color: colors.onSurfaceVariant },
  createText: { fontSize: 14, fontFamily: 'Outfit_600SemiBold', color: colors.onSurfaceVariant },
  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerHigh,
  },
  startBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  startBtnDisabled: { backgroundColor: colors.surfaceContainerHigh },
  startBtnText: { color: '#fff', fontFamily: 'Outfit_700Bold', fontSize: 16 },
  startBtnTextDisabled: { color: colors.onSurfaceVariant },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: 20, width: '100%', maxWidth: 360 },
  modalTitle: { fontSize: 18, fontFamily: 'Outfit_700Bold', marginBottom: 12, color: colors.onSurface },
  modalInput: {
    borderWidth: 1, borderColor: colors.outlineVariant, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontFamily: 'Outfit_400Regular',
    color: colors.onSurface, marginBottom: 16,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  modalCancel: { paddingVertical: 8, paddingHorizontal: 16 },
  modalCancelText: { color: colors.onSurfaceVariant, fontSize: 15, fontFamily: 'Outfit_400Regular' },
  modalCreate: { backgroundColor: colors.primary, paddingVertical: 8, paddingHorizontal: 20, borderRadius: radius.md, minWidth: 80, alignItems: 'center' },
  modalCreateDisabled: { opacity: 0.5 },
  modalCreateText: { color: '#fff', fontFamily: 'Outfit_700Bold', fontSize: 15 },
});
