import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { Ocean, radius } from '@/constants/theme';

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'solid' | 'outline';
  style?: StyleProp<ViewStyle>;
};

export function PrimaryButton({ title, onPress, disabled, busy, variant = 'solid', style }: Props) {
  const isDisabled = disabled || busy;
  const outline = variant === 'outline';
  return (
    <TouchableOpacity
      style={[styles.base, outline ? styles.outline : styles.solid, isDisabled && styles.disabled, style]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
    >
      {busy ? (
        <ActivityIndicator color={outline ? Ocean.accent : Ocean.bg} />
      ) : (
        <Text style={[styles.text, outline && styles.outlineText]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  solid: { backgroundColor: Ocean.accent },
  outline: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Ocean.accent },
  disabled: { opacity: 0.5 },
  text: { color: Ocean.bg, fontSize: 16, fontWeight: '700' },
  outlineText: { color: Ocean.accent },
});
