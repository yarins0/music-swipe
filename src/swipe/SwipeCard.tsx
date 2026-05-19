import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { Track } from '@/adapters/interface';
import { SegmentNavigator } from '@/player/SegmentNavigator';

interface SwipeCardProps {
  track: Track;
  onSeekBack: () => void;
  onSeekForward: () => void;
  isSeekEnabled: boolean;
}

export function SwipeCard({
  track,
  onSeekBack,
  onSeekForward,
  isSeekEnabled,
}: SwipeCardProps): React.ReactElement {
  return (
    <View style={styles.card}>
      <View style={styles.artContainer}>
        <Image
          source={{ uri: track.albumArtUrl }}
          style={styles.art}
          contentFit="cover"
          accessibilityLabel={`Album art for ${track.album}`}
        />
        <SegmentNavigator
          onSeekBack={onSeekBack}
          onSeekForward={onSeekForward}
          disabled={!isSeekEnabled}
        />
        {!isSeekEnabled && (
          <View style={styles.noPreviewBadge} pointerEvents="none">
            <Text style={styles.noPreviewText}>No full preview</Text>
          </View>
        )}
      </View>

      <View style={styles.overlay} pointerEvents="none">
        <Text style={styles.title} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {track.artist}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    aspectRatio: 0.72,
  },
  artContainer: {
    flex: 1,
    position: 'relative',
  },
  art: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  title: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  artist: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '400',
  },
  noPreviewBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  noPreviewText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    fontWeight: '500',
  },
});
