import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { Track } from '@/adapters/interface';
import { SegmentNavigator } from '@/player/SegmentNavigator';
import { colors } from '@/theme';

interface SwipeCardProps {
  track: Track;
  onSeekBack: () => void;
  onSeekForward: () => void;
  isSeekEnabled: boolean;
  /** When false, replaces the album art image with a solid background and a musical-note icon. */
  showAlbumArt?: boolean;
}

export function SwipeCard({
  track,
  onSeekBack,
  onSeekForward,
  isSeekEnabled,
  showAlbumArt = true,
}: SwipeCardProps): React.ReactElement {
  return (
    <View style={styles.card}>
      {showAlbumArt ? (
        <Image
          source={{ uri: track.albumArtUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          accessibilityLabel={`Album art for ${track.album}`}
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={styles.artPlaceholder}>
          <Ionicons name="musical-note" size={48} color={colors.onSurfaceVariant} />
        </View>
      )}

      {/* Dark gradient overlay */}
      <View style={styles.gradientOverlay} pointerEvents="none" />

      {/* Seek zones */}
      <SegmentNavigator
        onSeekBack={onSeekBack}
        onSeekForward={onSeekForward}
        disabled={!isSeekEnabled}
      />

      {/* Track info at bottom */}
      <View style={styles.infoOverlay} pointerEvents="none">
        <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>{track.artist}</Text>
      </View>

      {!isSeekEnabled && (
        <View style={styles.noPreviewBadge} pointerEvents="none">
          <Text style={styles.noPreviewText}>No full preview</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 10,
  },
  artPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surfaceContainerHigh,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gradientOverlay: {
    ...StyleSheet.absoluteFillObject,
    // Bottom-heavy dark fade for legible text
    backgroundColor: 'transparent',
    // Simulated gradient via two layered views
  },
  infoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 80,
    // Simulated gradient using backgroundColor with opacity
    backgroundColor: 'rgba(0,0,0,0)',
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontFamily: 'Outfit_700Bold',
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  artist: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    fontFamily: 'Outfit_400Regular',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  noPreviewBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  noPreviewText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    fontFamily: 'Outfit_500Medium',
  },
});
