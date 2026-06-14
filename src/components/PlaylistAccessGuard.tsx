import type { ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { AdapterCapabilities } from '@/adapters/interface';

interface PlaylistAccessGuardProps {
  capabilities: AdapterCapabilities;
  playlistId: string;
  children: ReactNode;
}

// Unreferenced Phase 5 stub: no source file imports this component yet. When it is
// adopted, the action button must be wired to the platform deep link via the adapter's
// openPlaylistInApp (passed in as a prop), and its label/colour sourced from a
// platform-agnostic place rather than the hardcoded Spotify values below — this file
// lives outside src/adapters/, so platform-specific strings here are a boundary smell.
export function PlaylistAccessGuard({
  capabilities,
  children,
}: PlaylistAccessGuardProps) {
  if (!capabilities.requiresExplicitFollow) {
    return <>{children}</>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.message}>Follow this playlist first to access it</Text>
      <TouchableOpacity style={styles.button}>
        <Text style={styles.buttonText}>Open in Spotify</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  message: {
    fontSize: 16,
    color: '#374151',
    textAlign: 'center',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#1DB954',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 50,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
