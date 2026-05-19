import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, AppStateStatus, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useSwipeStore } from '@/stores/swipeStore';
import { SwipeEngine } from '@/swipe/SwipeEngine';
import { createSpotifyAdapter } from '@/auth/AuthGateway';
import { TrackPlayer } from '@/player/TrackPlayer';
import { PlaylistWriter } from '@/services/PlaylistWriter';
import { SessionTracker } from '@/services/SessionTracker';
import { BackendSync } from '@/services/BackendSync';
import type { MusicPlatformAdapter, Playlist, Track } from '@/adapters/interface';
import { usePreviewPlayer } from '@/player/usePreviewPlayer';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

type InitPhase =
  | 'hydrating'
  | 'flushing'
  | 'fetching_pending'
  | 'fetching_queue'
  | 'opening_session'
  | 'ready'
  | 'error';

export default function SwipeScreen(): React.ReactElement {
  const { playlistId } = useLocalSearchParams<{ playlistId: string }>();
  const router = useRouter();

  const supabaseToken = useAuthStore((s) => s.supabaseToken);
  const { destinationPlaylistIds } = useSessionStore();

  const swipeStore = useSwipeStore();
  const { initSession, clearSession } = swipeStore;

  // Service refs — stable across re-renders, never re-instantiated after mount
  const adapterRef = useRef<MusicPlatformAdapter | null>(null);
  const trackPlayerRef = useRef<TrackPlayer | null>(null);
  const playlistWriterRef = useRef<PlaylistWriter | null>(null);
  const sessionTrackerRef = useRef<SessionTracker | null>(null);
  const backendSyncRef = useRef<BackendSync | null>(null);

  // Preview player hook (wired once TrackPlayer is constructed)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  usePreviewPlayer(previewUrl);

  const [phase, setPhase] = useState<InitPhase>('hydrating');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [availablePlaylists, setAvailablePlaylists] = useState<Playlist[]>([]);

  // Tracks whether unmount already closed the session (prevents double-close)
  const sessionClosedRef = useRef(false);

  // -------------------------------------------------------------------------
  // Service factory — runs once after auth tokens are available
  // -------------------------------------------------------------------------
  const buildServices = useCallback((): boolean => {
    if (!supabaseToken) return false;
    if (adapterRef.current) return true; // already built

    const adapter = createSpotifyAdapter();
    adapterRef.current = adapter;

    trackPlayerRef.current = new TrackPlayer(adapter, setPreviewUrl);
    playlistWriterRef.current = new PlaylistWriter(adapter);
    sessionTrackerRef.current = new SessionTracker(BACKEND_URL, supabaseToken);
    backendSyncRef.current = new BackendSync(BACKEND_URL, supabaseToken);

    return true;
  }, [supabaseToken]);

  // -------------------------------------------------------------------------
  // Init sequence: 5 phases in order
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'hydrating') return;

    // Phase 1: wait for Zustand persist to rehydrate from AsyncStorage
    if (useSwipeStore.persist.hasHydrated()) {
      setPhase('flushing');
      return;
    }

    // Subscribe to the onFinishHydration callback instead of polling
    const unsub = useSwipeStore.persist.onFinishHydration(() => {
      setPhase('flushing');
    });
    return unsub;
  }, [phase]);

  useEffect(() => {
    if (phase !== 'flushing') return;
    if (!buildServices()) {
      setErrorMessage('Auth tokens unavailable. Please log in again.');
      setPhase('error');
      return;
    }

    // Phase 2: flush pending sync swipes from a prior crashed session
    const flush = async (): Promise<void> => {
      const pending = useSwipeStore.getState().pendingSyncSwipes;
      if (pending.length > 0) {
        try {
          await backendSyncRef.current!.flushPending();
          // Mark each as synced using its swipedAt timestamp
          for (const record of pending) {
            useSwipeStore.getState().markSynced(record.swipedAt);
          }
        } catch {
          // flush failure is non-fatal — pending will retry on next AppState reconnect
          console.warn('[SwipeScreen] pendingSyncSwipes flush failed; will retry on reconnect');
        }
      }
      setPhase('fetching_pending');
    };

    void flush();
  }, [phase, buildServices]);

  useEffect(() => {
    if (phase !== 'fetching_pending') return;

    // Phase 3: fetch decide-later tracks from backend (status=pending for this playlist)
    const fetchPending = async (): Promise<Track[]> => {
      try {
        const url = `${BACKEND_URL}/swipes?status=pending&source_playlist_id=${encodeURIComponent(playlistId)}`;
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${supabaseToken}` },
        });

        if (!response.ok) {
          console.warn('[SwipeScreen] GET /swipes?status=pending failed:', response.status);
          return [];
        }

        const data = (await response.json()) as {
          swipes: {
            spotifyTrackId: string;
            metadata?: {
              title?: string;
              artist?: string;
              album?: string;
              albumArtUrl?: string;
              durationMs?: number;
              previewUrl?: string | null;
            };
          }[];
        };

        // Map backend metadata directly to Track shape
        return (data.swipes ?? []).map((s) => ({
          id: s.spotifyTrackId,
          uri: `spotify:track:${s.spotifyTrackId}`,
          title: s.metadata?.title ?? s.spotifyTrackId,
          artist: s.metadata?.artist ?? '',
          artists: s.metadata?.artist ? [s.metadata.artist] : [],
          album: s.metadata?.album ?? '',
          albumArtUrl: s.metadata?.albumArtUrl ?? '',
          durationMs: s.metadata?.durationMs ?? 0,
          previewUrl: s.metadata?.previewUrl ?? null,
        }));
      } catch (err) {
        console.warn('[SwipeScreen] fetchPendingTracks error:', err);
        return [];
      }
    };

    fetchPending().then((pendingTracks) => {
      // Stash pending tracks in the ref for use in phase 4
      pendingTracksRef.current = pendingTracks;
      setPhase('fetching_queue');
    });
  }, [phase, playlistId, supabaseToken]);

  const pendingTracksRef = useRef<Track[]>([]);

  useEffect(() => {
    if (phase !== 'fetching_queue') return;

    // Phase 4: fetch playlist tracks from adapter; resume from currentIndex if session exists
    const fetchQueue = async (): Promise<void> => {
      try {
        const adapter = adapterRef.current!;
        const storedIndex = useSwipeStore.getState().currentIndex;
        const isResuming = useSwipeStore.getState().sessionId !== null;

        // Fetch all tracks — paginate if needed (simple single-page fetch for now)
        const { tracks } = await adapter.getPlaylistTracks(playlistId, 0, 100);

        // On resume, slice from currentIndex so already-decided tracks are skipped
        const queueTracks = isResuming ? tracks.slice(storedIndex) : tracks;

        // Also fetch available playlists for the destination editor
        const playlists = await adapter.getUserPlaylists();
        setAvailablePlaylists(playlists);

        // Stash for phase 5
        queueTracksRef.current = queueTracks;
        setPhase('opening_session');
      } catch (err) {
        console.error('[SwipeScreen] fetchQueue failed:', err);
        setErrorMessage('Could not load playlist. Please try again.');
        setPhase('error');
      }
    };

    void fetchQueue();
  }, [phase, playlistId]);

  const queueTracksRef = useRef<Track[]>([]);

  useEffect(() => {
    if (phase !== 'opening_session') return;

    // Phase 5: resume existing session or open a fresh one
    const openOrResume = async (): Promise<void> => {
      try {
        const store = useSwipeStore.getState();
        const isResuming = store.sessionId !== null;

        let sid: string;
        if (isResuming) {
          sid = store.sessionId!;
        } else {
          sid = await sessionTrackerRef.current!.openSession(playlistId, destinationPlaylistIds);
        }

        initSession(
          sid,
          playlistId,
          queueTracksRef.current,
          pendingTracksRef.current,
          destinationPlaylistIds,
        );

        setSessionId(sid);
        setPhase('ready');
      } catch (err) {
        console.error('[SwipeScreen] openOrResume session failed:', err);
        setErrorMessage('Could not start session. Please try again.');
        setPhase('error');
      }
    };

    void openOrResume();
  }, [phase, playlistId, destinationPlaylistIds, initSession]);

  // -------------------------------------------------------------------------
  // AppState listener — flush pending swipes on foreground reconnect
  // -------------------------------------------------------------------------
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus): void => {
      if (nextState === 'active' && backendSyncRef.current) {
        backendSyncRef.current.flushPending().catch((err: unknown) => {
          console.warn('[SwipeScreen] AppState flush failed:', err);
        });
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, []);

  // -------------------------------------------------------------------------
  // Unmount: close session + clear store (unless session-end screen took ownership)
  // -------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (!sessionClosedRef.current && sessionId && sessionTrackerRef.current) {
        sessionClosedRef.current = true;
        sessionTrackerRef.current.closeSession(sessionId);
      }
      // Skip clearSession when navigating to session-end — that screen owns the deferred clear
      if (!navigatedToSessionEndRef.current) {
        clearSession();
      }
    };
  }, [sessionId, clearSession]);

  // -------------------------------------------------------------------------
  // Session end callback (queue exhausted) — navigate to session-end screen.
  // clearSession() is intentionally deferred: the session-end screen needs
  // pendingSyncSwipes to be intact when it mounts. It calls clearSession on unmount.
  // -------------------------------------------------------------------------
  const navigatedToSessionEndRef = useRef(false);

  const handleSessionEnd = useCallback((): void => {
    if (!sessionClosedRef.current && sessionId && sessionTrackerRef.current) {
      sessionClosedRef.current = true;
      sessionTrackerRef.current.closeSession(sessionId);
    }
    navigatedToSessionEndRef.current = true;
    router.replace({
      pathname: '/(app)/session-end' as const,
      params: sessionId ? { sessionId } : {},
    });
  }, [sessionId, router]);

  // -------------------------------------------------------------------------
  // onEntireSession: fire-and-forget add, awaitable sequential remove with loading
  // -------------------------------------------------------------------------
  const [isBulkRemoving, setIsBulkRemoving] = useState(false);

  const handleEntireSession = useCallback(
    (added: string[], removed: string[], confirmedRemove: boolean): void => {
      if (!confirmedRemove && removed.length > 0) return;

      const store = useSwipeStore.getState();
      const likedTrackIds = store.pendingSyncSwipes
        .filter((r) => r.status === 'liked' || r.status === 'super_liked')
        .map((r) => r.track.id);

      // Adds are fire-and-forget via PlaylistWriter
      for (const pid of added) {
        for (const trackId of likedTrackIds) {
          playlistWriterRef.current?.write(trackId, [pid]);
        }
      }

      // Removes require sequential awaiting — show loading screen while in progress
      if (removed.length > 0 && adapterRef.current) {
        const adapter = adapterRef.current;
        setIsBulkRemoving(true);
        (async () => {
          try {
            for (const pid of removed) {
              for (const trackId of likedTrackIds) {
                await adapter.removeFromPlaylist(pid, trackId);
              }
            }
          } catch {
            Alert.alert('Error', 'Some tracks could not be removed. Please try manually.');
          } finally {
            setIsBulkRemoving(false);
          }
        })();
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (phase === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{errorMessage ?? 'An error occurred.'}</Text>
      </View>
    );
  }

  if (phase !== 'ready' || !sessionId) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1DB954" />
        <Text style={styles.loadingText}>{phaseLabel(phase)}</Text>
      </View>
    );
  }

  if (isBulkRemoving) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1DB954" />
        <Text style={styles.loadingText}>Removing tracks…</Text>
      </View>
    );
  }

  return (
    <SwipeEngine
      trackPlayer={trackPlayerRef.current!}
      playlistWriter={playlistWriterRef.current!}
      sessionTracker={sessionTrackerRef.current!}
      backendSync={backendSyncRef.current!}
      sessionId={sessionId}
      availablePlaylists={availablePlaylists}
      onSessionEnd={handleSessionEnd}
      onEntireSession={handleEntireSession}
    />
  );
}

function phaseLabel(phase: InitPhase): string {
  switch (phase) {
    case 'hydrating': return 'Restoring session…';
    case 'flushing': return 'Syncing…';
    case 'fetching_pending': return 'Loading queued tracks…';
    case 'fetching_queue': return 'Loading playlist…';
    case 'opening_session': return 'Starting session…';
    default: return 'Loading…';
  }
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#121212',
    gap: 16,
  },
  loadingText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 15,
  },
  errorText: {
    color: '#ff5c5c',
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
