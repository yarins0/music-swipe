import { Linking } from 'react-native';

export async function openPlatformDeepLink(uri: string): Promise<void> {
  console.log('[PlatformDeepLink] Opening deep link:', uri);
  try {
    await Linking.openURL(uri);
  } catch (err) {
    console.warn('[PlatformDeepLink] Failed to open deep link:', uri, err);
  }
}
