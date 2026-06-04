import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Playlist } from '@/adapters/interface';
import { colors } from '@/theme';

type Scope = 'this-track' | 'from-now-on' | 'entire-session';

interface DestinationEditorProps {
  availablePlaylists: Playlist[];
  sessionDestinationIds: string[];
  perTrackOverrideIds: string[] | null;
  onClose: () => void;
  onThisTrack: (playlistIds: string[]) => void;
  onFromNowOn: (playlistIds: string[]) => void;
  onEntireSession: (added: string[], removed: string[], confirmedRemove: boolean) => void;
}

export function DestinationEditor({
  availablePlaylists,
  sessionDestinationIds,
  perTrackOverrideIds,
  onClose,
  onThisTrack,
  onFromNowOn,
  onEntireSession,
}: DestinationEditorProps): React.ReactElement {
  const [activeScope, setActiveScope] = useState<Scope>('this-track');
  const [selectedIds, setSelectedIds] = useState<string[]>(
    perTrackOverrideIds ?? sessionDestinationIds,
  );
  // Tracks whether the user has confirmed the destructive entire-session remove
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

  function togglePlaylist(id: string): void {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleConfirm(): void {
    if (activeScope === 'this-track') {
      onThisTrack(selectedIds);
      return;
    }

    if (activeScope === 'from-now-on') {
      onFromNowOn(selectedIds);
      return;
    }

    // entire-session: compute the diff against the current session defaults
    const added = selectedIds.filter((id) => !sessionDestinationIds.includes(id));
    const removed = sessionDestinationIds.filter((id) => !selectedIds.includes(id));

    if (removed.length > 0 && !showRemoveConfirm) {
      setShowRemoveConfirm(true);
      return;
    }

    onEntireSession(added, removed, true);
  }

  function handleCancelRemove(): void {
    setShowRemoveConfirm(false);
  }

  const removedPlaylists = availablePlaylists.filter(
    (p) => sessionDestinationIds.includes(p.id) && !selectedIds.includes(p.id),
  );

  const SCOPES: { key: Scope; label: string; description: string }[] = [
    {
      key: 'this-track',
      label: 'This track',
      description: 'Override destinations for this track only',
    },
    {
      key: 'from-now-on',
      label: 'From now on',
      description: 'Change destinations for all future likes',
    },
    {
      key: 'entire-session',
      label: 'Entire session',
      description: 'Apply retroactively to all liked tracks this session',
    },
  ];

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      {/* overlay fills the screen; sheet is anchored to the bottom */}
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />

      <View style={styles.sheet}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Destination Playlists</Text>
          <Pressable
            onPress={onClose}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={styles.closeIcon}>✕</Text>
          </Pressable>
        </View>

        {/* Scope selector */}
        <View style={styles.scopeRow}>
          {SCOPES.map(({ key, label }) => (
            <Pressable
              key={key}
              style={[styles.scopeButton, activeScope === key && styles.scopeButtonActive]}
              onPress={() => {
                setActiveScope(key);
                setShowRemoveConfirm(false);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: activeScope === key }}
            >
              <Text
                style={[styles.scopeLabel, activeScope === key && styles.scopeLabelActive]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.scopeDescription}>
          {SCOPES.find((s) => s.key === activeScope)?.description}
        </Text>

        {/* Playlist checkbox list */}
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {availablePlaylists.map((playlist) => {
            const isChecked = selectedIds.includes(playlist.id);
            return (
              <Pressable
                key={playlist.id}
                style={styles.playlistRow}
                onPress={() => togglePlaylist(playlist.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isChecked }}
              >
                <View style={[styles.checkbox, isChecked && styles.checkboxChecked]}>
                  {isChecked && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.playlistName} numberOfLines={1}>
                  {playlist.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Destructive remove confirmation */}
        {showRemoveConfirm && removedPlaylists.length > 0 && (
          <View style={styles.confirmBox}>
            <Text style={styles.confirmText}>
              Remove {removedPlaylists.length === 1
                ? `"${removedPlaylists[0].name}"`
                : `${removedPlaylists.length} playlists`}{' '}
              from all tracks liked this session?
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                style={[styles.confirmButton, styles.cancelButton]}
                onPress={handleCancelRemove}
                accessibilityRole="button"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmButton, styles.removeButton]}
                onPress={handleConfirm}
                accessibilityRole="button"
              >
                <Text style={styles.removeButtonText}>Yes, remove</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Confirm button */}
        {!showRemoveConfirm && (
          <Pressable
            style={styles.confirmPrimary}
            onPress={handleConfirm}
            accessibilityRole="button"
            accessibilityLabel="Confirm selection"
          >
            <Text style={styles.confirmPrimaryText}>Confirm</Text>
          </Pressable>
        )}
      </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    // Bottom sheet is an elevated surface — matches card/modal convention in session-end.tsx
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 32,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  title: {
    color: colors.onSurface,
    fontSize: 18,
    fontWeight: '700',
  },
  closeButton: {
    minWidth: 32,
    minHeight: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeIcon: {
    color: colors.onSurfaceVariant,
    fontSize: 18,
  },
  scopeRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 8,
  },
  scopeButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
  },
  scopeButtonActive: {
    borderColor: colors.primary,
    // Semi-transparent primary tint — no dedicated subtle-primary token exists in theme.ts.
    // rgba derived directly from colors.primary (#fd297b) at 10% opacity.
    backgroundColor: 'rgba(253,41,123,0.10)',
  },
  scopeLabel: {
    color: colors.onSurfaceVariant,
    fontSize: 12,
    fontWeight: '500',
  },
  scopeLabelActive: {
    color: colors.primary,
  },
  scopeDescription: {
    color: colors.onSurfaceVariant,
    fontSize: 12,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  list: {
    maxHeight: 260,
    marginHorizontal: 20,
  },
  listContent: {
    gap: 4,
    paddingBottom: 8,
  },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.outline,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: {
    // Text sitting directly on a primary-colored surface — matches ctaPrimaryText convention in session-end.tsx
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  playlistName: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 15,
  },
  confirmBox: {
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: 'rgba(255,80,80,0.12)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  confirmText: {
    color: colors.onSurface,
    fontSize: 14,
    lineHeight: 20,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  cancelButtonText: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: '600',
  },
  removeButton: {
    backgroundColor: 'rgba(255,60,60,0.8)',
  },
  removeButtonText: {
    // Text on a red destructive surface — no semantic token; '#fff' matches convention
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  confirmPrimary: {
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmPrimaryText: {
    // Text sitting directly on a primary-colored surface — matches ctaPrimaryText convention in session-end.tsx
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
