import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/authStore';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, spacing, radius } from '@/theme';

const APP_VERSION = '1.0.0 (1)';

interface SettingRowProps {
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}

function ToggleRow({ label, subtitle, value, onValueChange }: SettingRowProps): React.ReactElement {
  return (
    <View style={styles.row}>
      <View style={styles.rowTextGroup}>
        <Text style={styles.rowLabel}>{label}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.surfaceContainerHighest, true: colors.primary }}
        thumbColor={colors.surface}
        ios_backgroundColor={colors.surfaceContainerHighest}
      />
    </View>
  );
}

interface LinkRowProps {
  label: string;
  value?: string;
  onPress?: () => void;
}

function LinkRow({ label, value, onPress }: LinkRowProps): React.ReactElement {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={!onPress}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowEnd}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        {onPress ? (
          <Ionicons name="chevron-forward" size={18} color={colors.outlineVariant} />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps): React.ReactElement {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

export default function SettingsScreen(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.userId);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  const [showAlbumArt, setShowAlbumArt] = useState(true);
  const [autoPlayPreviews, setAutoPlayPreviews] = useState(false);
  const [hapticFeedback, setHapticFeedback] = useState(true);
  const [spotifySync, setSpotifySync] = useState(true);
  const [weeklyReminders, setWeeklyReminders] = useState(true);

  const handleLogOut = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => void clearAuth() },
    ]);
  };

  const handleReconnect = () => {
    Alert.alert('Reconnect', 'This will re-authenticate your Spotify account.');
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(app)')}
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Account */}
        <Section title="ACCOUNT">
          <View style={styles.accountRow}>
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={28} color={colors.onSurfaceVariant} />
            </View>
            <View style={styles.accountInfo}>
              <Text style={styles.accountName}>Spotify User</Text>
              <Text style={styles.accountId} numberOfLines={1}>
                {userId ?? '—'}
              </Text>
            </View>
          </View>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogOut}>
            <Text style={styles.logoutText}>Log Out</Text>
          </TouchableOpacity>
        </Section>

        {/* Music Integration */}
        <Section title="MUSIC INTEGRATION">
          <ToggleRow
            label="Spotify Sync"
            value={spotifySync}
            onValueChange={setSpotifySync}
          />
          <View style={styles.divider} />
          <TouchableOpacity style={styles.reconnectButton} onPress={handleReconnect}>
            <Ionicons name="sync" size={14} color={colors.primary} />
            <Text style={styles.reconnectText}>Reconnect Service</Text>
          </TouchableOpacity>
        </Section>

        {/* Curation Preferences */}
        <Section title="CURATION PREFERENCES">
          <ToggleRow
            label="Show Album Art"
            value={showAlbumArt}
            onValueChange={setShowAlbumArt}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="Auto-play Previews"
            value={autoPlayPreviews}
            onValueChange={setAutoPlayPreviews}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="Haptic Feedback on Swipe"
            value={hapticFeedback}
            onValueChange={setHapticFeedback}
          />
        </Section>

        {/* Notifications */}
        <Section title="NOTIFICATIONS">
          <ToggleRow
            label="Weekly Curation Reminders"
            subtitle="Get notified when your pulse playlist is ready"
            value={weeklyReminders}
            onValueChange={setWeeklyReminders}
          />
        </Section>

        {/* About */}
        <Section title="ABOUT">
          <LinkRow label="Version" value={APP_VERSION} />
          <View style={styles.divider} />
          <LinkRow label="Privacy Policy" onPress={() => {}} />
          <View style={styles.divider} />
          <LinkRow label="Terms of Service" onPress={() => {}} />
        </Section>

        {/* Branding footer */}
        <View style={styles.brandingFooter}>
          <View style={styles.brandingIcon}>
            <Ionicons name="musical-note" size={18} color={colors.surface} />
          </View>
          <Text style={styles.brandingText}>MUSICSWIPE</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHigh,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Outfit_700Bold',
    color: colors.primary,
    letterSpacing: -0.3,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: 40,
    gap: spacing.lg,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Outfit_600SemiBold',
    color: colors.onSurfaceVariant,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingLeft: 4,
  },
  sectionCard: {
    backgroundColor: colors.surface,
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    minHeight: 52,
  },
  rowTextGroup: {
    flex: 1,
    gap: 2,
    marginRight: spacing.md,
  },
  rowLabel: {
    fontSize: 15,
    fontFamily: 'Outfit_400Regular',
    color: colors.onSurface,
  },
  rowSubtitle: {
    fontSize: 12,
    fontFamily: 'Outfit_400Regular',
    color: colors.onSurfaceVariant,
  },
  rowEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowValue: {
    fontSize: 13,
    fontFamily: 'Outfit_400Regular',
    color: colors.onSurfaceVariant,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.surfaceContainerHigh,
    marginLeft: spacing.md,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  avatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountInfo: {
    flex: 1,
    gap: 2,
  },
  accountName: {
    fontSize: 16,
    fontFamily: 'Outfit_700Bold',
    color: colors.onSurface,
  },
  accountId: {
    fontSize: 13,
    fontFamily: 'Outfit_400Regular',
    color: colors.onSurfaceVariant,
  },
  logoutButton: {
    paddingVertical: 14,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surfaceContainerHigh,
  },
  logoutText: {
    fontSize: 15,
    fontFamily: 'Outfit_600SemiBold',
    color: colors.nope,
  },
  reconnectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
  },
  reconnectText: {
    fontSize: 14,
    fontFamily: 'Outfit_600SemiBold',
    color: colors.primary,
  },
  brandingFooter: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
    opacity: 0.4,
  },
  brandingIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandingText: {
    fontSize: 11,
    fontFamily: 'Outfit_600SemiBold',
    color: colors.onSurfaceVariant,
    letterSpacing: 2,
  },
});
