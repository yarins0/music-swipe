import type { ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { AdapterCapabilities } from '@/adapters/interface';

interface PlaylistAccessGuardProps {
  capabilities: AdapterCapabilities;
  playlistId: string;
  children: ReactNode;
}

export function PlaylistAccessGuard({
  capabilities,
  children,
}: PlaylistAccessGuardProps) {
  if (!capabilities.requiresExplicitFollow) {
    return <>{children}</>;
  }

  // Phase 5: real deep link will open Spotify to the playlist
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
