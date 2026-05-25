import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import type { Playlist } from '@/adapters/interface';
import { LIKED_SONGS_PLAYLIST_ID } from '@/adapters/interface';
import { colors, radius, spacing } from '@/theme';

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
      style={[styles.row, isSelected && styles.rowSelected]}
      onPress={() => onPress(playlist)}
      accessibilityRole="button"
      accessibilityLabel={`${playlist.name}, ${playlist.trackCount} tracks`}
      accessibilityState={{ selected: isSelected }}
      activeOpacity={0.75}
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
        <Text style={styles.trackCount}>
          {isLikedSongs ? `Auto-updating · ${playlist.trackCount} songs` : `${playlist.trackCount} songs`}
        </Text>
      </View>

      {showCheckbox && (
        <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
          {isSelected && <Text style={styles.checkmark}>✓</Text>}
        </View>
      )}

      {!showCheckbox && isSelected && (
        <View style={styles.selectedIndicator}>
          <Text style={styles.selectedCheck}>✓</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHigh,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
  },
  rowSelected: {
    borderColor: colors.primary,
    backgroundColor: '#fff5f7',
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    marginRight: spacing.md,
    flexShrink: 0,
  },
  likedSongsThumbnail: {
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heartIcon: { color: '#fff', fontSize: 22 },
  placeholderThumbnail: { backgroundColor: colors.surfaceContainerHigh },
  info: { flex: 1 },
  name: {
    fontSize: 15,
    fontFamily: 'Outfit_600SemiBold',
    color: colors.onSurface,
  },
  trackCount: {
    fontSize: 12,
    fontFamily: 'Outfit_400Regular',
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    marginLeft: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: { color: '#fff', fontSize: 12, fontFamily: 'Outfit_700Bold' },
  selectedIndicator: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  selectedCheck: { color: '#fff', fontSize: 12, fontFamily: 'Outfit_700Bold' },
});
