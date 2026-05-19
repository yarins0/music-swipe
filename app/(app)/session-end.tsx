import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { useSwipeStore } from '@/stores/swipeStore';
import { useSessionStore } from '@/stores/sessionStore';
import { createSpotifyAdapter } from '@/auth/AuthGateway';
import { PlaylistWriter } from '@/services/PlaylistWriter';
import { SessionMosaicGrid } from '@/matches/SessionMosaicGrid';
import type { MusicPlatformAdapter } from '@/adapters/interface';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

interface SessionStats {
  swipedCount: number;
  likedCount: number;
  superLikedCount: number;
  topArtist: string;
}

function computeOptimisticStats(
  pendingSyncSwipes: ReturnType<typeof useSwipeStore.getState>['pendingSyncSwipes'],
): SessionStats {
  const likedRecords = pendingSyncSwipes.filter(
    (r) => r.status === 'liked' || r.status === 'super_liked',
  );

  const likedCount = pendingSyncSwipes.filter((r) => r.status === 'liked').length;
  const superLikedCount = pendingSyncSwipes.filter((r) => r.status === 'super_liked').length;

  // Frequency count over first artist per track
  const artistFreq: Record<string, number> = {};
  for (const r of likedRecords) {
    const artist = r.track.artists[0] ?? r.track.artist ?? '';
    if (artist) {
      artistFreq[artist] = (artistFreq[artist] ?? 0) + 1;
    }
  }

  let topArtist = '';
  let topCount = 0;
  for (const [artist, count] of Object.entries(artistFreq)) {
    if (count > topCount) {
      topArtist = artist;
      topCount = count;
    }
  }

  return {
    swipedCount: pendingSyncSwipes.length,
    likedCount,
    superLikedCount,
    topArtist,
  };
}

export default function SessionEndScreen(): React.ReactElement {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();

  const supabaseToken = useAuthStore((s) => s.supabaseToken);
  const sourcePlaylistName = useSessionStore((s) => s.sourcePlaylistName);

  const pendingSyncSwipes = useSwipeStore((s) => s.pendingSyncSwipes);
  const clearSession = useSwipeStore((s) => s.clearSession);

  const [stats, setStats] = useState<SessionStats>(() =>
    computeOptimisticStats(pendingSyncSwipes),
  );

  const likedTracks = pendingSyncSwipes.filter(
    (r) => r.status === 'liked' || r.status === 'super_liked',
  );
  const albumArtUrls = likedTracks.map((r) => r.track.albumArtUrl).filter(Boolean);

  const adapterRef = useRef<MusicPlatformAdapter | null>(null);
  const getAdapter = (): MusicPlatformAdapter => {
    if (!adapterRef.current) {
      adapterRef.current = createSpotifyAdapter();
    }
    return adapterRef.current;
  };

  const [isSaving, setIsSaving] = useState(false);
  const [savedPlaylistId, setSavedPlaylistId] = useState<string | null>(null);

  // Fetch authoritative stats from backend, update when resolved
  useEffect(() => {
    if (!sessionId || !supabaseToken) return;

    const fetchStats = async (): Promise<void> => {
      try {
        const response = await fetch(`${BACKEND_URL}/sessions/${sessionId}`, {
          headers: { Authorization: `Bearer ${supabaseToken}` },
        });
        if (!response.ok) return;

        const data = (await response.json()) as {
          swipe_count?: number;
          liked_count?: number;
          super_liked_count?: number;
        };

        setStats((prev) => ({
          ...prev,
          swipedCount: data.swipe_count ?? prev.swipedCount,
          likedCount: data.liked_count ?? prev.likedCount,
          superLikedCount: data.super_liked_count ?? prev.superLikedCount,
        }));
      } catch {
        // Keep optimistic counts on failure
      }
    };

    void fetchStats();
  }, [sessionId, supabaseToken]);

  // Deferred clearSession — fires on unmount as per architecture decision MEM001
  useEffect(() => {
    return () => {
      clearSession();
    };
  }, [clearSession]);

  const handleSaveAsPlaylist = useCallback(async (): Promise<void> => {
    if (isSaving || savedPlaylistId) return;
    setIsSaving(true);

    try {
      const adapter = getAdapter();
      const playlistName = sourcePlaylistName
        ? `MusicSwipe – ${sourcePlaylistName}`
        : 'MusicSwipe Session';

      const newPlaylistId = await adapter.createPlaylist(playlistName);
      setSavedPlaylistId(newPlaylistId);

      // Fire-and-forget writes — must not block UI
      const writer = new PlaylistWriter(adapter);
      for (const record of likedTracks) {
        writer.write(record.track.id, [newPlaylistId]);
      }
    } catch (err) {
      console.warn('[SessionEnd] createPlaylist failed:', err);
      Alert.alert('Error', 'Could not create playlist. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, savedPlaylistId, sourcePlaylistName, likedTracks]);

  const handleViewMatches = useCallback((): void => {
    router.push({
      pathname: '/(app)/matches' as const,
      params: sessionId ? { sessionId } : {},
    });
  }, [router, sessionId]);

  const adapter = getAdapter();
  const supportsPlaylistCreation = adapter.capabilities.supportsPlaylistCreation;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Session Complete</Text>

      <SessionMosaicGrid albumArtUrls={albumArtUrls} />

      <View style={styles.statsRow}>
        <Text style={styles.statsText}>
          {stats.swipedCount} swiped · {stats.likedCount} liked · {stats.superLikedCount} super-liked
        </Text>
        {stats.topArtist ? (
          <Text style={styles.topArtistText}>Top artist: {stats.topArtist}</Text>
        ) : null}
      </View>

      {supportsPlaylistCreation && (
        <Pressable
          style={[styles.ctaButton, (isSaving || !!savedPlaylistId) && styles.ctaButtonDisabled]}
          onPress={() => void handleSaveAsPlaylist()}
          disabled={isSaving || !!savedPlaylistId}
        >
          {isSaving ? (
            <ActivityIndicator color="#000" size="small" />
          ) : savedPlaylistId ? (
            <Text style={styles.ctaText}>Saved!</Text>
          ) : (
            <Text style={styles.ctaText}>Save as playlist</Text>
          )}
        </Pressable>
      )}

      <Pressable style={styles.secondaryButton} onPress={handleViewMatches}>
        <Text style={styles.secondaryText}>View Matches</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    alignItems: 'center',
    paddingTop: 64,
    paddingHorizontal: 24,
    gap: 24,
  },
  heading: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  statsRow: {
    alignItems: 'center',
    gap: 6,
  },
  statsText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 15,
  },
  topArtistText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
  },
  ctaButton: {
    backgroundColor: '#1DB954',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 50,
    minWidth: 200,
    alignItems: 'center',
  },
  ctaButtonDisabled: {
    opacity: 0.6,
  },
  ctaText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    minWidth: 200,
    alignItems: 'center',
  },
  secondaryText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    fontWeight: '600',
  },
});
