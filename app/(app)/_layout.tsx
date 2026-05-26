import { Redirect, Slot, usePathname, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { BottomNavBar } from '@/components/BottomNavBar';

const HIDDEN_NAV_PREFIXES = ['/swipe', '/destination', '/session-end'];

function shouldShowNavBar(pathname: string): boolean {
  return !HIDDEN_NAV_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

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

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <Slot />
      </View>
      {shouldShowNavBar(pathname) && <BottomNavBar />}
    </View>
  );
}
