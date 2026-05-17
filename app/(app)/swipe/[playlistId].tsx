import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSessionStore } from '@/stores/sessionStore';

export default function SwipeScreen() {
  const { playlistId } = useLocalSearchParams<{ playlistId: string }>();
  const { sourcePlaylistName, destinationPlaylistIds } = useSessionStore();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Swipe Screen</Text>
      <Text style={styles.subtitle}>Phase 2 — coming soon</Text>
      <Text style={styles.detail}>Source: {sourcePlaylistName ?? playlistId}</Text>
      <Text style={styles.detail}>
        Destinations: {destinationPlaylistIds.length} playlist(s)
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#1DB954', marginBottom: 24 },
  detail: { fontSize: 14, color: '#6b7280', marginBottom: 6 },
});
