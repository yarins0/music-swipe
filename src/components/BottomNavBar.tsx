import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@/theme';

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

function resolveActiveTab(pathname: string): string {
  if (pathname.startsWith('/settings')) return 'Settings';
  if (pathname.startsWith('/matches')) return 'History';
  if (pathname.startsWith('/destination')) return 'Playlists';
  return 'Discover';
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
  const activeLabel = resolveActiveTab(pathname);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom || 8 }]}>
      {TAB_ITEMS.map((item) => (
        <NavTab
          key={item.label}
          item={item}
          isActive={item.label === activeLabel}
          onPress={() => router.push(item.route)}
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
