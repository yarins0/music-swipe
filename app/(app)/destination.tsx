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
import { createSpotifyAdapter } from '@/auth/AuthGateway';
import { getUserPlaylists } from '@/playlist/PlaylistResolver';
import { PlaylistRow } from '@/components/PlaylistRow';
import { useSessionStore } from '@/stores/sessionStore';
import { LIKED_SONGS_PLAYLIST_ID } from '@/adapters/interface';
import type { Playlist, MusicPlatformAdapter } from '@/adapters/interface';

export default function DestinationPickerScreen() {
  const router = useRouter();
  const { playlistId, playlistName } = useLocalSearchParams<{
    playlistId: string;
    playlistName: string;
  }>();

  const setSource = useSessionStore((s) => s.setSource);
  const setDestinations = useSessionStore((s) => s.setDestinations);

  const [ownedPlaylists, setOwnedPlaylists] = useState<Playlist[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [adapter, setAdapter] = useState<MusicPlatformAdapter | null>(null);

  // New playlist modal state
  const [showNewPlaylistModal, setShowNewPlaylistModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (playlistId && playlistName) {
      setSource(playlistId, playlistName);
    }
    // setSource is a stable Zustand action — intentionally omitted from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId, playlistName]);

  const loadOwnedPlaylists = useCallback(async (adapterInstance: MusicPlatformAdapter) => {
    setIsLoading(true);
    try {
      const { owned } = await getUserPlaylists(adapterInstance);
      // Destination picker excludes Liked Songs — super like writes there via saveToLibrary()
      const writable = owned.filter((p) => p.id !== LIKED_SONGS_PLAYLIST_ID);
      setOwnedPlaylists(writable);
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
      if (next.has(playlist.id)) {
        next.delete(playlist.id);
      } else {
        next.add(playlist.id);
      }
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
      // Add the new playlist to the list and pre-select it
      const newPlaylist: Playlist = {
        id: newId,
        name: newPlaylistName.trim(),
        coverArtUrl: null,
        trackCount: 0,
        isOwned: true,
        isFollowed: false,
      };
      setOwnedPlaylists((prev) => [newPlaylist, ...prev]);
      setSelectedIds((prev) => new Set([...prev, newId]));
    } catch {
      Alert.alert('Error', 'Failed to create playlist. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirm = () => {
    setDestinations(Array.from(selectedIds));
    router.push({
      pathname: '/(app)/swipe/[playlistId]',
      params: { playlistId: playlistId ?? '' },
    });
  };

  const ListHeader = (
    <TouchableOpacity
      style={styles.newPlaylistRow}
      onPress={() => setShowNewPlaylistModal(true)}
    >
      <View style={styles.newPlaylistIcon}>
        <Text style={styles.plusSign}>+</Text>
      </View>
      <Text style={styles.newPlaylistText}>New Playlist</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.screenTitle}>Choose Destinations</Text>
      <Text style={styles.subtitle}>Liked tracks will be added to all selected playlists</Text>

      {isLoading ? (
        <ActivityIndicator size="large" style={styles.loader} />
      ) : (
        <FlatList
          data={ownedPlaylists}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PlaylistRow
              playlist={item}
              onPress={handleToggle}
              isSelected={selectedIds.has(item.id)}
              showCheckbox
            />
          )}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                You have no owned playlists yet. Create one above.
              </Text>
            </View>
          }
          style={styles.list}
        />
      )}

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.confirmButton, selectedIds.size === 0 && styles.confirmDisabled]}
          onPress={handleConfirm}
          disabled={selectedIds.size === 0}
        >
          <Text style={styles.confirmText}>
            Confirm ({selectedIds.size} selected)
          </Text>
        </TouchableOpacity>
      </View>

      {/* New Playlist Modal (Android-compatible) */}
      <Modal
        visible={showNewPlaylistModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNewPlaylistModal(false)}
      >
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
              <TouchableOpacity
                onPress={() => { setShowNewPlaylistModal(false); setNewPlaylistName(''); }}
                style={styles.modalCancel}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCreatePlaylist}
                style={[styles.modalCreate, (!newPlaylistName.trim() || isCreating) && styles.modalCreateDisabled]}
                disabled={!newPlaylistName.trim() || isCreating}
              >
                {isCreating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalCreateText}>Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  screenTitle: { fontSize: 22, fontWeight: '700', paddingHorizontal: 16, paddingTop: 16, color: '#111' },
  subtitle: { fontSize: 14, color: '#6b7280', paddingHorizontal: 16, paddingBottom: 12 },
  loader: { marginTop: 40 },
  list: { flex: 1 },
  newPlaylistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  newPlaylistIcon: {
    width: 48,
    height: 48,
    borderRadius: 4,
    backgroundColor: '#e5e7eb',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  plusSign: { fontSize: 24, color: '#6b7280' },
  newPlaylistText: { fontSize: 15, fontWeight: '500', color: '#374151' },
  empty: { padding: 24, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#6b7280', textAlign: 'center' },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  confirmButton: {
    backgroundColor: '#1DB954',
    paddingVertical: 14,
    borderRadius: 50,
    alignItems: 'center',
  },
  confirmDisabled: { backgroundColor: '#d1fae5', opacity: 0.5 },
  confirmText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 360,
  },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12, color: '#111' },
  modalInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111',
    marginBottom: 16,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  modalCancel: { paddingVertical: 8, paddingHorizontal: 16 },
  modalCancelText: { color: '#6b7280', fontSize: 15 },
  modalCreate: {
    backgroundColor: '#1DB954',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  modalCreateDisabled: { opacity: 0.5 },
  modalCreateText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
