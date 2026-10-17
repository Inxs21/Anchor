import { type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Ocean } from '@/constants/theme';

/**
 * On a phone the app fills the screen. In a desktop browser tab it would
 * otherwise stretch a one-column layout across 1900px, leaving slider rows and
 * text lines absurdly wide, so on web the whole app is centred in a
 * phone-width column with the surround painted in the app background.
 *
 * Native renders children untouched — no extra view in the tree.
 */
const MAX_WIDTH = 480;

export function AppFrame({ children }: { children: ReactNode }) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return (
    <View style={styles.backdrop}>
      <View style={styles.column}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: Ocean.bg, alignItems: 'center' },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: MAX_WIDTH,
    backgroundColor: Ocean.bg,
    // A hairline edge so the column reads as a device rather than as the page
    // simply failing to fill the window.
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: Ocean.cardBorder,
    overflow: 'hidden',
  },
});
