import { useMemo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSpotifyAuth } from '@/auth/useSpotifyAuth';
import { spacing, radius, type Colors } from '@/theme';
import { useTheme } from '@/hooks/useTheme';

export default function LoginScreen() {
  const { login, isLoading, error } = useSpotifyAuth();
  const insets = useSafeAreaInsets();
  const { activeColors } = useTheme();
  const styles = useMemo(() => createStyles(activeColors), [activeColors]);

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.hero}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoIcon}>♫</Text>
        </View>
        <Text style={styles.title}>MusicSwipe</Text>
        <Text style={styles.subtitle}>Swipe through music.{'\n'}Keep what you love.</Text>
      </View>

      <View style={styles.actions}>
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
    </View>
  );
}

function createStyles(c: Colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xl,
    },
    hero: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: spacing.md,
    },
    logoCircle: {
      width: 88,
      height: 88,
      borderRadius: radius.full,
      backgroundColor: c.primary,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: spacing.sm,
      shadowColor: c.primary,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.35,
      shadowRadius: 16,
      elevation: 10,
    },
    logoIcon: { fontSize: 40, color: '#fff' },
    title: {
      fontSize: 40,
      fontFamily: 'Outfit_700Bold',
      color: c.onSurface,
      letterSpacing: -0.5,
    },
    subtitle: {
      fontSize: 16,
      fontFamily: 'Outfit_400Regular',
      color: c.onSurfaceVariant,
      textAlign: 'center',
      lineHeight: 24,
    },
    actions: {
      paddingBottom: spacing.xl,
      gap: spacing.sm,
      alignItems: 'center',
    },
    button: {
      backgroundColor: c.primary,
      paddingVertical: 16,
      paddingHorizontal: 40,
      borderRadius: radius.full,
      minWidth: 240,
      alignItems: 'center',
      shadowColor: c.primary,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 6,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: {
      color: '#fff',
      fontSize: 16,
      fontFamily: 'Outfit_700Bold',
    },
    error: {
      color: c.nope,
      fontSize: 13,
      fontFamily: 'Outfit_400Regular',
      textAlign: 'center',
      marginTop: spacing.sm,
    },
  });
}
