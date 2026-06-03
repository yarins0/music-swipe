import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Alert,
  Animated,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { AppModal } from '@/components/AppModal';
import { Image } from 'expo-image';
import { useAuthStore } from '@/stores/authStore';
import { usePrefsStore } from '@/stores/prefsStore';
import { useSwipeStore } from '@/stores/swipeStore';
import { useUiStore } from '@/stores/uiStore';
import { createSpotifyAdapter } from '@/auth/AuthGateway';
import { openPlatformDeepLink } from '@/deeplink/PlatformDeepLink';
import type { MusicPlatformAdapter, UserProfile } from '@/adapters/interface';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TabHeader } from '@/components/TabHeader';
import { colors, spacing, radius } from '@/theme';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';

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
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const clearAllSessions = useSwipeStore((s) => s.clearAllSessions);

  const showAlbumArt = usePrefsStore((s) => s.showAlbumArt);
  const autoPlayPreviews = usePrefsStore((s) => s.autoPlayPreviews);
  const hapticFeedback = usePrefsStore((s) => s.hapticFeedback);
  const weeklyReminders = usePrefsStore((s) => s.weeklyReminders);
  const autoRemoveDuplicates = usePrefsStore((s) => s.autoRemoveDuplicates);
  const setShowAlbumArt = usePrefsStore((s) => s.setShowAlbumArt);
  const setAutoPlayPreviews = usePrefsStore((s) => s.setAutoPlayPreviews);
  const setHapticFeedback = usePrefsStore((s) => s.setHapticFeedback);
  const setWeeklyReminders = usePrefsStore((s) => s.setWeeklyReminders);
  const setAutoRemoveDuplicates = usePrefsStore((s) => s.setAutoRemoveDuplicates);

  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [clearHistoryModalVisible, setClearHistoryModalVisible] = useState(false);

  const [profile, setProfile] = useState<UserProfile & { isLoading: boolean }>({
    spotifyId: '',
    displayName: null,
    avatarUrl: null,
    email: null,
    isLoading: true,
  });

  const adapterRef = useRef<MusicPlatformAdapter | null>(null);

  useEffect(() => {
    if (!adapterRef.current) adapterRef.current = createSpotifyAdapter();
    adapterRef.current.getUserProfile()
      .then((p) => setProfile({ ...p, isLoading: false }))
      .catch((err: unknown) => {
        console.error('[Settings] getUserProfile failed:', err);
        setProfile({ spotifyId: '', displayName: null, avatarUrl: null, email: null, isLoading: false });
      });
  }, []);

  // --- Auto-play Previews row: scroll-to + flash, driven by the swipe screen's badge ---
  const scrollRef = useRef<ScrollView>(null);
  // Zero-height anchor at the top of the scroll content. Measuring the row and this anchor
  // in window coordinates yields the row's absolute offset within the content, regardless
  // of current scroll position — and avoids measureLayout, which rejects non-native refs.
  const contentTopRef = useRef<View>(null);
  const autoPlayRowRef = useRef<View>(null);
  const pulse = useRef(new Animated.Value(0)).current;
  const pulseBackground = pulse.interpolate({
    inputRange: [0, 1],
    // Transparent → primary tint, so the flash reads over the card surface.
    outputRange: ['rgba(253,41,123,0)', 'rgba(253,41,123,0.18)'],
  });

  // Scroll the Auto-play Previews row into view and flash its background twice.
  const triggerAutoPlayHighlight = useCallback((): void => {
    const row = autoPlayRowRef.current;
    const anchor = contentTopRef.current;
    if (row && anchor) {
      anchor.measureInWindow((_ax, anchorY) => {
        row.measureInWindow((_rx, rowY) => {
          scrollRef.current?.scrollTo({ y: Math.max(0, rowY - anchorY - 24), animated: true });
        });
      });
    }
    pulse.setValue(0);
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 280, useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 0, duration: 280, useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 1, duration: 280, useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 0, duration: 280, useNativeDriver: false }),
    ]).start();
  }, [pulse]);

  // When the screen gains focus with a pending request (set by tapping the swipe-card
  // "No full preview" badge), run the highlight once and clear the flag. Consume-on-focus
  // means a normal Settings visit never triggers it.
  useFocusEffect(
    useCallback(() => {
      if (!useUiStore.getState().pendingAutoPlayHighlight) return;
      useUiStore.getState().consumeAutoPlayHighlight();
      // Defer so the screen has laid out and the row can be measured.
      const timer = setTimeout(triggerAutoPlayHighlight, 350);
      return () => clearTimeout(timer);
    }, [triggerAutoPlayHighlight]),
  );

  // Open Spotify and best-effort resume playback so it registers as the active device,
  // enabling full-track playback (and removing the "No full preview" badge).
  const handleSyncSpotify = useCallback(async (): Promise<void> => {
    await openPlatformDeepLink('spotify:');
    try {
      if (!adapterRef.current) adapterRef.current = createSpotifyAdapter();
      const current = await adapterRef.current.getCurrentTrack();
      if (current) await adapterRef.current.play(current.uri);
    } catch {
      // Spotify may not be ready as a playback device yet — the user can press play there.
    }
  }, []);

  const handleLogOut = () => setLogoutModalVisible(true);

  const handleReconnect = () => {
    Alert.alert(
      'Reconnect Spotify',
      'You will be signed out and redirected to log in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reconnect', onPress: () => void clearAuth() },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <TabHeader title="Settings" />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Zero-height anchor marking the top of the scroll content (used to compute the
            Auto-play Previews row's offset for the scroll-to-and-flash interaction). */}
        <View ref={contentTopRef} style={styles.contentTopAnchor} />

        {/* Account */}
        <Section title="ACCOUNT">
          <View style={styles.accountRow}>
            {profile.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="person" size={28} color={colors.onSurfaceVariant} />
              </View>
            )}
            <View style={styles.accountInfo}>
              <Text style={styles.accountName}>
                {profile.isLoading ? '—' : (profile.displayName ?? profile.email ?? 'Spotify User')}
              </Text>
              <Text style={styles.accountId} numberOfLines={1}>
                {profile.isLoading ? '' : (profile.spotifyId ? `spotify:${profile.spotifyId}` : '—')}
              </Text>
            </View>
          </View>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogOut}>
            <Text style={styles.logoutText}>Log Out</Text>
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
          {/* Custom Auto-play Previews row: toggle + a "Sync Spotify" action, with an
              animated background the swipe-card badge can flash to draw attention.
              The measurement ref sits on a plain View — measureLayout requires a native
              component, which an Animated.View wrapper is not. */}
          <View ref={autoPlayRowRef}>
            <Animated.View style={[styles.row, { backgroundColor: pulseBackground }]}>
              <View style={styles.rowTextGroup}>
                <Text style={styles.rowLabel}>Auto-play Previews</Text>
                <Text style={styles.rowSubtitle}>
                  Plays a 30s preview when no Spotify device is active
                </Text>
                <TouchableOpacity
                  style={styles.syncButton}
                  onPress={() => void handleSyncSpotify()}
                  accessibilityRole="button"
                  accessibilityLabel="Sync Spotify — open the Spotify app and start playback"
                >
                  <Ionicons name="sync" size={14} color={colors.primary} />
                  <Text style={styles.syncButtonText}>Sync Spotify</Text>
                </TouchableOpacity>
              </View>
              <Switch
                value={autoPlayPreviews}
                onValueChange={setAutoPlayPreviews}
                trackColor={{ false: colors.surfaceContainerHighest, true: colors.primary }}
                thumbColor={colors.surface}
                ios_backgroundColor={colors.surfaceContainerHighest}
              />
            </Animated.View>
          </View>
          <View style={styles.divider} />
          <ToggleRow
            label="Haptic Feedback on Swipe"
            value={hapticFeedback}
            onValueChange={setHapticFeedback}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="Auto-remove Duplicates"
            subtitle="After each session, clean duplicate tracks from your destination playlists"
            value={autoRemoveDuplicates}
            onValueChange={setAutoRemoveDuplicates}
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

        {/* Data */}
        <Section title="DATA">
          <TouchableOpacity
            style={styles.clearHistoryButton}
            onPress={() => setClearHistoryModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Clear history — delete all saved sessions from this device"
          >
            <Ionicons name="trash-outline" size={18} color={colors.nope} />
            <Text style={styles.clearHistoryText}>Clear History</Text>
          </TouchableOpacity>
        </Section>

        {/* About */}
        <Section title="ABOUT">
          <LinkRow
            label="Contact"
            onPress={() => router.push('/(tabs)/settings/contact')}
          />
          <View style={styles.divider} />
          <LinkRow
            label="Version"
            value={Constants.expoConfig?.version ?? '—'}
            onPress={() => void WebBrowser.openBrowserAsync('https://github.com/yarins0/music-swipe/releases')}
          />
          <View style={styles.divider} />
          <LinkRow label="Privacy Policy" onPress={() => router.push('/(tabs)/settings/privacy-policy')} />
          <View style={styles.divider} />
          <LinkRow label="Terms of Service" onPress={() => router.push('/(tabs)/settings/terms-of-service')} />
        </Section>

        {/* Branding footer */}
        <View style={styles.brandingFooter}>
          <View style={styles.brandingIcon}>
            <Ionicons name="musical-note" size={18} color={colors.surface} />
          </View>
          <Text style={styles.brandingText}>MUSICSWIPE</Text>
        </View>
      </ScrollView>

      <AppModal
        visible={logoutModalVisible}
        title="Log Out"
        message="Are you sure you want to log out of your Spotify account?"
        warning="Your liked history will be cleared from this device."
        confirmLabel="Log Out"
        confirmDestructive
        onConfirm={() => {
          setLogoutModalVisible(false);
          void clearAuth();
        }}
        onCancel={() => setLogoutModalVisible(false)}
      />

      <AppModal
        visible={clearHistoryModalVisible}
        title="Clear History?"
        message="This deletes every saved session and its liked-track history from this device, including any in-progress sessions you could resume."
        warning="Tracks already added to your Spotify playlists are not affected. This cannot be undone."
        confirmLabel="Clear History"
        confirmDestructive
        onConfirm={() => {
          setClearHistoryModalVisible(false);
          clearAllSessions();
        }}
        onCancel={() => setClearHistoryModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: 40,
    gap: spacing.lg,
  },
  contentTopAnchor: {
    height: 0,
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
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  syncButtonText: {
    fontSize: 13,
    fontFamily: 'Outfit_600SemiBold',
    color: colors.primary,
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
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
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
  clearHistoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  clearHistoryText: {
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
