import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSwipeStore, useActiveSession, type SessionEntry } from '@/stores/swipeStore';
import { useSessionStore } from '@/stores/sessionStore';
import { usePrefsStore } from '@/stores/prefsStore';
import { createSpotifyAdapter } from '@/auth/AuthGateway';
import { PlaylistWriter } from '@/services/PlaylistWriter';
import type { MusicPlatformAdapter, Track } from '@/adapters/interface';
import { LIKED_SONGS_PLAYLIST_ID } from '@/adapters/interface';
import { spacing, radius, type Colors } from '@/theme';
import { useTheme } from '@/hooks/useTheme';

interface SessionStats {
  swipedCount: number;
  likedCount: number;
  superLikedCount: number;
  topArtist: string;
}

function computeOptimisticStats(session: SessionEntry | null): SessionStats {
  if (!session) {
    return { swipedCount: 0, likedCount: 0, superLikedCount: 0, topArtist: '' };
  }
  const artistFreq: Record<string, number> = {};
  for (const r of session.likedSwipes) {
    const artist = r.track.artists[0] ?? r.track.artist ?? '';
    if (artist) artistFreq[artist] = (artistFreq[artist] ?? 0) + 1;
  }
  let topArtist = '';
  let topCount = 0;
  for (const [artist, count] of Object.entries(artistFreq)) {
    if (count > topCount) { topArtist = artist; topCount = count; }
  }
  return {
    swipedCount: session.swipedCount,
    likedCount: session.likedCount,
    superLikedCount: session.superLikedCount,
    topArtist,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, progress }: { label: string; value: number; progress: number }) {
  const { activeColors, isDark } = useTheme();
  const statStyles = useMemo(() => createStatStyles(activeColors), [isDark]);

  return (
    <View style={statStyles.card}>
      <Text style={statStyles.value}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
      <View style={statStyles.track}>
        <View style={[statStyles.fill, { width: `${Math.max(4, Math.round(progress * 100))}%` }]} />
      </View>
    </View>
  );
}

interface LikedTrackRowProps {
  track: Track;
  status: string;
  isRemoving: boolean;
  onRemove: () => void;
  /** When true, the remove/cancel button is hidden (used in filter mode). */
  hideRemove?: boolean;
}

