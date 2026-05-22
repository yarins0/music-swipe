import { Linking } from 'react-native';
import { openPlatformDeepLink } from '../PlatformDeepLink';

// jest-expo's react-native preset already mocks Linking.openURL as jest.fn().
// We cast it here so TypeScript knows it's a mock.
const mockOpenURL = Linking.openURL as jest.Mock;

describe('openPlatformDeepLink', () => {
  beforeEach(() => {
    mockOpenURL.mockReset();
  });

  it('calls Linking.openURL with the provided uri', async () => {
    mockOpenURL.mockResolvedValueOnce(undefined);
    await openPlatformDeepLink('spotify:');
    expect(mockOpenURL).toHaveBeenCalledWith('spotify:');
  });

  it('swallows errors from Linking.openURL without throwing', async () => {
    mockOpenURL.mockRejectedValueOnce(new Error('Cannot open URL'));
    await expect(openPlatformDeepLink('spotify:')).resolves.toBeUndefined();
  });

  it('passes arbitrary URIs through to Linking.openURL', async () => {
    mockOpenURL.mockResolvedValueOnce(undefined);
    await openPlatformDeepLink('spotify:track:abc123');
    expect(mockOpenURL).toHaveBeenCalledWith('spotify:track:abc123');
  });
});
