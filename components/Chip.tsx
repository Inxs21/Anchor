import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ocean } from '@/constants/theme';

type Props = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

export function Chip({ label, selected, onPress }: Props) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.text, selected && styles.textSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: Ocean.surface,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    marginRight: 8,
    marginBottom: 8,
  },
  chipSelected: { backgroundColor: Ocean.accentDim, borderColor: Ocean.accent },
  text: { color: Ocean.textSecondary, fontSize: 14, fontWeight: '600' },
  textSelected: { color: Ocean.accent },
});
