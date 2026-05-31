import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, AppStateStatus, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
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
import { PlatformError, PlatformErrorCode, LIKED_SONGS_PLAYLIST_ID } from '@/adapters/interface';
import { openPlatformDeepLink } from '@/deeplink/PlatformDeepLink';
import { usePreviewPlayer } from '@/player/usePreviewPlayer';
import { usePrefsStore } from '@/stores/prefsStore';
import { colors } from '@/theme';

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
  const { playlistId: rawPlaylistId } = useLocalSearchParams<{ playlistId: string }>();
  // Expo Router may or may not URL-encode path segments containing colons.
  // Defensive decode ensures 'spotify:collection:tracks' always matches LIKED_SONGS_PLAYLIST_ID.
  const playlistId = rawPlaylistId ? decodeURIComponent(rawPlaylistId) : rawPlaylistId;
  const router = useRouter();

  const supabaseToken = useAuthStore((s) => s.supabaseToken);
  const { destinationPlaylistIds } = useSessionStore();

  const swipeStore = useSwipeStore();
  const { initSession, clearSession } = swipeStore;
  // Reactive currentIndex — used to detect when a swipe advances the queue
  const currentIndex = useSwipeStore((s) => s.currentIndex);

  // Clear the suspended flag whenever this screen gains focus — covers both initial
  // mount and returning from another tab via navigate (which doesn't remount the screen).
  useFocusEffect(
    useCallback(() => {
      useSwipeStore.getState().resumeSession();
    }, []),
  );

  // Service refs — stable across re-renders, never re-instantiated after mount
  const adapterRef = useRef<MusicPlatformAdapter | null>(null);
  const trackPlayerRef = useRef<TrackPlayer | null>(null);
  const playlistWriterRef = useRef<PlaylistWriter | null>(null);
  const sessionTrackerRef = useRef<SessionTracker | null>(null);
  const backendSyncRef = useRef<BackendSync | null>(null);

  // Auto-play previews preference — read reactively so the UI responds to settings changes
  const autoPlayPreviews = usePrefsStore((s) => s.autoPlayPreviews);

  // Preview player hook (wired once TrackPlayer is constructed)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewPlayer = usePreviewPlayer(previewUrl);

  // Auto-play: start the preview as soon as a previewUrl arrives and the pref is on.
  // Runs whenever previewUrl is set by the TrackPlayer onPreviewRequired callback.
  useEffect(() => {
    if (previewUrl !== null && autoPlayPreviews) {
      previewPlayer.play();
    }
  // previewPlayer is a new object each render but its .play() identity is stable;
  // including previewUrl as the trigger is intentional — only fire when the URL changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl]);

  // Pause and clear the preview whenever the current track changes (i.e. on every swipe).
  // This ensures the next card always starts with a clean slate — no leftover audio.
  // The skip ref prevents running on the very first render (index starts at 0 before
  // any swipe has occurred, so there is nothing to pause yet).
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    previewPlayer.pause();
    setPreviewUrl(null);
  // previewPlayer object identity changes each render; pause() is always safe to call.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  const [phase, setPhase] = useState<InitPhase>('hydrating');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [availablePlaylists, setAvailablePlaylists] = useState<Playlist[]>([]);

  // Tracks whether unmount already closed the session (prevents double-close)
  const sessionClosedRef = useRef(false);
  // Mirrors sessionId state in a ref so the unmount cleanup always sees the latest value
  // without needing sessionId in the cleanup effect's dependency array.
  const sessionIdRef = useRef<string | null>(null);

  // -------------------------------------------------------------------------
  // Service factory — runs once after auth tokens are available
  // -------------------------------------------------------------------------
  const buildServices = useCallback((): boolean => {
    if (!supabaseToken) return false;
    if (adapterRef.current) return true; // already built

    const adapter = createSpotifyAdapter();
    adapterRef.current = adapter;

    const getToken = (): string => useAuthStore.getState().supabaseToken ?? '';

    // Pass the preview callback only when auto-play previews is enabled.
    // When the pref is off, passing null skips the entire adapter-failure preview path.
    const previewCallback = usePrefsStore.getState().autoPlayPreviews ? setPreviewUrl : null;
    trackPlayerRef.current = new TrackPlayer(adapter, previewCallback);
    playlistWriterRef.current = new PlaylistWriter(adapter, undefined, (trackId) => {
      useSwipeStore.getState().markLikedSongsWritten(trackId);
    });
    sessionTrackerRef.current = new SessionTracker(BACKEND_URL, getToken);
    backendSyncRef.current = new BackendSync(BACKEND_URL, getToken);

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

    // Phase 2: flush pending sync swipes from a prior crashed session,
    // then drain any playlist write operations that were interrupted mid-flight.
    const flush = async (): Promise<void> => {
      const store = useSwipeStore.getState();
      const isResuming = store.sessionId !== null && store.sourcePlaylistId === playlistId;
      const hasInMemoryQueue = isResuming && store.queue.length > 0;

      if (hasInMemoryQueue) {
        // Queue and session state are intact in the Zustand singleton — skip all
        // network phases (3 and 4) and go straight to ready. Flush and drain in
        // the background so they don't block the transition.
        backendSyncRef.current!.flushPending().catch((err: unknown) => {
          console.warn('[SwipeScreen] background flushPending failed:', err);
        });
        PlaylistWriter.drainStoredQueue(adapterRef.current!).catch((err: unknown) => {
          console.warn('[SwipeScreen] background drainStoredQueue failed:', err);
        });

        // Restore component state from store (no API calls)
        setAvailablePlaylists(store.availablePlaylists);
        setTotalTracksState(store.totalTracks);

        // sessionStore is in-memory only — repopulate from the persisted store values
        // so the subtitle and destination IDs are correct if the app was restarted.
        if (useSessionStore.getState().destinationPlaylistIds.length === 0) {
          const srcName =
            playlistId === LIKED_SONGS_PLAYLIST_ID
              ? 'Liked Songs'
              : (store.availablePlaylists.find((p) => p.id === playlistId)?.name ?? null);
          if (srcName) useSessionStore.getState().setSource(playlistId, srcName);
          if (store.activeDestinationIds.length > 0) {
            useSessionStore.getState().setDestinations(store.activeDestinationIds);
          }
        }
        // Always restore filter mode from the persisted store — sessionStore is in-memory
        // and may have been overwritten if the user briefly visited destination.tsx.
        useSessionStore.getState().setFilterMode(store.isFilterMode);

        setPhase('opening_session');
        return;
      }

      // Normal path: await flush before fetching tracks.
      // flushPending() drains BackendSync's own in-memory queue (records from postSwipe
      // calls during this session). We intentionally do NOT call markSynced here:
      // pendingSyncSwipes is the source of truth for the history tab and must stay
      // intact until clearSession() is called at natural session end.
      await backendSyncRef.current!.flushPending().catch((err: unknown) => {
        console.warn('[SwipeScreen] flushPending failed; will retry on reconnect', err);
      });

      // Drain any write-queue entries that survived a previous crash.
      // Fire-and-forget from the perspective of the init sequence — failures are
      // logged inside drainStoredQueue and the entries stay in storage for the
      // next launch rather than blocking the current session from starting.
      PlaylistWriter.drainStoredQueue(adapterRef.current!).catch((err: unknown) => {
        console.warn('[SwipeScreen] drainStoredQueue failed:', err);
      });

      setPhase('fetching_pending');
    };

    void flush();
  }, [phase, buildServices]);

  // ---------------------------------------------------------------------------
  // Token refresh helper — re-registers with backend using current Spotify token
  // to obtain a fresh Supabase JWT. Called on 401 before retrying openSession.
  // ---------------------------------------------------------------------------
  const refreshSupabaseToken = useCallback(async (): Promise<void> => {
    const { accessToken: spotifyToken } = useAuthStore.getState();
    if (!spotifyToken) throw new Error('No Spotify access token available for re-authentication');

    const response = await fetch(`${BACKEND_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spotifyAccessToken: spotifyToken }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = (await response.json()) as { supabaseToken: string };
    await useAuthStore.getState().updateSupabaseToken(data.supabaseToken);
  }, []);

  useEffect(() => {
    if (phase !== 'fetching_pending') return;

    // Phase 3: fetch decide-later tracks from backend (status=pending for this playlist)
    const fetchPending = async (): Promise<Track[]> => {
      try {
        const url = `${BACKEND_URL}/swipes?status=pending&source_playlist_id=${encodeURIComponent(playlistId)}`;

        const doFetch = (token: string) =>
          fetch(url, { headers: { Authorization: `Bearer ${token}` } });

        let token = useAuthStore.getState().supabaseToken ?? '';
        let response = await doFetch(token);

        if (response.status === 401) {
          await refreshSupabaseToken();
          token = useAuthStore.getState().supabaseToken ?? '';
          response = await doFetch(token);
        }

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
  }, [phase, playlistId, refreshSupabaseToken]);

  const pendingTracksRef = useRef<Track[]>([]);

  useEffect(() => {
    if (phase !== 'fetching_queue') return;

    // Phase 4: fetch playlist tracks from adapter; resume from absoluteIndex if session exists
    const fetchQueue = async (): Promise<void> => {
      try {
        const adapter = adapterRef.current!;
        const store = useSwipeStore.getState();
        // absoluteIndex is the true playlist offset — never reset on resume, unlike currentIndex
        const storedAbsoluteIndex = store.absoluteIndex ?? 0;
        const isResuming =
          store.sessionId !== null && store.sourcePlaylistId === playlistId;

        // Fetch all tracks — paginate if needed (simple single-page fetch for now)
        const { tracks, total } = await adapter.getPlaylistTracks(playlistId, 0, 100);
        setTotalTracksState(total);
        useSwipeStore.getState().setTotalTracks(total);

        const sliced = isResuming ? tracks.slice(storedAbsoluteIndex) : tracks;
        const queueTracks = sliced.length > 0 ? sliced : tracks;

        // Fetch available playlists for the destination editor and subtitle
        const playlists = await adapter.getUserPlaylists();
        setAvailablePlaylists(playlists);
        // Save to store so tab-away + return can restore instantly without an API call
        useSwipeStore.getState().setAvailablePlaylists(playlists);

        // sessionStore has no persist middleware so it is always empty on app restart.
        // When resuming from AsyncStorage (queue not in memory), repopulate it so the
        // Discover subtitle renders and phase 5 passes the correct destination IDs.
        if (isResuming) {
          const srcName =
            playlistId === LIKED_SONGS_PLAYLIST_ID
              ? 'Liked Songs'
              : (playlists.find((p) => p.id === playlistId)?.name ?? null);
          if (srcName) useSessionStore.getState().setSource(playlistId, srcName);
          const storedDestIds = store.activeDestinationIds;
          if (storedDestIds.length > 0 && useSessionStore.getState().destinationPlaylistIds.length === 0) {
            useSessionStore.getState().setDestinations(storedDestIds);
          }
          useSessionStore.getState().setFilterMode(store.isFilterMode);
        }

        // Stash full track list (unsliced) so phase 5 can enrich pending tracks
        // whose position may be before currentIndex and therefore not in queueTracks.
        fullTracksRef.current = tracks;
        queueTracksRef.current = queueTracks;
        setPhase('opening_session');
      } catch (err) {
        console.error('[SwipeScreen] fetchQueue failed:', err);
        if (err instanceof PlatformError && err.code === PlatformErrorCode.NO_ACTIVE_DEVICE) {
          console.log('[SwipeScreen] NO_ACTIVE_DEVICE — opening Spotify deep link');
          void openPlatformDeepLink('spotify:');
          Alert.alert(
            'Open Spotify',
            'Start playing something in Spotify, then come back to MusicSwipe.',
            [{ text: 'OK' }],
          );
        } else if (err instanceof PlatformError && err.code === PlatformErrorCode.PERMISSION_DENIED) {
          setErrorMessage('Spotify permissions need updating. Please log out and log back in to continue.');
          setPhase('error');
          return;
        }
        setErrorMessage('Could not load playlist. Please try again.');
        setPhase('error');
      }
    };

    void fetchQueue();
  }, [phase, playlistId]);

  const queueTracksRef = useRef<Track[]>([]);
  // Full unsliced playlist — used to enrich pending tracks with complete metadata
  const fullTracksRef = useRef<Track[]>([]);
  // True total track count from the API (not the loaded slice size).
  // Must be state (not a ref) so changes propagate as a prop update to SwipeEngine.
  const [totalTracks, setTotalTracksState] = useState<number>(0);

  useEffect(() => {
    if (phase !== 'opening_session') return;

    // Phase 5: resume existing session or open a fresh one
    const openOrResume = async (): Promise<void> => {
      try {
        const store = useSwipeStore.getState();
        const isResuming =
          store.sessionId !== null && store.sourcePlaylistId === playlistId;

        // Queue is still in memory from the previous mount — skip re-initializing the
        // session store to avoid resetting currentIndex back to 0.
        if (isResuming && store.queue.length > 0) {
          setSessionId(store.sessionId!);
          setPhase('ready');
          return;
        }

        let sid: string;
        if (isResuming) {
          sid = store.sessionId!;
        } else {
          try {
            sid = await sessionTrackerRef.current!.openSession(playlistId, destinationPlaylistIds);
          } catch (err) {
            // Supabase JWT expired — refresh it once and retry
            if (err instanceof Error && err.message.includes('401')) {
              await refreshSupabaseToken();
              sid = await sessionTrackerRef.current!.openSession(playlistId, destinationPlaylistIds);
            } else {
              throw err;
            }
          }
        }

        // Replace any incomplete pending-track stubs (title = track ID, no art) with
        // full metadata from the playlist fetch. Covers tracks whose position is
        // before currentIndex and therefore absent from queueTracksRef.
        const trackById = new Map(fullTracksRef.current.map((t) => [t.id, t]));
        const enrichedPending = pendingTracksRef.current.map((t) => trackById.get(t.id) ?? t);

        initSession(
          sid,
          playlistId,
          queueTracksRef.current,
          enrichedPending,
          destinationPlaylistIds,
          isResuming,
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
  }, [phase, playlistId, destinationPlaylistIds, initSession, refreshSupabaseToken]);

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

  // Keep the ref in sync so the unmount cleanup always has the latest sessionId.
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // -------------------------------------------------------------------------
  // Unmount: close session + clear store (unless session-end screen took ownership)
  // -------------------------------------------------------------------------
  // Empty deps — intentionally runs only on unmount. sessionIdRef gives the cleanup
  // access to the latest sessionId without putting sessionId in the deps array,
  // which would fire this cleanup on every sessionId transition (including the
  // null → realId transition after initSession, which would wipe the queue).
  useEffect(() => {
    return () => {
      // When the user tabs away mid-session, the store's isSuspended flag is set by BottomNavBar.
      // In that case, leave all session state intact so the resume flow picks up where it left off.
      if (useSwipeStore.getState().isSuspended) return;

      if (!sessionClosedRef.current && sessionIdRef.current && sessionTrackerRef.current) {
        sessionClosedRef.current = true;
        sessionTrackerRef.current.closeSession(sessionIdRef.current);
      }
      if (!navigatedToSessionEndRef.current) {
        clearSession();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      pathname: '/(tabs)/session-end' as const,
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
        <Text style={styles.brand}>MusicSwipe</Text>
        <Text style={styles.errorText}>{errorMessage ?? 'An error occurred.'}</Text>
      </View>
    );
  }

  if (phase !== 'ready' || !sessionId) {
    return (
      <View style={styles.center}>
        <Text style={styles.brand}>MusicSwipe</Text>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>{phaseLabel(phase)}</Text>
      </View>
    );
  }

  if (isBulkRemoving) {
    return (
      <View style={styles.center}>
        <Text style={styles.brand}>MusicSwipe</Text>
        <ActivityIndicator size="large" color={colors.primary} />
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
      adapter={adapterRef.current!}
      sessionId={sessionId}
      availablePlaylists={availablePlaylists}
      totalTracks={totalTracks}
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
    backgroundColor: colors.background,
    gap: 16,
  },
  brand: {
    fontSize: 28,
    fontFamily: 'Outfit_700Bold',
    color: colors.primary,
    marginBottom: 8,
  },
  loadingText: {
    color: colors.onSurfaceVariant,
    fontSize: 15,
    fontFamily: 'Outfit_400Regular',
  },
  errorText: {
    color: colors.nope,
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 32,
    fontFamily: 'Outfit_400Regular',
  },
});
