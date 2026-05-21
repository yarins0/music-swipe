import { Redirect, Slot, usePathname, useSegments } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';

export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const pathname = usePathname();
  const segments = useSegments();
  console.log('[AppLayout] render — pathname:', pathname, 'segments:', segments, 'isAuthenticated:', isAuthenticated);

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return <Slot />;
}
