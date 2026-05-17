import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import type { Playlist } from '@/adapters/interface';
import { LIKED_SONGS_PLAYLIST_ID } from '@/adapters/interface';

interface PlaylistRowProps {
  playlist: Playlist;
  onPress: (playlist: Playlist) => void;
  isSelected?: boolean;
  showCheckbox?: boolean;
}

export function PlaylistRow({
  playlist,
  onPress,
  isSelected = false,
  showCheckbox = false,
}: PlaylistRowProps) {
  const isLikedSongs = playlist.id === LIKED_SONGS_PLAYLIST_ID;

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => onPress(playlist)}
      accessibilityRole="button"
      accessibilityLabel={`${playlist.name}, ${playlist.trackCount} tracks`}
      accessibilityState={{ selected: isSelected }}
    >
      {isLikedSongs ? (
        <View style={[styles.thumbnail, styles.likedSongsThumbnail]}>
          <Text style={styles.heartIcon}>♥</Text>
        </View>
      ) : playlist.coverArtUrl ? (
        <Image
          source={{ uri: playlist.coverArtUrl }}
          style={styles.thumbnail}
          contentFit="cover"
        />
      ) : (
        <View style={[styles.thumbnail, styles.placeholderThumbnail]} />
      )}

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{playlist.name}</Text>
        <Text style={styles.trackCount}>{playlist.trackCount} tracks</Text>
      </View>

      {showCheckbox && (
        <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
          {isSelected && <Text style={styles.checkmark}>✓</Text>}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  thumbnail: {
    width: 48,
    height: 48,
    borderRadius: 4,
    marginRight: 12,
  },
  likedSongsThumbnail: {
    backgroundColor: '#7b2dbd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heartIcon: {
    color: '#fff',
    fontSize: 22,
  },
  placeholderThumbnail: {
    backgroundColor: '#e5e7eb',
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: '500',
    color: '#111',
  },
  trackCount: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#d1d5db',
    marginLeft: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#1DB954',
    borderColor: '#1DB954',
  },
  checkmark: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
