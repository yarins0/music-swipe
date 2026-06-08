import { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import Ionicons from '@expo/vector-icons/Ionicons';
import { spacing, radius, type Colors } from '@/theme';
import { useTheme } from '@/hooks/useTheme';

const FEEDBACK_EMAIL = 'yarinso39@gmail.com';
const GITHUB_ISSUES_URL = 'https://github.com/yarins0/music-swipe/issues';
const GITHUB_REPO_URL = 'https://github.com/yarins0/music-swipe';

type StylesType = ReturnType<typeof createStyles>;

interface ContactRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  subtitle: string;
  onPress: () => void;
  styles: StylesType;
  activeColors: Colors;
}

function ContactRow({ icon, label, subtitle, onPress, styles, activeColors }: ContactRowProps): React.ReactElement {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} accessibilityRole="link">
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={20} color={activeColors.primary} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={activeColors.outlineVariant} />
    </TouchableOpacity>
  );
}

export default function ContactScreen(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeColors } = useTheme();
  const styles = useMemo(() => createStyles(activeColors), [activeColors]);

  const handleSendFeedback = () => {
    void Linking.openURL(
      `mailto:${FEEDBACK_EMAIL}?subject=MusicSwipe Feedback`,
    );
  };

  const handleReportBug = () => {
    void WebBrowser.openBrowserAsync(GITHUB_ISSUES_URL);
  };

  const handleViewOnGitHub = () => {
    void WebBrowser.openBrowserAsync(GITHUB_REPO_URL);
  };

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.headerIconBtn} onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={styles.headerIconText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Contact</Text>
        <View style={styles.headerIconBtn} />
      </View>

      <View style={styles.content}>
        <View style={styles.sectionCard}>
          <ContactRow
            icon="mail-outline"
            label="Send Feedback"
            subtitle="Share ideas or suggestions"
            onPress={handleSendFeedback}
            styles={styles}
            activeColors={activeColors}
          />
          <View style={styles.divider} />
          <ContactRow
            icon="bug-outline"
            label="Report a Bug"
            subtitle="Open an issue on GitHub"
            onPress={handleReportBug}
            styles={styles}
            activeColors={activeColors}
          />
          <View style={styles.divider} />
          <ContactRow
            icon="logo-github"
            label="View on GitHub"
            subtitle="Browse the source code"
            onPress={handleViewOnGitHub}
            styles={styles}
            activeColors={activeColors}
          />
        </View>
      </View>
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
    content: {
      padding: spacing.md,
      paddingTop: spacing.lg,
    },
    sectionCard: {
      backgroundColor: c.surface,
      borderRadius: radius.xl,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 8,
      elevation: 1,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: 14,
      minHeight: 64,
      gap: spacing.md,
    },
    rowIcon: {
      width: 36,
      height: 36,
      borderRadius: radius.md,
      backgroundColor: c.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    rowLabel: {
      fontSize: 15,
      fontFamily: 'Outfit_400Regular',
      color: c.onSurface,
    },
    rowSubtitle: {
      fontSize: 12,
      fontFamily: 'Outfit_400Regular',
      color: c.onSurfaceVariant,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.surfaceContainerHigh,
      marginLeft: spacing.md,
    },
  });
}
