import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

interface SessionMosaicGridProps {
  albumArtUrls: string[];
}

const CELL_COUNT = 9;

export function SessionMosaicGrid({ albumArtUrls }: SessionMosaicGridProps): React.ReactElement {
  const cells = Array.from({ length: CELL_COUNT }, (_, i) => albumArtUrls[i] ?? null);

  return (
    <View style={styles.grid}>
      {cells.map((url, index) =>
        url ? (
          <Image
            key={index}
            source={{ uri: url }}
            style={styles.cell}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View key={index} style={[styles.cell, styles.placeholder]} />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    width: 270,
    height: 270,
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 12,
    overflow: 'hidden',
  },
  cell: {
    width: 90,
    height: 90,
  },
  placeholder: {
    backgroundColor: '#1e1e1e',
  },
});
