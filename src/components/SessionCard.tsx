import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { spacing, radius, type Colors } from '@/theme';
import { useTheme } from '@/hooks/useTheme';
import { isResumable, type SessionEntry } from '@/stores/swipeStore';
import type { SwipeRecord } from '@/stores/sessionTypes';

type StylesType = ReturnType<typeof createStyles>;

interface SessionCardProps {
  session: SessionEntry;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onResume: () => void;
  /** Remove one liked track (identified by its record id) from this session. */
  onRemoveTrack: (recordId: string) => void;
  /** Record ids currently mid-removal — shows a spinner instead of the Cancel button. */
  removingIds: Set<string>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface LikedRowProps {
  record: SwipeRecord;
  isRemoving: boolean;
  onRemove: () => void;
  styles: StylesType;
  activeColors: Colors;
}

function LikedRow({ record, isRemoving, onRemove, styles, activeColors }: LikedRowProps): React.ReactElement {
  return (
    <View style={styles.trackRow}>
      {/* Restored sessions may carry tracks with null art; passing uri:null to expo-image errors,
          so render the styled placeholder instead — mirrors PlaylistRow's coverArtUrl guard. */}
      {record.track.albumArtUrl ? (
        <Image source={{ uri: record.track.albumArtUrl }} style={styles.thumb} contentFit="cover" />
      ) : (
        <View style={styles.thumb} />
      )}
      <View style={styles.trackInfo}>
        <Text style={styles.trackTitle} numberOfLines={1}>{record.track.title}</Text>
        <Text style={styles.trackArtist} numberOfLines={1}>{record.track.artist}</Text>
      </View>
      <Text style={styles.statusIcon}>{record.status === 'super_liked' ? '⭐' : '♥'}</Text>
      {isRemoving ? (
        <View style={styles.removeBtn}><ActivityIndicator size="small" color={activeColors.primary} /></View>
      ) : (
        <Pressable style={styles.removeBtn} onPress={onRemove} accessibilityLabel="Remove track">
          <Text style={styles.removeText}>Cancel</Text>
        </Pressable>
      )}
    </View>
  );
}

/** One session in the History tab: summary + Resume/Completed, expandable to its liked tracks. */
export function SessionCard({
  session,
  isExpanded,
  onToggleExpand,
  onResume,
  onRemoveTrack,
  removingIds,
}: SessionCardProps): React.ReactElement {
  const { activeColors } = useTheme();
  const styles = useMemo(() => createStyles(activeColors), [activeColors]);

  const resumable = isResumable(session);
  const progress = session.totalTracks > 0 ? session.resumeOffset / session.totalTracks : 0;
  const tracksLeft = Math.max(0, session.totalTracks - session.resumeOffset);
  const added = session.likedCount + session.superLikedCount;
  const destLabel =
    session.destinationPlaylistNames.length > 0
      ? session.destinationPlaylistNames.join(', ')
      : session.isFilterMode
        ? 'Filter mode'
        : 'No destinations';

  return (
    <View style={styles.card}>
      <Pressable style={styles.header} onPress={onToggleExpand} accessibilityRole="button">
        <View style={styles.headerText}>
          <Text style={styles.source} numberOfLines={1}>{session.sourcePlaylistName}</Text>
          <Text style={styles.dest} numberOfLines={1}>→ {destLabel}</Text>
        </View>
        <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color={activeColors.onSurfaceVariant} />
      </Pressable>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>{added} added · {session.swipedCount} sorted</Text>
        <Text style={styles.date}>{formatDate(session.updatedAt)}</Text>
      </View>

      {resumable ? (
        <Pressable style={styles.resumeBtn} onPress={onResume} accessibilityRole="button">
          <Ionicons name="play" size={15} color="#fff" />
          <Text style={styles.resumeText}>Resume · {tracksLeft} left</Text>
        </Pressable>
      ) : (
        <View style={styles.completedBadge}>
          <Text style={styles.completedText}>Completed</Text>
        </View>
      )}

      {isExpanded && (
        session.likedSwipes.length > 0 ? (
          <View style={styles.tracks}>
            {[...session.likedSwipes].reverse().map((record) => (
              <LikedRow
                key={record.id}
                record={record}
                isRemoving={removingIds.has(record.id)}
                onRemove={() => onRemoveTrack(record.id)}
                styles={styles}
                activeColors={activeColors}
              />
            ))}
          </View>
        ) : (
          <Text style={styles.emptyTracks}>No liked tracks in this session</Text>
        )
      )}
    </View>
  );
}

function createStyles(c: Colors) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.surfaceContainerHigh,
      padding: spacing.md,
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
      gap: spacing.sm,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    headerText: { flex: 1, gap: 2 },
    source: { fontSize: 15, fontFamily: 'Outfit_700Bold', color: c.onSurface },
    dest: { fontSize: 12, fontFamily: 'Outfit_400Regular', color: c.onSurfaceVariant },
    progressTrack: { height: 6, backgroundColor: c.surfaceContainerHighest, borderRadius: 3, overflow: 'hidden' },
    progressFill: { height: '100%', backgroundColor: c.primary, borderRadius: 3 },
    metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    meta: { fontSize: 12, fontFamily: 'Outfit_600SemiBold', color: c.onSurfaceVariant },
    date: { fontSize: 11, fontFamily: 'Outfit_400Regular', color: c.outlineVariant },
    resumeBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: c.primary, paddingVertical: 11, borderRadius: radius.full,
    },
    resumeText: { color: '#fff', fontFamily: 'Outfit_600SemiBold', fontSize: 14 },
    completedBadge: { alignSelf: 'flex-start', backgroundColor: c.surfaceContainerHigh, paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.full },
    completedText: { color: c.onSurfaceVariant, fontFamily: 'Outfit_600SemiBold', fontSize: 12 },
    tracks: { gap: spacing.sm, marginTop: 4 },
    emptyTracks: { fontSize: 13, fontFamily: 'Outfit_400Regular', color: c.onSurfaceVariant, textAlign: 'center', paddingVertical: spacing.sm },
    trackRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    thumb: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: c.surfaceContainerHigh },
    trackInfo: { flex: 1 },
    trackTitle: { fontSize: 14, fontFamily: 'Outfit_600SemiBold', color: c.onSurface },
    trackArtist: { fontSize: 12, fontFamily: 'Outfit_400Regular', color: c.onSurfaceVariant, marginTop: 2 },
    statusIcon: { fontSize: 15, marginHorizontal: 2 },
    removeBtn: { backgroundColor: c.surfaceContainerHigh, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
    removeText: { color: c.onSurfaceVariant, fontSize: 12, fontFamily: 'Outfit_600SemiBold' },
  });
}
