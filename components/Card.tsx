import { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ocean, radius } from '@/constants/theme';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Ocean.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    padding: 16,
  },
});
