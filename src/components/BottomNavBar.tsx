import { useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@/theme';
import { useSwipeStore } from '@/stores/swipeStore';

type TabItem = {
  label: string;
  iconActive: React.ComponentProps<typeof Ionicons>['name'];
  iconInactive: React.ComponentProps<typeof Ionicons>['name'];
  route: '/(app)' | '/(app)/matches' | '/(app)/settings';
};

const TAB_ITEMS: TabItem[] = [
  { label: 'Discover', iconActive: 'compass', iconInactive: 'compass-outline', route: '/(app)' },
  { label: 'Playlists', iconActive: 'library', iconInactive: 'library-outline', route: '/(app)' },
  { label: 'History', iconActive: 'time', iconInactive: 'time-outline', route: '/(app)/matches' },
  { label: 'Settings', iconActive: 'settings', iconInactive: 'settings-outline', route: '/(app)/settings' },
];

const TAB_COUNT = TAB_ITEMS.length;
const INDICATOR_SLIDE_MS = 220;

// Returns 0–3 matching TAB_ITEMS index.
// Root path is the source picker, so it maps to Playlists (1), not Discover (0).
function resolveActiveIndex(pathname: string): number {
  if (pathname.startsWith('/settings')) return 3;
  if (pathname.startsWith('/matches')) return 2;
  if (pathname.startsWith('/destination')) return 1;
  if (pathname.startsWith('/swipe')) return 0;
  return 1; // source picker (index.tsx) → Playlists
}

interface NavTabProps {
  item: TabItem;
  isActive: boolean;
  onPress: () => void;
}

function NavTab({ item, isActive, onPress }: NavTabProps): React.ReactElement {
  return (
    <TouchableOpacity
      style={styles.tab}
      onPress={onPress}
      accessibilityLabel={item.label}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
    >
      <Ionicons
        name={isActive ? item.iconActive : item.iconInactive}
        size={24}
        color={isActive ? colors.primary : colors.outline}
      />
      <Text style={[styles.label, isActive && styles.labelActive]}>
        {item.label}
      </Text>
    </TouchableOpacity>
  );
}

export function BottomNavBar(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const sessionId = useSwipeStore((s) => s.sessionId);
  const sourcePlaylistId = useSwipeStore((s) => s.sourcePlaylistId);
  const suspendSession = useSwipeStore((s) => s.suspendSession);

  const tabWidth = screenWidth / TAB_COUNT;
  const activeIndex = resolveActiveIndex(pathname);
  const indicatorAnim = useRef(new Animated.Value(activeIndex * tabWidth)).current;

  // Keep indicator aligned with actual pathname changes
  useEffect(() => {
    Animated.timing(indicatorAnim, {
      toValue: activeIndex * tabWidth,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, tabWidth, indicatorAnim]);

  const handlePress = useCallback(
    (item: TabItem) => {
      if (item.label === 'Discover') {
        // Already on swipe screen — no-op
        if (pathname.startsWith('/swipe')) return;

        if (sessionId && sourcePlaylistId) {
          // Use navigate (not push) so Expo Router pops back to the existing swipe
          // screen in the stack instead of mounting a brand-new instance.
          router.navigate({
            pathname: '/(app)/swipe/[playlistId]',
            params: { playlistId: sourcePlaylistId },
          });
        } else {
          // Slide indicator right to Playlists, then open source picker
          const playlistsIndex = TAB_ITEMS.findIndex((t) => t.label === 'Playlists');
          Animated.timing(indicatorAnim, {
            toValue: playlistsIndex * tabWidth,
            duration: INDICATOR_SLIDE_MS,
            useNativeDriver: true,
          }).start(() => router.navigate('/(app)'));
        }
      } else {
        // Suspend the swipe session instead of ending it when tabbing away
        if (pathname.startsWith('/swipe')) {
          suspendSession();
        }
        // Use navigate (not push) to avoid stacking duplicate tab screens
        router.navigate(item.route);
      }
    },
    [sessionId, sourcePlaylistId, pathname, suspendSession, router, indicatorAnim, tabWidth],
  );

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom || 8 }]}>
      <Animated.View
        style={[
          styles.indicator,
          { width: tabWidth, transform: [{ translateX: indicatorAnim }] },
        ]}
      />
      {TAB_ITEMS.map((item) => (
        <NavTab
          key={item.label}
          item={item}
          isActive={item.label === TAB_ITEMS[activeIndex]?.label}
          onPress={() => handlePress(item)}
        />
      ))}
    </View>
  );
}

export const NAV_BAR_HEIGHT = 64;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerHigh,
    paddingTop: 10,
  },
  indicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 2,
    backgroundColor: colors.primary,
    borderRadius: 1,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  label: {
    fontSize: 10,
    fontFamily: 'Outfit_600SemiBold',
    letterSpacing: 0.5,
    color: colors.outline,
  },
  labelActive: {
    color: colors.primary,
  },
});
