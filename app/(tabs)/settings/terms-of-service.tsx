import { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, radius, type Colors } from '@/theme';
import { useTheme } from '@/hooks/useTheme';

type StylesType = ReturnType<typeof createStyles>;

interface TosSectionProps {
  title: string;
  body: string;
  styles: StylesType;
}

function TosSection({ title, body, styles }: TosSectionProps): React.ReactElement {
  return (
    <View style={styles.tosSection}>
      <Text style={styles.tosSectionTitle}>{title}</Text>
      <Text style={styles.tosSectionBody}>{body}</Text>
    </View>
  );
}

export default function TermsOfServiceScreen(): React.ReactElement {
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
        <Text style={styles.headerTitle}>Terms of Service</Text>
        <View style={styles.headerIconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lastUpdated}>Last updated: May 2026</Text>

        <TosSection styles={styles}
          title="1. Acceptance of Terms"
          body="By downloading or using MusicSwipe, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the app."
        />

        <TosSection styles={styles}
          title="2. Description of Service"
          body="MusicSwipe is a music discovery app that connects to your Spotify account to let you swipe through playlist tracks and save liked songs to destination playlists. The service requires a valid Spotify account and, for full playback, a Spotify Premium subscription."
        />

        <TosSection styles={styles}
          title="3. User Responsibilities"
          body="You are responsible for maintaining the confidentiality of your Spotify credentials. You agree not to use MusicSwipe for any unlawful purpose or in a way that violates Spotify's Terms of Service. You must be at least 13 years of age to use this app."
        />

        <TosSection styles={styles}
          title="4. Intellectual Property"
          body="All music content accessed through MusicSwipe is owned by the respective rights holders and licensed through Spotify. MusicSwipe claims no ownership over any music, artwork, or metadata provided by Spotify's API."
        />

        <TosSection styles={styles}
          title="5. Disclaimer of Warranties"
          body="MusicSwipe is provided 'as is' without warranties of any kind, express or implied. We do not guarantee that the service will be uninterrupted, error-free, or that any defects will be corrected."
        />

        <TosSection styles={styles}
          title="6. Limitation of Liability"
          body="To the fullest extent permitted by law, MusicSwipe and its developer shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the app."
        />

        <TosSection styles={styles}
          title="7. Governing Law"
          body="These Terms shall be governed by and construed in accordance with applicable law. Any disputes arising under these Terms shall be resolved in the jurisdiction where the developer resides."
        />

        <TosSection styles={styles}
          title="8. Changes to These Terms"
          body="We reserve the right to modify these Terms at any time. Continued use of MusicSwipe after any changes constitutes your acceptance of the new Terms. The 'Last updated' date at the top of this document reflects the most recent revision."
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
    tosSection: {
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
    tosSectionTitle: {
      fontSize: 14,
      fontFamily: 'Outfit_600SemiBold',
      color: c.onSurface,
    },
    tosSectionBody: {
      fontSize: 14,
      fontFamily: 'Outfit_400Regular',
      color: c.onSurfaceVariant,
      lineHeight: 22,
    },
  });
}
