import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, AppStateStatus, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useSwipeStore, type SessionEntry } from '@/stores/swipeStore';
import { SwipeEngine } from '@/swipe/SwipeEngine';
import { createSpotifyAdapter } from '@/auth/AuthGateway';
import { TrackPlayer } from '@/player/TrackPlayer';
import { PlaylistWriter } from '@/services/PlaylistWriter';
import { SessionTracker } from '@/services/SessionTracker';
import { BackendSync } from '@/services/BackendSync';
import type { MusicPlatformAdapter, Playlist, Track } from '@/adapters/interface';
import { PlatformError, PlatformErrorCode, LIKED_SONGS_PLAYLIST_ID } from '@/adapters/interface';
import { openPlatformDeepLink } from '@/deeplink/PlatformDeepLink';
import { type Colors } from '@/theme';
import { useTheme } from '@/hooks/useTheme';
import { BACKEND_URL } from '@/config';
import { mapPendingSwipesToTracks, type PendingSwipeResponse } from '@/services/restorePendingTracks';

// Spotify caps a single page at 100 items for playlists and 50 for the saved-tracks
// ("Liked Songs") endpoint; SpotifyAdapter silently clamps anything larger. Paging by
// the platform maximum keeps the offset we walk aligned with the raw item count the API reads.
const PLAYLIST_PAGE_SIZE = 100;
const LIKED_SONGS_PAGE_SIZE = 50;

