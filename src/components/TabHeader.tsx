import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '@/theme';

interface TabHeaderProps {
  title: string;
}

export function TabHeader({ title }: TabHeaderProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingBottom: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHigh,
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontFamily: 'Outfit_700Bold',
    color: colors.onSurface,
    letterSpacing: -0.3,
  },
});
