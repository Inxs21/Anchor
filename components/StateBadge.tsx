import { StyleSheet, Text, View } from 'react-native';
import { Ocean, stateColor, stateLabel, type MoodState } from '@/constants/theme';

export function StateBadge({ state, size = 'md' }: { state: MoodState; size?: 'sm' | 'md' }) {
  const color = stateColor(state);
  const small = size === 'sm';
  return (
    <View style={[styles.pill, { borderColor: color, backgroundColor: `${color}22` }, small && styles.pillSm]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color }, small && styles.textSm]}>{stateLabel[state]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  pillSm: { paddingHorizontal: 9, paddingVertical: 3 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  text: { fontSize: 14, fontWeight: '700' },
  textSm: { fontSize: 12 },
});
