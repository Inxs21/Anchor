import { StyleSheet, Text, View } from 'react-native';
import { Ocean, radius } from '@/constants/theme';

type Props = {
  label: string;
  value: number;
  min?: number;
  max?: number;
  color?: string;
  valueText?: string;
};

export function ScoreBar({ label, value, min = 0, max = 1, color = Ocean.accent, valueText }: Props) {
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, { color }]}>{valueText ?? `${Math.round(pct * 100)}%`}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  label: { color: Ocean.textSecondary, fontSize: 13, fontWeight: '600' },
  value: { fontSize: 13, fontWeight: '700' },
  track: {
    height: 8,
    borderRadius: radius.sm,
    backgroundColor: Ocean.surface,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.sm },
});
