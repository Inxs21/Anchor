import { StyleSheet, Text, View } from 'react-native';
import { Ocean } from '@/constants/theme';

export type TrendPoint = {
  key: string;
  /** Normalized 0..1 for 'bar', or -1..1 for 'diverging'. */
  value: number;
  /** Overrides the strip colour for this point (used for mood polarity). */
  color?: string;
};

type Props = {
  title: string;
  /** Direct label for the latest value — the only number on the chart. */
  latest?: string;
  points: TrendPoint[];
  color?: string;
  mode?: 'bar' | 'diverging';
  /** Shaded target band, as a 0..1 range. Only meaningful for 'bar'. */
  band?: [number, number];
  footnote?: string;
  emptyText?: string;
};

const HEIGHT = 56;

/**
 * A single-series strip. Several of these stacked read as small multiples —
 * each keeps its own axis, which is why there is no combined multi-series chart
 * anywhere in the app. One series per strip means the title names it and no
 * legend is needed.
 */
export function TrendStrip({
  title,
  latest,
  points,
  color = Ocean.accent,
  mode = 'bar',
  band,
  footnote,
  emptyText = 'Not enough data yet.',
}: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>{title}</Text>
        {latest !== undefined && <Text style={[styles.latest, { color }]}>{latest}</Text>}
      </View>

      {points.length === 0 ? (
        <View style={[styles.plot, styles.empty]}>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      ) : (
        <View style={styles.plot}>
          {band && (
            <View
              pointerEvents="none"
              style={[
                styles.band,
                { bottom: `${band[0] * 100}%`, height: `${(band[1] - band[0]) * 100}%`, backgroundColor: color },
              ]}
            />
          )}
          {mode === 'diverging' && <View style={styles.midline} />}
          <View style={styles.bars}>
            {points.map((p) => {
              if (mode === 'diverging') {
                const magnitude = Math.min(Math.abs(p.value), 1);
                const up = p.value >= 0;
                return (
                  <View key={p.key} style={styles.col}>
                    <View style={styles.halfTop}>
                      {up && (
                        <View
                          style={[
                            styles.bar,
                            {
                              height: `${Math.max(magnitude * 100, 6)}%`,
                              backgroundColor: p.color ?? color,
                            },
                          ]}
                        />
                      )}
                    </View>
                    <View style={styles.halfBottom}>
                      {!up && (
                        <View
                          style={[
                            styles.barDown,
                            {
                              height: `${Math.max(magnitude * 100, 6)}%`,
                              backgroundColor: p.color ?? color,
                            },
                          ]}
                        />
                      )}
                    </View>
                  </View>
                );
              }
              return (
                <View key={p.key} style={styles.col}>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: `${Math.max(Math.min(p.value, 1) * 100, 5)}%`,
                        backgroundColor: p.color ?? color,
                      },
                    ]}
                  />
                </View>
              );
            })}
          </View>
        </View>
      )}

      {footnote && <Text style={styles.footnote}>{footnote}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 20 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { color: Ocean.textPrimary, fontSize: 14.5, fontWeight: '600' },
  latest: { fontSize: 14.5, fontWeight: '700' },
  plot: {
    height: HEIGHT,
    marginTop: 9,
    backgroundColor: Ocean.surface,
    borderRadius: 8,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  band: { position: 'absolute', left: 0, right: 0, opacity: 0.13 },
  midline: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: HEIGHT / 2 - 0.5,
    height: 1,
    backgroundColor: Ocean.cardBorder,
  },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: '100%', paddingHorizontal: 3 },
  col: { flex: 1, height: '100%', paddingHorizontal: 1, justifyContent: 'flex-end' },
  // 2px of surface between adjacent fills comes from the 1px padding each side.
  bar: { width: '100%', borderRadius: 2, minHeight: 3 },
  barDown: { width: '100%', borderRadius: 2, minHeight: 3 },
  halfTop: { height: '50%', justifyContent: 'flex-end' },
  halfBottom: { height: '50%', justifyContent: 'flex-start' },
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: Ocean.textMuted, fontSize: 13 },
  footnote: { color: Ocean.textMuted, fontSize: 12, marginTop: 7, lineHeight: 17 },
});
