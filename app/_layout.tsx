import { useEffect } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { Slot } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuthStore } from '@/stores/authStore';

export default function RootLayout() {
  const { isLoading, initialize } = useAuthStore();

  useEffect(() => {
    initialize();
    // initialize is a stable Zustand action — intentionally omitted from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <Slot />
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
