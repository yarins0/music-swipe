import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { Track } from '@/adapters/interface';
import { SegmentNavigator } from '@/player/SegmentNavigator';
import { TrackProgressDots } from '@/swipe/TrackProgressDots';
import { type Colors } from '@/theme';
import { useTheme } from '@/hooks/useTheme';

interface SwipeCardProps {
  track: Track;
  onSeekBack: () => void;
  onSeekForward: () => void;
  isSeekEnabled: boolean;
  /** Number of playback segments the track is divided into — drives TrackProgressDots. */
  totalSegments: number;
  /** Index of the segment currently playing — drives TrackProgressDots. */
  currentSegment: number;
  /** When false, replaces the album art image with a solid background and a musical-note icon. */
  showAlbumArt?: boolean;
  /**
   * When provided, the "Audio unavailable" badge becomes tappable and calls this — used by
   * the front card to send the user to the Auto-play Music setting. Omitted on the back
   * card so it stays non-interactive.
   */
  onAudioUnavailablePress?: () => void;
}

export function SwipeCard({
  track,
  onSeekBack,
  onSeekForward,
  isSeekEnabled,
  totalSegments,
  currentSegment,
  showAlbumArt = true,
  onAudioUnavailablePress,
}: SwipeCardProps): React.ReactElement {
  const { activeColors } = useTheme();
  const styles = useMemo(() => createStyles(activeColors), [activeColors]);

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
          <Ionicons name="musical-note" size={48} color={activeColors.onSurfaceVariant} />
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
        <TrackProgressDots totalSegments={totalSegments} currentSegment={currentSegment} />
      </View>

      {!isSeekEnabled && (
        onAudioUnavailablePress ? (
          // Tappable on the front card: routes to the Auto-play Music setting. A corner
          // tap won't trigger the swipe pan (which only activates on movement).
          <Pressable
            style={styles.audioUnavailableBadge}
            onPress={onAudioUnavailablePress}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Audio unavailable — open playback settings"
          >
            <Text style={styles.audioUnavailableText}>Audio unavailable</Text>
          </Pressable>
        ) : (
          <View style={styles.audioUnavailableBadge} pointerEvents="none">
            <Text style={styles.audioUnavailableText}>Audio unavailable</Text>
          </View>
        )
      )}
    </View>
  );
}

function createStyles(c: Colors) {
  return StyleSheet.create({
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
      backgroundColor: c.surfaceContainerHigh,
      justifyContent: 'center',
      alignItems: 'center',
    },
    gradientOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'transparent',
    },
    infoOverlay: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      paddingHorizontal: 20,
      paddingBottom: 24,
      paddingTop: 80,
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
    audioUnavailableBadge: {
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
    audioUnavailableText: {
      color: 'rgba(255,255,255,0.8)',
      fontSize: 11,
      fontFamily: 'Outfit_500Medium',
    },
  });
}
