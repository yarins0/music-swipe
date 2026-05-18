import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '@/stores/authStore';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

const mockDeleteItem = SecureStore.deleteItemAsync as jest.Mock;
const mockSetItem = SecureStore.setItemAsync as jest.Mock;

const SECURE_STORE_KEYS = [
  'spotify_access_token',
  'spotify_refresh_token',
  'spotify_expires_at',
  'supabase_token',
  'supabase_user_id',
];

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({
    isAuthenticated: false,
    isLoading: true,
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    supabaseToken: null,
    userId: null,
  });
});

describe('authStore.clearAuth', () => {
  it('deletes all 5 SecureStore keys', async () => {
    await useAuthStore.getState().clearAuth();

    expect(mockDeleteItem).toHaveBeenCalledTimes(5);
    SECURE_STORE_KEYS.forEach((key) => {
      expect(mockDeleteItem).toHaveBeenCalledWith(key);
    });
  });

  it('resets isAuthenticated to false', async () => {
    useAuthStore.setState({ isAuthenticated: true, accessToken: 'token' });

    await useAuthStore.getState().clearAuth();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('nulls all token fields', async () => {
    useAuthStore.setState({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 9999,
      supabaseToken: 'sb',
      userId: 'uid',
    });

    await useAuthStore.getState().clearAuth();

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.expiresAt).toBeNull();
    expect(state.supabaseToken).toBeNull();
    expect(state.userId).toBeNull();
  });
});

describe('authStore.updateAccessToken', () => {
  it('writes only the access token and expiry to SecureStore', async () => {
    await useAuthStore.getState().updateAccessToken('new-token', 9999999);

    expect(mockSetItem).toHaveBeenCalledTimes(2);
    expect(mockSetItem).toHaveBeenCalledWith('spotify_access_token', 'new-token');
    expect(mockSetItem).toHaveBeenCalledWith('spotify_expires_at', '9999999');
  });

  it('does not touch the refresh token or Supabase keys', async () => {
    await useAuthStore.getState().updateAccessToken('new-token', 9999999);

    const calledKeys = (mockSetItem.mock.calls as string[][]).map((c) => c[0]);
    expect(calledKeys).not.toContain('spotify_refresh_token');
    expect(calledKeys).not.toContain('supabase_token');
    expect(calledKeys).not.toContain('supabase_user_id');
  });

  it('updates state accessToken and expiresAt', async () => {
    await useAuthStore.getState().updateAccessToken('new-token', 9999999);

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('new-token');
    expect(state.expiresAt).toBe(9999999);
  });
});
