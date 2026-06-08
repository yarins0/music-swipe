import { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import type { Playlist } from '@/adapters/interface';
import { LIKED_SONGS_PLAYLIST_ID } from '@/adapters/interface';
import { radius, spacing, type Colors } from '@/theme';
import { useTheme } from '@/hooks/useTheme';

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
  const { activeColors } = useTheme();
  const styles = useMemo(() => createStyles(activeColors), [activeColors]);

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

function createStyles(c: Colors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.surfaceContainerHigh,
      borderRadius: radius.lg,
      marginBottom: spacing.sm,
    },
    rowSelected: {
      borderColor: c.primary,
      backgroundColor: c.surfaceContainerHigh,
    },
    thumbnail: {
      width: 56,
      height: 56,
      borderRadius: radius.md,
      marginRight: spacing.md,
      flexShrink: 0,
    },
    likedSongsThumbnail: {
      backgroundColor: c.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    heartIcon: { color: '#fff', fontSize: 22 },
    placeholderThumbnail: { backgroundColor: c.surfaceContainerHigh },
    info: { flex: 1 },
    name: {
      fontSize: 15,
      fontFamily: 'Outfit_600SemiBold',
      color: c.onSurface,
    },
    trackCount: {
      fontSize: 12,
      fontFamily: 'Outfit_400Regular',
      color: c.onSurfaceVariant,
      marginTop: 2,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: radius.full,
      borderWidth: 2,
      borderColor: c.outlineVariant,
      marginLeft: spacing.sm,
      justifyContent: 'center',
      alignItems: 'center',
    },
    checkboxSelected: {
      backgroundColor: c.primary,
      borderColor: c.primary,
    },
    checkmark: { color: '#fff', fontSize: 12, fontFamily: 'Outfit_700Bold' },
    selectedIndicator: {
      width: 24,
      height: 24,
      borderRadius: radius.full,
      backgroundColor: c.primary,
      justifyContent: 'center',
      alignItems: 'center',
      marginLeft: spacing.sm,
    },
    selectedCheck: { color: '#fff', fontSize: 12, fontFamily: 'Outfit_700Bold' },
  });
}
