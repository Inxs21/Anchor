import { useEffect, useMemo } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Ocean } from '@/constants/theme';

type Props = {
  bars?: number;
  active?: boolean;
  color?: string;
};

export function Waveform({ bars = 18, active = true, color = Ocean.accent }: Props) {
  const values = useMemo(
    () => Array.from({ length: bars }, () => new Animated.Value(0.25)),
    [bars],
  );

  useEffect(() => {
    if (!active) {
      values.forEach((v) => v.setValue(0.25));
      return;
    }
    const animations = values.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 55),
          Animated.timing(v, { toValue: 1, duration: 400, useNativeDriver: false }),
          Animated.timing(v, { toValue: 0.25, duration: 400, useNativeDriver: false }),
          Animated.delay((bars - i) * 40),
        ]),
      ),
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, [active, values, bars]);

  return (
    <View style={styles.row}>
      {values.map((v, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            {
              backgroundColor: color,
              height: v.interpolate({ inputRange: [0, 1], outputRange: [6, 28] }),
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 32 },
  bar: { width: 3, borderRadius: 2, marginHorizontal: 2.5 },
});
