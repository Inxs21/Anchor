import { StyleSheet, Text, View } from 'react-native';
import { Ocean } from '@/constants/theme';

/**
 * One measured axis: what it is, what the number means in words, and the bar.
 * The word matters more than the percentage — "Pressured" reads; 0.81 does not.
 */
export function MetricRow({
  label,
  descriptor,
  value,
  color,
  last = false,
}: {
  label: string;
  descriptor: string;
  value: number;
  color: string;
  last?: boolean;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <View style={[styles.row, !last && styles.border]}>
      <View style={styles.left}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.descriptor, { color }]}>{descriptor}</Text>
      </View>
      <View style={styles.barWrap}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
        </View>
        <Text style={[styles.pct, { color }]}>{pct}%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13 },
  border: { borderBottomWidth: 1, borderBottomColor: Ocean.cardBorder },
  left: { width: 104, paddingRight: 12 },
  label: {
    color: Ocean.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  descriptor: { fontSize: 15, fontWeight: '700', marginTop: 2 },
  barWrap: { flex: 1 },
  track: { height: 6, borderRadius: 3, backgroundColor: Ocean.surface, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  pct: { fontSize: 11, fontWeight: '700', textAlign: 'right', marginTop: 5 },
});
