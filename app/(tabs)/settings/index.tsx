import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Animated,
  useColorScheme,
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
import { getColors, Colors, spacing, radius } from '@/theme';
import type { ThemeMode } from '@/stores/prefsStore';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';

// ReturnType works here because createStyles is a function declaration (hoisted).
type StylesType = ReturnType<typeof createStyles>;

// "Sync Spotify" play-resume retry tuning — see handleSyncSpotify for why this retries.
const SYNC_PLAY_ATTEMPTS = 3;
const SYNC_PLAY_RETRY_DELAY_MS = 2500;

interface ToggleRowProps {
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  styles: StylesType;
  activeColors: Colors;
}

function ToggleRow({ label, subtitle, value, onValueChange, styles, activeColors }: ToggleRowProps): React.ReactElement {
  return (
    <View style={styles.row}>
      <View style={styles.rowTextGroup}>
        <Text style={styles.rowLabel}>{label}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: activeColors.surfaceContainerHighest, true: activeColors.primary }}
        thumbColor={activeColors.onSurfaceVariant}
        ios_backgroundColor={activeColors.surfaceContainerHighest}
      />
    </View>
  );
}

interface LinkRowProps {
  label: string;
  value?: string;
  onPress?: () => void;
  styles: StylesType;
  activeColors: Colors;
}