function LikedTrackRow({ track, status, isRemoving, onRemove, hideRemove = false }: LikedTrackRowProps) {
  const { activeColors, isDark } = useTheme();
  const trackStyles = useMemo(() => createTrackStyles(activeColors), [isDark]);

  return (
    <View style={trackStyles.row}>
      {track.albumArtUrl ? (
        <Image source={{ uri: track.albumArtUrl }} style={trackStyles.art} contentFit="cover" />
      ) : (
        <View style={[trackStyles.art, trackStyles.artPlaceholder]} />
      )}
      <View style={trackStyles.info}>
        <Text style={trackStyles.title} numberOfLines={1}>{track.title}</Text>
        <Text style={trackStyles.artist} numberOfLines={1}>{track.artist}</Text>
      </View>
      <Text style={trackStyles.statusIcon}>{status === 'super_liked' ? '⭐' : '♥'}</Text>
      {!hideRemove && (
        isRemoving ? (
          <View style={trackStyles.removeBtn}>
            <ActivityIndicator size="small" color={activeColors.primary} />
          </View>
        ) : (
          <Pressable style={trackStyles.removeBtn} onPress={onRemove} accessibilityLabel="Remove track">
            <Text style={trackStyles.removeBtnText}>Cancel</Text>
          </Pressable>
        )
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function SessionEndScreen(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeColors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(activeColors), [isDark]);

  const sourcePlaylistName = useSessionStore((s) => s.sourcePlaylistName);
  const isFilterMode = useSessionStore((s) => s.isFilterMode);
  const { destinationPlaylistIds } = useSessionStore();
  const autoRemoveDuplicates = usePrefsStore((s) => s.autoRemoveDuplicates);

  const activeSession = useActiveSession();
  const completeActiveSession = useSwipeStore((s) => s.completeActiveSession);
  const removeSwipeFromSession = useSwipeStore((s) => s.removeSwipeFromSession);

  const [stats, setStats] = useState<SessionStats>(() => computeOptimisticStats(activeSession));
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [savedPlaylistId, setSavedPlaylistId] = useState<string | null>(null);

  // Post-session duplicate cleanup. Auto-runs once on mount when the pref is on;
  // otherwise the user triggers it with the "Remove Duplicates" button. Liked Songs
  // is excluded — the library is a set and cannot duplicate.
  const [dedupPhase, setDedupPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [dedupRemoved, setDedupRemoved] = useState(0);
  const dedupStartedRef = useRef(false);
  const regularDestinationIds = destinationPlaylistIds.filter((id) => id !== LIKED_SONGS_PLAYLIST_ID);
  // Dedup only makes sense in normal mode with real destination playlists. In filter
  // mode the source IS the playlist and there are no separate destinations to clean.
  const canDedup = !isFilterMode && regularDestinationIds.length > 0;

  const likedTracks = useMemo(() => activeSession?.likedSwipes ?? [], [activeSession]);

  const adapterRef = useRef<MusicPlatformAdapter | null>(null);
  const getAdapter = (): MusicPlatformAdapter => {
    if (!adapterRef.current) adapterRef.current = createSpotifyAdapter();
    return adapterRef.current;
  };

  // On leaving the session-end screen, mark the just-finished session completed (it stays in
  // History as a read-only card) and clear the open-session live state.
  useEffect(() => { return () => { completeActiveSession(); }; }, [completeActiveSession]);

  // Scan each destination playlist and remove duplicate tracks. Guarded by a ref so a
  // re-render (or the auto-run effect plus a manual tap) can never start it twice.
  const runDedup = useCallback(async (): Promise<void> => {
    if (dedupStartedRef.current) return;
    dedupStartedRef.current = true;
    setDedupPhase('running');
    let removed = 0;
    try {
      const adapter = getAdapter();
      for (const playlistId of regularDestinationIds) {
        removed += await adapter.removeDuplicatesFromPlaylist(playlistId);
      }
    } catch (err) {
      console.warn('[SessionEnd] removeDuplicates failed:', err);
    } finally {
      setDedupRemoved(removed);
      setDedupPhase('done');
    }
  }, [regularDestinationIds]);

  // Auto-run once on mount when the setting is on. When off, the user starts it
  // manually via the button rendered below.
  useEffect(() => {
    if (autoRemoveDuplicates && canDedup) void runDedup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRemoveTrack = useCallback(async (trackId: string): Promise<void> => {
    setRemovingIds((prev) => new Set([...prev, trackId]));
    try {
      const adapter = getAdapter();
      const writer = new PlaylistWriter(adapter);
      const record = likedTracks.find((r) => r.track.id === trackId);

      // Remove from regular playlists — this gates the UI update.
      const regularIds = destinationPlaylistIds.filter((id) => id !== LIKED_SONGS_PLAYLIST_ID);
      await writer.undoWriteAsync(trackId, regularIds);

      // Removes from both session-end and the History tab simultaneously (same SessionEntry).
      if (record && activeSession) removeSwipeFromSession(activeSession.sessionId, record.id);

      // Best-effort: also remove from Liked Songs if we added it this session.
      if (record?.likedSongsWrittenByUs === true) {
        writer.undoWriteAsync(trackId, [LIKED_SONGS_PLAYLIST_ID]).catch((err: unknown) => {
          console.warn('[SessionEnd] removeFromLikedSongs failed:', err);
        });
      }
    } catch {
      Alert.alert('Error', 'Could not remove track. Please try manually.');
    } finally {
      setRemovingIds((prev) => { const next = new Set(prev); next.delete(trackId); return next; });
    }
  }, [destinationPlaylistIds, likedTracks, activeSession, removeSwipeFromSession]);

  const handleSaveAsPlaylist = useCallback(async (): Promise<void> => {
    if (isSaving || savedPlaylistId) return;
    setIsSaving(true);
    try {
      const adapter = getAdapter();
      const playlistName = sourcePlaylistName ? `MusicSwipe – ${sourcePlaylistName}` : 'MusicSwipe Session';
      const newPlaylistId = await adapter.createPlaylist(playlistName);
      setSavedPlaylistId(newPlaylistId);
      const writer = new PlaylistWriter(adapter);
      for (const record of likedTracks) writer.write(record.track.id, [newPlaylistId]);
    } catch (err) {
      console.warn('[SessionEnd] createPlaylist failed:', err);
      Alert.alert('Error', 'Could not create playlist. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, savedPlaylistId, sourcePlaylistName, likedTracks]);

  const handleSwipeAnother = useCallback(() => { router.replace('/(tabs)'); }, [router]);

  const addedCount = stats.likedCount + stats.superLikedCount;
  const discardedCount = Math.max(0, stats.swipedCount - addedCount);
  const adapter = getAdapter();

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable style={styles.headerIconBtn} onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={styles.headerIconText}>←</Text>
        </Pressable>
        <Text style={styles.headerBrand}>MusicSwipe</Text>
        <View style={styles.headerIconBtn} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        {/* Celebration hero */}
        <View style={styles.hero}>
          <View style={styles.celebrationCircle}>
            <Text style={styles.celebrationEmoji}>🎉</Text>
          </View>
          <Text style={styles.heroTitle}>Session{'\n'}Complete</Text>
          <Text style={styles.heroSubtitle}>
            {isFilterMode
              ? "You've finished filtering. Here's what you decided to keep and delete."
              : "You've successfully curated your sound. Here is the breakdown of your latest discovery flow."}
          </Text>
        </View>

        {/* Stat cards */}
        <View style={styles.statsRow}>
          <StatCard label="SONGS SORTED" value={stats.swipedCount} progress={1} />
          <StatCard
            label={isFilterMode ? 'TRACKS KEPT' : 'ADDED TO PLAYLISTS'}
            value={addedCount}
            progress={stats.swipedCount > 0 ? addedCount / stats.swipedCount : 0}
          />
          <StatCard
            label={isFilterMode ? 'TRACKS DELETED' : 'DISCARDED'}
            value={discardedCount}
            progress={stats.swipedCount > 0 ? discardedCount / stats.swipedCount : 0}
          />
        </View>

        {/* Liked tracks (or "Tracks You Kept" in filter mode) */}
        {likedTracks.length > 0 && (
          <View style={styles.tracksSection}>
            <Text style={styles.tracksSectionTitle}>
              {isFilterMode ? 'Tracks You Kept' : 'Your Liked Tracks'}
            </Text>
            {likedTracks.map((r) => (
              <LikedTrackRow
                key={r.id}
                track={r.track}
                status={r.status}
                isRemoving={removingIds.has(r.track.id)}
                onRemove={() => void handleRemoveTrack(r.track.id)}
                // In filter mode, hide the remove button — re-deleting a kept track
                // from the session-end screen is too confusing given the inverted semantics.
                hideRemove={isFilterMode}
              />
            ))}
          </View>
        )}

        {/* Duplicate cleanup — auto-runs when the setting is on, manual button when off */}
        {canDedup && (
          <View style={styles.dedupSection}>
            {dedupPhase === 'running' ? (
              <View style={styles.dedupStatusRow}>
                <ActivityIndicator size="small" color={activeColors.primary} />
                <Text style={styles.dedupStatusText}>Tidying playlists…</Text>
              </View>
            ) : dedupPhase === 'done' ? (
              <Text style={styles.dedupStatusText}>
                {dedupRemoved > 0
                  ? `Removed ${dedupRemoved} duplicate${dedupRemoved === 1 ? '' : 's'} from your playlists`
                  : 'No duplicates found in your playlists'}
              </Text>
            ) : (
              <Pressable style={styles.dedupButton} onPress={() => void runDedup()}>
                <Text style={styles.dedupButtonText}>Remove Duplicates</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* CTAs */}
        <View style={styles.ctas}>
          {/* Save as Playlist is only meaningful in normal mode — in filter mode the source IS the playlist. */}
          {!isFilterMode && adapter.capabilities.supportsPlaylistCreation && (
            <Pressable
              style={[styles.ctaSecondary, (isSaving || !!savedPlaylistId) && styles.ctaDisabled]}
              onPress={() => void handleSaveAsPlaylist()}
              disabled={isSaving || !!savedPlaylistId}
            >
              {isSaving
                ? <ActivityIndicator color={activeColors.primary} size="small" />
                : <Text style={styles.ctaSecondaryText}>{savedPlaylistId ? 'Saved ✓' : 'Save as Playlist'}</Text>}
            </Pressable>
          )}
          <Pressable style={styles.ctaPrimary} onPress={handleSwipeAnother}>
            <Text style={styles.ctaPrimaryText}>↺  Start New Session</Text>
          </Pressable>
          <Pressable style={styles.ctaGhost} onPress={handleSwipeAnother}>
            <Text style={styles.ctaGhostText}>Done</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function createStyles(c: Colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingBottom: 12,
      backgroundColor: c.surface,
      borderBottomWidth: 1,
      borderBottomColor: c.surfaceContainerHigh,
    },
    headerBrand: { fontSize: 18, fontFamily: 'Outfit_700Bold', color: c.primary },
    headerIconBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    headerIconText: { fontSize: 20, color: c.primary },
    scroll: { paddingHorizontal: spacing.md, paddingTop: spacing.lg },
    hero: { alignItems: 'center', marginBottom: spacing.xl },
    celebrationCircle: {
      width: 80, height: 80, borderRadius: 40,
      backgroundColor: c.primary,
      justifyContent: 'center', alignItems: 'center',
      marginBottom: spacing.lg,
      shadowColor: c.primary,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 12,
      elevation: 8,
    },
    celebrationEmoji: { fontSize: 36 },
    heroTitle: { fontSize: 36, fontFamily: 'Outfit_700Bold', color: c.onSurface, textAlign: 'center', lineHeight: 42, marginBottom: spacing.md },
    heroSubtitle: { fontSize: 14, fontFamily: 'Outfit_400Regular', color: c.onSurfaceVariant, textAlign: 'center', lineHeight: 22, paddingHorizontal: spacing.lg },
    statsRow: { gap: spacing.sm, marginBottom: spacing.xl },
    tracksSection: { marginBottom: spacing.xl },
    tracksSectionTitle: { fontSize: 16, fontFamily: 'Outfit_700Bold', color: c.onSurface, marginBottom: spacing.md },
    dedupSection: { marginBottom: spacing.xl, alignItems: 'center' },
    dedupStatusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    dedupStatusText: { fontSize: 13, fontFamily: 'Outfit_400Regular', color: c.onSurfaceVariant, textAlign: 'center' },
    dedupButton: {
      paddingVertical: 12, paddingHorizontal: spacing.lg, borderRadius: radius.full,
      borderWidth: 1.5, borderColor: c.outlineVariant, alignItems: 'center',
    },
    dedupButtonText: { fontSize: 14, fontFamily: 'Outfit_600SemiBold', color: c.onSurface },
    ctas: { gap: spacing.sm },
    ctaPrimary: {
      backgroundColor: c.primary, paddingVertical: 16,
      borderRadius: radius.full, alignItems: 'center',
      shadowColor: c.primary, shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
    },
    ctaPrimaryText: { color: '#fff', fontFamily: 'Outfit_700Bold', fontSize: 16 },
    ctaSecondary: {
      paddingVertical: 14, borderRadius: radius.full, alignItems: 'center',
      borderWidth: 1.5, borderColor: c.outlineVariant,
    },
    ctaSecondaryText: { color: c.onSurface, fontFamily: 'Outfit_600SemiBold', fontSize: 15 },
    ctaDisabled: { opacity: 0.6 },
    ctaGhost: { paddingVertical: 12, alignItems: 'center' },
    ctaGhostText: { color: c.onSurfaceVariant, fontFamily: 'Outfit_500Medium', fontSize: 14 },
  });
}

function createStatStyles(c: Colors) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.surface, borderRadius: radius.xl, padding: spacing.lg,
      alignItems: 'center', borderWidth: 1, borderColor: c.surfaceContainerHigh,
    },
    value: { fontSize: 40, fontFamily: 'Outfit_700Bold', color: c.primary, lineHeight: 48 },
    label: { fontSize: 11, fontFamily: 'Outfit_600SemiBold', color: c.onSurfaceVariant, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 4, marginBottom: spacing.sm },
    track: { width: '100%', height: 6, backgroundColor: c.surfaceContainerHighest, borderRadius: 3, overflow: 'hidden' },
    fill: { height: '100%', backgroundColor: c.primary, borderRadius: 3 },
  });
}

function createTrackStyles(c: Colors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.surface, borderRadius: radius.lg, padding: 12,
      borderWidth: 1, borderColor: c.surfaceContainerHigh, marginBottom: spacing.sm,
    },
    art: { width: 48, height: 48, borderRadius: radius.md, flexShrink: 0 },
    artPlaceholder: { backgroundColor: c.surfaceContainerHigh },
    info: { flex: 1 },
    title: { fontSize: 14, fontFamily: 'Outfit_600SemiBold', color: c.onSurface },
    artist: { fontSize: 12, fontFamily: 'Outfit_400Regular', color: c.onSurfaceVariant, marginTop: 2 },
    statusIcon: { fontSize: 16, marginHorizontal: 4 },
    removeBtn: { backgroundColor: c.surfaceContainerHigh, paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.full, minWidth: 72, alignItems: 'center', justifyContent: 'center' },
    removeBtnText: { color: c.onSurfaceVariant, fontSize: 13, fontFamily: 'Outfit_600SemiBold' },
  });
}
