import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useSpotifyAuth } from '@/auth/useSpotifyAuth';

export default function LoginScreen() {
  const { login, isLoading, error } = useSpotifyAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>MusicSwipe</Text>
      <Text style={styles.subtitle}>Swipe through music. Keep what you love.</Text>

      <TouchableOpacity
        style={[styles.button, isLoading && styles.buttonDisabled]}
        onPress={login}
        disabled={isLoading}
        accessibilityRole="button"
        accessibilityLabel="Connect with Spotify"
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Connect Spotify</Text>
        )}
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}
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
  title: {
    fontSize: 36,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 48,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#1DB954',
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 50,
    minWidth: 200,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: '#e53e3e',
    marginTop: 16,
    textAlign: 'center',
  },
});