function LinkRow({ label, value, onPress, styles, activeColors }: LinkRowProps): React.ReactElement {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={!onPress}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowEnd}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        {onPress ? (
          <Ionicons name="chevron-forward" size={18} color={activeColors.outlineVariant} />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
  styles: StylesType;
}

function Section({ title, children, styles }: SectionProps): React.ReactElement {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

const THEME_OPTIONS: { key: ThemeMode; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
  { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
];

interface ThemeSegmentedPickerProps {
  value: ThemeMode;
  onChange: (value: ThemeMode) => void;
  activeColors: Colors;
}

function ThemeSegmentedPicker({ value, onChange, activeColors }: ThemeSegmentedPickerProps): React.ReactElement {
  return (
    <View style={[pickerStyles.container, { backgroundColor: activeColors.surfaceContainerHigh }]}>
      {THEME_OPTIONS.map((option) => {
        const isSelected = option.key === value;
        return (
          <TouchableOpacity
            key={option.key}
            style={[
              pickerStyles.option,
              isSelected && { backgroundColor: activeColors.primary },
            ]}
            onPress={() => onChange(option.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
          >
            <Ionicons
              name={option.icon}
              size={15}
              color={isSelected ? '#ffffff' : activeColors.onSurfaceVariant}
            />
            <Text
              style={[
                pickerStyles.optionLabel,
                { color: isSelected ? '#ffffff' : activeColors.onSurfaceVariant },
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// pickerStyles has no color dependencies — safe at module level.
const pickerStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    padding: 3,
    marginHorizontal: spacing.md,
    marginVertical: 12,
  },
  option: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  optionLabel: {
    fontSize: 13,
    fontFamily: 'Outfit_600SemiBold',
  },
});

export default function SettingsScreen(): React.ReactElement {
  const router = useRouter();
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const clearAllSessions = useSwipeStore((s) => s.clearAllSessions);

  const showAlbumArt = usePrefsStore((s) => s.showAlbumArt);
  const autoPlayMusic = usePrefsStore((s) => s.autoPlayMusic);
  const hapticFeedback = usePrefsStore((s) => s.hapticFeedback);
  const weeklyReminders = usePrefsStore((s) => s.weeklyReminders);
  const autoRemoveDuplicates = usePrefsStore((s) => s.autoRemoveDuplicates);
  const themeMode = usePrefsStore((s) => s.themeMode);
  const setShowAlbumArt = usePrefsStore((s) => s.setShowAlbumArt);
  const setAutoPlayMusic = usePrefsStore((s) => s.setAutoPlayMusic);
  const setHapticFeedback = usePrefsStore((s) => s.setHapticFeedback);
  const setWeeklyReminders = usePrefsStore((s) => s.setWeeklyReminders);
  const setAutoRemoveDuplicates = usePrefsStore((s) => s.setAutoRemoveDuplicates);
  const setThemeMode = usePrefsStore((s) => s.setThemeMode);

  const colorScheme = useColorScheme();
  const isDark =
    themeMode === 'dark' || (themeMode === 'system' && colorScheme === 'dark');
  const activeColors = useMemo(() => getColors(isDark), [isDark]);
  const styles = useMemo(() => createStyles(activeColors), [activeColors]);

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

  // --- Auto-play Music row: scroll-to + flash, driven by the swipe screen's badge ---
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

  // Scroll the Auto-play Music row into view and flash its background twice.
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
  // "Audio unavailable" badge), run the highlight once and clear the flag. Consume-on-focus
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
  // enabling full-track playback (and removing the "Audio unavailable" badge).
  //
  // Spotify needs a moment to come to the foreground and register itself as an active
  // playback device after the deep link fires — an immediate play attempt routinely
  // lands before that happens and silently no-ops. Retry a few times with a short
  // delay between attempts so sync succeeds without the user having to tap again.
  const handleSyncSpotify = useCallback(async (): Promise<void> => {
    await openPlatformDeepLink('spotify:');
    if (!adapterRef.current) adapterRef.current = createSpotifyAdapter();

    for (let attempt = 0; attempt < SYNC_PLAY_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, SYNC_PLAY_RETRY_DELAY_MS));
      }
      try {
        const current = await adapterRef.current.getCurrentTrack();
        if (current) {
          await adapterRef.current.play(current.uri);
          return;
        }
      } catch {
        // Spotify may not be ready as a playback device yet — retry below, or
        // give up after the last attempt and let the user press play there.
      }
    }
  }, []);

  const handleLogOut = () => setLogoutModalVisible(true);

  return (
    <View style={styles.screen}>
      <TabHeader title="Settings" />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Zero-height anchor marking the top of the scroll content (used to compute the
            Auto-play Music row's offset for the scroll-to-and-flash interaction). */}
        <View ref={contentTopRef} style={styles.contentTopAnchor} />

        {/* Account */}
        <Section title="ACCOUNT" styles={styles}>
          <View style={styles.accountRow}>
            {profile.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="person" size={28} color={activeColors.onSurfaceVariant} />
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

        {/* Appearance */}
        <Section title="APPEARANCE" styles={styles}>
          <ThemeSegmentedPicker
            value={themeMode}
            onChange={setThemeMode}
            activeColors={activeColors}
          />
        </Section>

        {/* Curation Preferences */}
        <Section title="CURATION PREFERENCES" styles={styles}>
          <ToggleRow
            label="Show Album Art"
            value={showAlbumArt}
            onValueChange={setShowAlbumArt}
            styles={styles}
            activeColors={activeColors}
          />
          <View style={styles.divider} />
          {/* Custom Auto-play Music row: toggle + a "Sync Spotify" action, with an
              animated background the swipe-card badge can flash to draw attention.
              The measurement ref sits on a plain View — measureLayout requires a native
              component, which an Animated.View wrapper is not. */}
          <View ref={autoPlayRowRef}>
            <Animated.View style={[styles.row, { backgroundColor: pulseBackground }]}>
              <View style={styles.rowTextGroup}>
                <Text style={styles.rowLabel}>Auto-play Music</Text>
                <Text style={styles.rowSubtitle}>
                  Start playback automatically when a card appears
                </Text>
                <TouchableOpacity
                  style={styles.syncButton}
                  onPress={() => void handleSyncSpotify()}
                  accessibilityRole="button"
                  accessibilityLabel="Sync Spotify — open the Spotify app and start playback"
                >
                  <Ionicons name="sync" size={14} color={activeColors.primary} />
                  <Text style={styles.syncButtonText}>Sync Spotify</Text>
                </TouchableOpacity>
              </View>
              <Switch
                value={autoPlayMusic}
                onValueChange={setAutoPlayMusic}
                trackColor={{ false: activeColors.surfaceContainerHighest, true: activeColors.primary }}
                thumbColor={activeColors.onSurfaceVariant}
                ios_backgroundColor={activeColors.surfaceContainerHighest}
              />
            </Animated.View>
          </View>
          <View style={styles.divider} />
          <ToggleRow
            label="Haptic Feedback on Swipe"
            value={hapticFeedback}
            onValueChange={setHapticFeedback}
            styles={styles}
            activeColors={activeColors}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="Auto-remove Duplicates"
            subtitle="After each session, clean duplicate tracks from your destination playlists"
            value={autoRemoveDuplicates}
            onValueChange={setAutoRemoveDuplicates}
            styles={styles}
            activeColors={activeColors}
          />
        </Section>

        {/* Notifications */}
        <Section title="NOTIFICATIONS" styles={styles}>
          <ToggleRow
            label="Weekly Curation Reminders"
            subtitle="Get notified when your pulse playlist is ready"
            value={weeklyReminders}
            onValueChange={setWeeklyReminders}
            styles={styles}
            activeColors={activeColors}
          />
        </Section>

        {/* Data */}
        <Section title="DATA" styles={styles}>
          <TouchableOpacity
            style={styles.clearHistoryButton}
            onPress={() => setClearHistoryModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Clear history — delete all saved sessions from this device"
          >
            <Ionicons name="trash-outline" size={18} color={activeColors.nope} />
            <Text style={styles.clearHistoryText}>Clear History</Text>
          </TouchableOpacity>
        </Section>

        {/* About */}
        <Section title="ABOUT" styles={styles}>
          <LinkRow
            label="Contact"
            onPress={() => router.push('/(tabs)/settings/contact')}
            styles={styles}
            activeColors={activeColors}
          />
          <View style={styles.divider} />
          <LinkRow
            label="Version"
            value={Constants.expoConfig?.version ?? '—'}
            onPress={() => void WebBrowser.openBrowserAsync('https://github.com/yarins0/music-swipe/releases')}
            styles={styles}
            activeColors={activeColors}
          />
          <View style={styles.divider} />
          <LinkRow
            label="Privacy Policy"
            onPress={() => router.push('/(tabs)/settings/privacy-policy')}
            styles={styles}
            activeColors={activeColors}
          />
          <View style={styles.divider} />
          <LinkRow
            label="Terms of Service"
            onPress={() => router.push('/(tabs)/settings/terms-of-service')}
            styles={styles}
            activeColors={activeColors}
          />
        </Section>

        {/* Branding footer */}
        <View style={styles.brandingFooter}>
          <View style={styles.brandingIcon}>
            <Ionicons name="musical-note" size={18} color={activeColors.surface} />
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

function createStyles(c: Colors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.background,
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
      color: c.onSurfaceVariant,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      paddingLeft: 4,
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
      color: c.onSurface,
    },
    rowSubtitle: {
      fontSize: 12,
      fontFamily: 'Outfit_400Regular',
      color: c.onSurfaceVariant,
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
      borderColor: c.primary,
    },
    syncButtonText: {
      fontSize: 13,
      fontFamily: 'Outfit_600SemiBold',
      color: c.primary,
    },
    rowEnd: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    rowValue: {
      fontSize: 13,
      fontFamily: 'Outfit_400Regular',
      color: c.onSurfaceVariant,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.surfaceContainerHigh,
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
      backgroundColor: c.surfaceContainerHigh,
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
      color: c.onSurface,
    },
    accountId: {
      fontSize: 13,
      fontFamily: 'Outfit_400Regular',
      color: c.onSurfaceVariant,
    },
    logoutButton: {
      paddingVertical: 14,
      alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.surfaceContainerHigh,
    },
    logoutText: {
      fontSize: 15,
      fontFamily: 'Outfit_600SemiBold',
      color: c.nope,
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
      color: c.nope,
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
      color: c.primary,
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
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    brandingText: {
      fontSize: 11,
      fontFamily: 'Outfit_600SemiBold',
      color: c.onSurfaceVariant,
      letterSpacing: 2,
    },
  });
}
