import React from 'react';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PlatformError, PlatformErrorCode } from '@/adapters/interface';

// The first render in this suite pays for loading the whole screen module graph,
// which exceeds the 5s default on a cold cache.
jest.setTimeout(30_000);

const SESSION_ID = 'session-1';
const RETRY_BUTTON_LABEL = 'Retry';
const DEVICE_MISSING_MESSAGE =
  'Open your music app and start playing something, then come back and tap Retry.';

// ---------------------------------------------------------------------------
// Module mocks. The screen wires six services together; the device-missing path
// only depends on the adapter's getPlaylistTracks, so everything else is stubbed.
// ---------------------------------------------------------------------------

const mockGetPlaylistTracks = jest.fn();
const mockGetUserPlaylists = jest.fn().mockResolvedValue([]);
const mockOpenSession = jest.fn().mockResolvedValue(SESSION_ID);
const mockFlushPending = jest.fn().mockResolvedValue(undefined);
const mockOpenPlatformDeepLink = jest.fn();
const mockInitSession = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ playlistId: 'playlist-1' }),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
}));

jest.mock('@/auth/AuthGateway', () => ({
  createSpotifyAdapter: () => ({
    getPlaylistTracks: mockGetPlaylistTracks,
    getUserPlaylists: mockGetUserPlaylists,
  }),
}));

jest.mock('@/player/TrackPlayer', () => ({
  TrackPlayer: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@/services/PlaylistWriter', () => ({
  PlaylistWriter: Object.assign(
    jest.fn().mockImplementation(() => ({})),
    { drainStoredQueue: jest.fn().mockResolvedValue(undefined) },
  ),
}));

jest.mock('@/services/SessionTracker', () => ({
  SessionTracker: jest.fn().mockImplementation(() => ({
    openSession: mockOpenSession,
    closeSession: jest.fn(),
    updateSession: jest.fn(),
  })),
}));

jest.mock('@/services/BackendSync', () => ({
  BackendSync: jest.fn().mockImplementation(() => ({
    flushPending: mockFlushPending,
    markLibraryWritten: jest.fn(),
  })),
}));

jest.mock('@/deeplink/PlatformDeepLink', () => ({
  openPlatformDeepLink: (target: string) => mockOpenPlatformDeepLink(target),
}));

// A visible stand-in for the card stack, so "reached ready" is assertable by text.
jest.mock('@/swipe/SwipeEngine', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  const ReactActual = jest.requireActual('react');
  return {
    SwipeEngine: () => ReactActual.createElement(RNText, null, 'SWIPE_ENGINE'),
  };
});

jest.mock('@/hooks/useTheme', () => {
  const { getColors } = jest.requireActual('@/theme');
  return { useTheme: () => ({ activeColors: getColors(true), isDark: true }) };
});

// Minimal hand-rolled store doubles. The real stores are covered by their own
// suites; here they only have to hold state the init sequence reads.
const mockSwipeState = {
  sessions: [] as unknown[],
  activeSessionId: null as string | null,
  liveSessionId: null as string | null,
  queue: [] as unknown[],
  availablePlaylists: [] as unknown[],
  totalTracks: 0,
  initSession: mockInitSession,
  setTotalTracks: jest.fn(),
  setAvailablePlaylists: jest.fn(),
  setActiveSession: jest.fn(),
  updateActiveSession: jest.fn(),
  createSession: jest.fn(),
  markLikedSongsWritten: jest.fn(),
  appendFreshTracks: jest.fn(),
};

jest.mock('@/stores/swipeStore', () => {
  const hook = () => mockSwipeState;
  hook.getState = () => mockSwipeState;
  hook.persist = {
    hasHydrated: () => true,
    onFinishHydration: () => () => undefined,
  };
  return { useSwipeStore: hook };
});

const mockAuthState = {
  supabaseToken: 'supabase-token',
  accessToken: 'spotify-token',
  updateSupabaseToken: jest.fn(),
};

jest.mock('@/stores/authStore', () => {
  const hook = (selector?: (s: typeof mockAuthState) => unknown) =>
    selector ? selector(mockAuthState) : mockAuthState;
  hook.getState = () => mockAuthState;
  return { useAuthStore: hook };
});

import SwipeScreen from '../[playlistId]';

/** The PlatformError the adapter throws when nothing is playing on any device. */
function noActiveDeviceError(): PlatformError {
  return new PlatformError(PlatformErrorCode.NO_ACTIVE_DEVICE, 'No active device');
}

