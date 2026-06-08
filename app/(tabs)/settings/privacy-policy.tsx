import { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, radius, type Colors } from '@/theme';
import { useTheme } from '@/hooks/useTheme';

type StylesType = ReturnType<typeof createStyles>;

interface PolicySectionProps {
  title: string;
  body: string;
  styles: StylesType;
}

function PolicySection({ title, body, styles }: PolicySectionProps): React.ReactElement {
  return (
    <View style={styles.policySection}>
      <Text style={styles.policySectionTitle}>{title}</Text>
      <Text style={styles.policySectionBody}>{body}</Text>
    </View>
  );
}

export default function PrivacyPolicyScreen(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeColors } = useTheme();
  const styles = useMemo(() => createStyles(activeColors), [activeColors]);

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.headerIconBtn} onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={styles.headerIconText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={styles.headerIconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lastUpdated}>Last updated: May 2026</Text>

        <PolicySection styles={styles}
          title="1. Data Collection"
          body="MusicSwipe collects only the data necessary to operate the app. This includes your Spotify account identifier, display name, and the playlists and tracks you interact with during swipe sessions. We do not collect sensitive personal data beyond what Spotify's OAuth scopes provide."
        />

        <PolicySection styles={styles}
          title="2. How We Use Your Data"
          body="Your data is used solely to power the core swipe, match, and playlist-write features of MusicSwipe. Swipe history is stored locally on your device and synced to our servers only to preserve your session across devices. We do not sell or share your data with third parties."
        />

        <PolicySection styles={styles}
          title="3. Data Storage"
          body="Session state and swipe history are persisted on your device via AsyncStorage. Server-side data is stored in a secure PostgreSQL database managed by Supabase. All data in transit is encrypted via TLS."
        />

        <PolicySection styles={styles}
          title="4. Third-Party Services"
          body="MusicSwipe uses the Spotify Web API to fetch playlists and control playback. Your use of Spotify is subject to Spotify's own Privacy Policy and Terms of Service. We do not store your Spotify password or payment information."
        />

        <PolicySection styles={styles}
          title="5. Your Rights"
          body="You may request deletion of your account and all associated data at any time by contacting us at the address below. Logging out of the app clears all locally stored swipe history from your device."
        />

        <PolicySection styles={styles}
          title="6. Contact"
          body="For privacy-related questions or data deletion requests, please contact us via the Contact screen within the app or open an issue on GitHub."
        />

        <PolicySection styles={styles}
          title="7. Changes to This Policy"
          body="We may update this Privacy Policy from time to time. Continued use of MusicSwipe after changes constitutes your acceptance of the revised policy. The 'Last updated' date at the top of this document reflects the most recent revision."
        />
      </ScrollView>
    </View>
  );
}

function createStyles(c: Colors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingBottom: 12,
      backgroundColor: c.surface,
      borderBottomWidth: 1,
      borderBottomColor: c.surfaceContainerHigh,
    },
    headerTitle: {
      fontSize: 18,
      fontFamily: 'Outfit_700Bold',
      color: c.onSurface,
      letterSpacing: -0.3,
    },
    headerIconBtn: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerIconText: {
      fontSize: 20,
      color: c.primary,
    },
    scrollContent: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: 40,
      gap: spacing.lg,
    },
    lastUpdated: {
      fontSize: 12,
      fontFamily: 'Outfit_400Regular',
      color: c.onSurfaceVariant,
      marginBottom: spacing.sm,
    },
    policySection: {
      backgroundColor: c.surface,
      borderRadius: radius.xl,
      padding: spacing.md,
      gap: spacing.sm,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 8,
      elevation: 1,
    },
    policySectionTitle: {
      fontSize: 14,
      fontFamily: 'Outfit_600SemiBold',
      color: c.onSurface,
    },
    policySectionBody: {
      fontSize: 14,
      fontFamily: 'Outfit_400Regular',
      color: c.onSurfaceVariant,
      lineHeight: 22,
    },
  });
}
