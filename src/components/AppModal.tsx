import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing, radius } from '@/theme';

interface AppModalProps {
  visible: boolean;
  title: string;
  message: string;
  /** Optional highlighted warning shown between the message and buttons. */
  warning?: string;
  confirmLabel?: string;
  /** Renders the confirm button in the destructive (red) color. */
  confirmDestructive?: boolean;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AppModal({
  visible,
  title,
  message,
  warning,
  confirmLabel = 'Confirm',
  confirmDestructive = false,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: AppModalProps): React.ReactElement {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <Pressable style={styles.overlay} onPress={onCancel}>
        {/* Stop tap propagation so tapping the card doesn't dismiss */}
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          {warning ? (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>{warning}</Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              style={[styles.button, styles.cancelButton]}
              onPress={onCancel}
            >
              <Text style={styles.cancelLabel}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              style={[
                styles.button,
                confirmDestructive ? styles.destructiveButton : styles.confirmButton,
              ]}
              onPress={onConfirm}
            >
              <Text style={confirmDestructive ? styles.destructiveLabel : styles.confirmLabel}>
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Outfit_700Bold',
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
  message: {
    fontSize: 14,
    fontFamily: 'Outfit_400Regular',
    color: colors.onSurfaceVariant,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  warningBox: {
    backgroundColor: 'rgba(253,41,123,0.08)',
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  warningText: {
    fontSize: 13,
    fontFamily: 'Outfit_500Medium',
    color: colors.primary,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  button: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  cancelLabel: {
    fontSize: 15,
    fontFamily: 'Outfit_600SemiBold',
    color: colors.onSurfaceVariant,
  },
  confirmButton: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmLabel: {
    fontSize: 15,
    fontFamily: 'Outfit_600SemiBold',
    color: '#fff',
  },
  destructiveButton: {
    backgroundColor: colors.nope,
    shadowColor: colors.nope,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  destructiveLabel: {
    fontSize: 15,
    fontFamily: 'Outfit_600SemiBold',
    color: '#fff',
  },
});