/** Registers the AppState listener spy and returns a trigger for the given state. */
function captureAppStateHandler(): (next: AppStateStatus) => void {
  let handler: ((next: AppStateStatus) => void) | null = null;
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event: string, callback: (next: AppStateStatus) => void) => {
      handler = callback;
      return { remove: jest.fn() } as never;
    });
  return (next: AppStateStatus) => handler?.(next);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  mockGetUserPlaylists.mockResolvedValue([]);
  mockFlushPending.mockResolvedValue(undefined);
  // Phase 3 asks the backend for decide-later tracks; an empty list is enough.
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ swipes: [] }),
  }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('SwipeScreen — NO_ACTIVE_DEVICE recovery', () => {
  it('lands on the retryable device-missing screen instead of the generic error screen', async () => {
    mockGetPlaylistTracks.mockRejectedValue(noActiveDeviceError());

    const { findByText, queryByText } = render(<SwipeScreen />);

    expect(await findByText(DEVICE_MISSING_MESSAGE)).toBeTruthy();
    expect(await findByText(RETRY_BUTTON_LABEL)).toBeTruthy();
    expect(queryByText('Could not load playlist. Please try again.')).toBeNull();
  });

  it('opens the platform deep link and alerts once', async () => {
    mockGetPlaylistTracks.mockRejectedValue(noActiveDeviceError());

    const { findByText } = render(<SwipeScreen />);
    await findByText(RETRY_BUTTON_LABEL);

    expect(mockOpenPlatformDeepLink).toHaveBeenCalledWith('spotify:');
    expect(Alert.alert).toHaveBeenCalledWith(
      'No active device',
      DEVICE_MISSING_MESSAGE,
      expect.anything(),
    );
  });

  it('replays only the playlist fetch when Retry is pressed', async () => {
    mockGetPlaylistTracks
      .mockRejectedValueOnce(noActiveDeviceError())
      .mockResolvedValueOnce({ tracks: [], total: 0 });

    const { findByText } = render(<SwipeScreen />);
    fireEvent.press(await findByText(RETRY_BUTTON_LABEL));

    expect(await findByText('SWIPE_ENGINE')).toBeTruthy();
    expect(mockGetPlaylistTracks).toHaveBeenCalledTimes(2);
    // Retry rewinds to phase 4, so the pending-swipes fetch does not run again.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('stays on the device-missing screen when the retry fails again', async () => {
    mockGetPlaylistTracks.mockRejectedValue(noActiveDeviceError());

    const { findByText } = render(<SwipeScreen />);
    fireEvent.press(await findByText(RETRY_BUTTON_LABEL));

    await waitFor(() => expect(mockGetPlaylistTracks).toHaveBeenCalledTimes(2));
    expect(await findByText(RETRY_BUTTON_LABEL)).toBeTruthy();
  });

  it('auto-recovers when the app returns to the foreground', async () => {
    const triggerAppState = captureAppStateHandler();
    mockGetPlaylistTracks
      .mockRejectedValueOnce(noActiveDeviceError())
      .mockResolvedValueOnce({ tracks: [], total: 0 });

    const { findByText } = render(<SwipeScreen />);
    await findByText(RETRY_BUTTON_LABEL);

    triggerAppState('active');

    expect(await findByText('SWIPE_ENGINE')).toBeTruthy();
  });

  it('ignores a background AppState change', async () => {
    const triggerAppState = captureAppStateHandler();
    mockGetPlaylistTracks.mockRejectedValue(noActiveDeviceError());

    const { findByText } = render(<SwipeScreen />);
    await findByText(RETRY_BUTTON_LABEL);
    const callsBefore = mockGetPlaylistTracks.mock.calls.length;

    triggerAppState('background');

    expect(mockGetPlaylistTracks).toHaveBeenCalledTimes(callsBefore);
  });

  it('does not re-fetch on foreground once the session is ready', async () => {
    const triggerAppState = captureAppStateHandler();
    mockGetPlaylistTracks.mockResolvedValue({ tracks: [], total: 0 });

    const { findByText } = render(<SwipeScreen />);
    await findByText('SWIPE_ENGINE');

    triggerAppState('active');

    await waitFor(() => expect(mockFlushPending).toHaveBeenCalled());
    expect(mockGetPlaylistTracks).toHaveBeenCalledTimes(1);
  });
});

describe('SwipeScreen — other adapter failures', () => {
  it('shows the permission message on PERMISSION_DENIED', async () => {
    mockGetPlaylistTracks.mockRejectedValue(
      new PlatformError(PlatformErrorCode.PERMISSION_DENIED, 'denied'),
    );

    const { findByText, queryByText } = render(<SwipeScreen />);

    expect(
      await findByText(
        'Spotify permissions need updating. Please log out and log back in to continue.',
      ),
    ).toBeTruthy();
    expect(queryByText(RETRY_BUTTON_LABEL)).toBeNull();
  });

  it('shows the generic error and no Retry on an unknown failure', async () => {
    mockGetPlaylistTracks.mockRejectedValue(new Error('network down'));

    const { findByText, queryByText } = render(<SwipeScreen />);

    expect(await findByText('Could not load playlist. Please try again.')).toBeTruthy();
    expect(queryByText(RETRY_BUTTON_LABEL)).toBeNull();
  });
});
