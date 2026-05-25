import { Redirect, Slot, usePathname, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuthStore } from '@/stores/authStore';

export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isAuthenticating = useAuthStore((s) => s.isAuthenticating);
  const pathname = usePathname();
  const segments = useSegments();
  console.log('[AppLayout] render — pathname:', pathname, 'segments:', segments, 'isAuthenticated:', isAuthenticated);

  if (!isAuthenticated) {
    if (isAuthenticating) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
          <ActivityIndicator size="large" />
        </View>
      );
    }
    return <Redirect href="/(auth)/login" />;
  }

  return <Slot />;
}
