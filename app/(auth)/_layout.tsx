import { Redirect, Slot } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';

export default function AuthLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);

  if (!isLoading && isAuthenticated) {
    return <Redirect href="/(app)" />;
  }

  return <Slot />;
}
