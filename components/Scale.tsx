import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ocean, radius } from '@/constants/theme';

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Captions for the extremes, e.g. ['Deeply low', 'Highly elevated']. */
  endLabels: [string, string];
  /** Colour for the selected segment; defaults to the app accent. */
  color?: string;
  onChange: (v: number) => void;
};

/**
 * A tappable integer scale. Chosen over a drag slider deliberately: a single
 * tap is easier when someone is slowed down or shaky, and it records an exact
 * value rather than whatever the finger landed on.
 */
export function Scale({ label, value, min, max, endLabels, color = Ocean.accent, onChange }: Props) {
  const steps = [];
  for (let v = min; v <= max; v++) steps.push(v);

  const select = (v: number) => {
    Haptics.selectionAsync().catch(() => {});
    onChange(v);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, { color }]}>
          {value > 0 && min < 0 ? '+' : ''}
          {value}
        </Text>
      </View>
      <View style={styles.row}>
        {steps.map((v) => {
          const selected = v === value;
          return (
            <TouchableOpacity
              key={v}
              style={[
                styles.step,
                selected && { backgroundColor: color, borderColor: color },
                steps.length > 8 && styles.stepTight,
              ]}
              onPress={() => select(v)}
              activeOpacity={0.7}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${label} ${v}`}
            >
              <Text style={[styles.stepText, selected && styles.stepTextSelected]}>{v}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.endRow}>
        <Text style={styles.endLabel}>{endLabels[0]}</Text>
        <Text style={styles.endLabel}>{endLabels[1]}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 22 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { color: Ocean.textPrimary, fontSize: 15, fontWeight: '600' },
  value: { fontSize: 17, fontWeight: '700' },
  row: { flexDirection: 'row', marginTop: 10 },
  step: {
    flex: 1,
    height: 42,
    borderRadius: radius.sm,
    backgroundColor: Ocean.surface,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 2.5,
  },
  stepTight: { marginHorizontal: 1.5 },
  stepText: { color: Ocean.textSecondary, fontSize: 13, fontWeight: '700' },
  stepTextSelected: { color: Ocean.bg },
  endRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 },
  endLabel: { color: Ocean.textMuted, fontSize: 12 },
});