/** Page size for a given source — the saved-tracks endpoint caps lower than playlists. */
function getPageSize(playlistId: string): number {
  return playlistId === LIKED_SONGS_PLAYLIST_ID ? LIKED_SONGS_PAGE_SIZE : PLAYLIST_PAGE_SIZE;
}

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

  const { activeColors } = useTheme();
  const styles = useMemo(() => createStyles(activeColors), [activeColors]);

  const supabaseToken = useAuthStore((s) => s.supabaseToken);
  const { destinationPlaylistIds } = useSessionStore();

  const swipeStore = useSwipeStore();
  const { initSession } = swipeStore;

  // The active session entry iff it is the session for THIS screen's playlist — i.e. we are
  // resuming it rather than starting a fresh session for this source. Returns null when the
  // open session is for a different playlist (or none is open), which routes to a fresh start.
  const getResumeTarget = useCallback((): SessionEntry | null => {
    const { sessions, activeSessionId } = useSwipeStore.getState();
    const active = sessions.find((e) => e.sessionId === activeSessionId) ?? null;
    return active && active.sourcePlaylistId === playlistId ? active : null;
  }, [playlistId]);

  // Service refs — stable across re-renders, never re-instantiated after mount
  const adapterRef = useRef<MusicPlatformAdapter | null>(null);
  const trackPlayerRef = useRef<TrackPlayer | null>(null);
  const playlistWriterRef = useRef<PlaylistWriter | null>(null);
  const sessionTrackerRef = useRef<SessionTracker | null>(null);
  const backendSyncRef = useRef<BackendSync | null>(null);

  const [phase, setPhase] = useState<InitPhase>('hydrating');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [availablePlaylists, setAvailablePlaylists] = useState<Playlist[]>([]);

  // Tracks whether unmount already closed the session (prevents double-close)
  const sessionClosedRef = useRef(false);
  // Ensures the "couldn't save" alert is shown at most once per session, so a
  // burst of failed writes doesn't spam the user with dialogs.
  const writeErrorShownRef = useRef(false);

  // -------------------------------------------------------------------------
  // Service factory — runs once after auth tokens are available
  // -------------------------------------------------------------------------
  const buildServices = useCallback((): boolean => {
    if (!supabaseToken) return false;
    if (adapterRef.current) return true; // already built

    const adapter = createSpotifyAdapter();
    adapterRef.current = adapter;

    const getToken = (): string => useAuthStore.getState().supabaseToken ?? '';

    trackPlayerRef.current = new TrackPlayer(adapter);
    playlistWriterRef.current = new PlaylistWriter(
      adapter,
      undefined,
      (trackId) => {
        const store = useSwipeStore.getState();
        store.markLikedSongsWritten(trackId);
        // Persist the library-written bit so cancel-from-History can remove the
        // track from Liked Songs after a clear + restore (libraryWrittenIds is
        // per-device and lost on reinstall). Re-posts the swipe with the flag set.
        const activeId = store.activeSessionId;
        if (!activeId) return;
        const entry = store.sessions.find((e) => e.sessionId === activeId);
        const record = entry?.likedSwipes.find((r) => r.track.id === trackId);
        if (!record) return;
        backendSyncRef.current?.markLibraryWritten({
          sessionId: activeId,
          trackId,
          direction: record.status,
          destinationPlaylistIds: record.destinationPlaylistIds,
        });
      },
      // Surface non-retryable write failures once per session — a track that
      // genuinely can't be saved (e.g. permission revoked) should not vanish silently.
      () => {
        if (writeErrorShownRef.current) return;
        writeErrorShownRef.current = true;
        Alert.alert(
          "Couldn't save some tracks",
          `A like couldn't be added to a destination playlist. Check that you're still logged in and have permission to edit it.`,
        );
      },
    );
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
      const resume = getResumeTarget();
      // The live queue can only be reused when it actually belongs to the session we're
      // resuming (liveSessionId guards against reusing a previous session's queue after a switch).
      const hasInMemoryQueue =
        resume !== null && store.queue.length > 0 && store.liveSessionId === resume.sessionId;

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
        setTotalTracksState(resume.totalTracks);

        // sessionStore is in-memory only — repopulate from the durable session entry so the
        // subtitle and destination IDs are correct after a tab-away or app restart.
        if (useSessionStore.getState().destinationPlaylistIds.length === 0) {
          if (resume.sourcePlaylistName) {
            useSessionStore.getState().setSource(playlistId, resume.sourcePlaylistName);
          }
          if (resume.destinationPlaylistIds.length > 0) {
            useSessionStore.getState().setDestinations(resume.destinationPlaylistIds);
          }
        }
        useSessionStore.getState().setFilterMode(resume.isFilterMode);

        setPhase('opening_session');
        return;
      }

      // Normal path: await flush before fetching tracks.
      await backendSyncRef.current!.flushPending().catch((err: unknown) => {
        console.warn('[SwipeScreen] flushPending failed; will retry on reconnect', err);
      });

      PlaylistWriter.drainStoredQueue(adapterRef.current!).catch((err: unknown) => {
        console.warn('[SwipeScreen] drainStoredQueue failed:', err);
      });

      setPhase('fetching_pending');
    };

    void flush();
  }, [phase, buildServices, getResumeTarget, playlistId]);

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

        const data = (await response.json()) as { swipes: PendingSwipeResponse[] };

        // Map the backend `track` metadata to the internal Track shape. The
        // platform URI fallback (for swipes whose track was never cached
        // server-side) is supplied here so the platform literal stays out of
        // business logic — see restorePendingTracks.ts.
        return mapPendingSwipesToTracks(data.swipes ?? [], (id) => `spotify:track:${id}`);
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
        const resume = getResumeTarget();

        const pageSize = getPageSize(playlistId);
        const startOffset = resume ? resume.resumeOffset : 0;
        const { tracks, total } = await adapter.getPlaylistTracks(playlistId, startOffset, pageSize);
        setTotalTracksState(total);
        useSwipeStore.getState().setTotalTracks(total);

        initialNextOffsetRef.current = startOffset + pageSize;

        const playlists = await adapter.getUserPlaylists();
        setAvailablePlaylists(playlists);
        useSwipeStore.getState().setAvailablePlaylists(playlists);

        if (resume) {
          const srcName =
            playlistId === LIKED_SONGS_PLAYLIST_ID
              ? 'Liked Songs'
              : (playlists.find((p) => p.id === playlistId)?.name ?? resume.sourcePlaylistName ?? null);
          if (srcName) useSessionStore.getState().setSource(playlistId, srcName);
          useSessionStore.getState().setDestinations(resume.destinationPlaylistIds);
          useSessionStore.getState().setFilterMode(resume.isFilterMode);
        }

        fullTracksRef.current = tracks;
        queueTracksRef.current = tracks;
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
  }, [phase, playlistId, getResumeTarget]);

  const queueTracksRef = useRef<Track[]>([]);
  const fullTracksRef = useRef<Track[]>([]);
  const initialNextOffsetRef = useRef<number>(0);
  const isLoadingPageRef = useRef(false);
  const [totalTracks, setTotalTracksState] = useState<number>(0);

  useEffect(() => {
    if (phase !== 'opening_session') return;

    // Phase 5: resume existing session or open a fresh one
    const openOrResume = async (): Promise<void> => {
      try {
        const store = useSwipeStore.getState();
        const resume = getResumeTarget();
        const isResuming = resume !== null;

        if (resume && store.queue.length > 0 && store.liveSessionId === resume.sessionId) {
          setSessionId(resume.sessionId);
          setPhase('ready');
          return;
        }

        const playlists = useSwipeStore.getState().availablePlaylists;
        const total = useSwipeStore.getState().totalTracks;
        const resolveName = (id: string): string =>
          id === LIKED_SONGS_PLAYLIST_ID ? 'Liked Songs' : (playlists.find((p) => p.id === id)?.name ?? id);
        const sourceName = resolveName(playlistId);

        let sid: string;
        let resumeOffset = 0;
        let sessionDestIds: string[];
        if (resume) {
          sid = resume.sessionId;
          resumeOffset = resume.resumeOffset;
          sessionDestIds = resume.destinationPlaylistIds;
          useSwipeStore.getState().setActiveSession(sid);
          useSwipeStore.getState().updateActiveSession({ totalTracks: total, sourcePlaylistName: sourceName });
        } else {
          sessionDestIds = destinationPlaylistIds;
          const filterMode = useSessionStore.getState().isFilterMode;
          // Send the full SessionEntry shape so a restored History card can be
          // rebuilt server-side (names, destinations, filter mode, track total).
          const sessionMeta = {
            sourcePlaylistName: sourceName,
            destinationPlaylistNames: sessionDestIds.map(resolveName),
            isFilterMode: filterMode,
            totalTracks: total,
          };
          try {
            sid = await sessionTrackerRef.current!.openSession(playlistId, sessionDestIds, sessionMeta);
          } catch (err) {
            // Supabase JWT expired — refresh it once and retry
            if (err instanceof Error && err.message.includes('401')) {
              await refreshSupabaseToken();
              sid = await sessionTrackerRef.current!.openSession(playlistId, sessionDestIds, sessionMeta);
            } else {
              throw err;
            }
          }
          useSwipeStore.getState().createSession({
            sessionId: sid,
            sourcePlaylistId: playlistId,
            sourcePlaylistName: sourceName,
            destinationPlaylistIds: sessionDestIds,
            destinationPlaylistNames: sessionDestIds.map(resolveName),
            isFilterMode: filterMode,
            totalTracks: total,
          });
        }

        const trackById = new Map(fullTracksRef.current.map((t) => [t.id, t]));
        const enrichedPending = pendingTracksRef.current.map((t) => trackById.get(t.id) ?? t);

        initSession(
          sid,
          playlistId,
          queueTracksRef.current,
          enrichedPending,
          sessionDestIds,
          isResuming,
          initialNextOffsetRef.current,
          resumeOffset,
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
  }, [phase, playlistId, destinationPlaylistIds, initSession, refreshSupabaseToken, getResumeTarget]);

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
  // Session end callback (queue exhausted) — navigate to session-end screen.
  // -------------------------------------------------------------------------
  const handleSessionEnd = useCallback((): void => {
    if (!sessionClosedRef.current && sessionId && sessionTrackerRef.current) {
      sessionClosedRef.current = true;
      sessionTrackerRef.current.closeSession(sessionId);
      // Flush the final resume progress + completed status once (not per-swipe)
      // so the session restores correctly on another device/reinstall.
      const entry = useSwipeStore.getState().sessions.find((e) => e.sessionId === sessionId);
      sessionTrackerRef.current.updateSession(sessionId, {
        resumeOffset: entry?.resumeOffset ?? 0,
        status: 'completed',
      });
    }
    router.replace({
      pathname: '/(tabs)/session-end' as const,
      params: sessionId ? { sessionId } : {},
    });
  }, [sessionId, router]);

  // -------------------------------------------------------------------------
  // Lazy paging
  // -------------------------------------------------------------------------
  const loadMoreTracks = useCallback(async (): Promise<void> => {
    if (isLoadingPageRef.current) return;
    const adapter = adapterRef.current;
    if (!adapter) return;

    const { nextPageOffset, totalTracks: storeTotal } = useSwipeStore.getState();
    if (nextPageOffset >= storeTotal) return;

    isLoadingPageRef.current = true;
    try {
      const pageSize = getPageSize(playlistId);
      const { tracks } = await adapter.getPlaylistTracks(playlistId, nextPageOffset, pageSize);
      useSwipeStore.getState().appendFreshTracks(tracks, nextPageOffset + pageSize);
    } catch (err) {
      console.warn('[SwipeScreen] loadMoreTracks failed; will retry on next trigger', err);
    } finally {
      isLoadingPageRef.current = false;
    }
  }, [playlistId]);

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
        <ActivityIndicator size="large" color={activeColors.primary} />
        <Text style={styles.loadingText}>{phaseLabel(phase)}</Text>
      </View>
    );
  }

  return (
    <SwipeEngine
      trackPlayer={trackPlayerRef.current!}
      playlistWriter={playlistWriterRef.current!}
      backendSync={backendSyncRef.current!}
      adapter={adapterRef.current!}
      sessionId={sessionId}
      availablePlaylists={availablePlaylists}
      totalTracks={totalTracks}
      onSessionEnd={handleSessionEnd}
      onNeedMoreTracks={() => void loadMoreTracks()}
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

function createStyles(c: Colors) {
  return StyleSheet.create({
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: c.background,
      gap: 16,
    },
    brand: {
      fontSize: 28,
      fontFamily: 'Outfit_700Bold',
      color: c.primary,
      marginBottom: 8,
    },
    loadingText: {
      color: c.onSurfaceVariant,
      fontSize: 15,
      fontFamily: 'Outfit_400Regular',
    },
    errorText: {
      color: c.nope,
      fontSize: 15,
      textAlign: 'center',
      paddingHorizontal: 32,
      fontFamily: 'Outfit_400Regular',
    },
  });
}
