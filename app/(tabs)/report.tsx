import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Animated,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { Ocean } from '@/constants/theme';
import { getAllCheckins, type CheckinDoc } from '@/lib/checkins';


const { width: SCREEN_W } = Dimensions.get('window');
const CHART_H = 140;
const CHART_PAD = 16;
const CHART_W = SCREEN_W - 40 - CHART_PAD * 2;



// ─── Types ───────────────────────────────────────────────────────────────────

type TimeRange = '7d' | '14d' | '30d' | 'all';

// ─── Mini Sparkline Chart ────────────────────────────────────────────────────

function SparklineChart({
  data,
  color,
  min = 0,
  max = 1,
  label,
  unit = '',
  showDots = true,
}: {
  data: { date: string; value: number }[];
  color: string;
  min?: number;
  max?: number;
  label: string;
  unit?: string;
  showDots?: boolean;
}) {
  if (data.length === 0) return null;

  const range = max - min || 1;
  const latest = data[data.length - 1];
  const prev = data.length > 1 ? data[data.length - 2] : null;
  const delta = prev ? latest.value - prev.value : 0;
  const avg = data.reduce((s, d) => s + d.value, 0) / data.length;

  const points = data.map((d, i) => ({
    x: data.length === 1 ? CHART_W / 2 : (i / (data.length - 1)) * CHART_W,
    y: CHART_H - ((d.value - min) / range) * (CHART_H - 20) - 10,
  }));

  return (
    <View style={ch.container}>
      <View style={ch.header}>
        <Text style={ch.label}>{label}</Text>
        <View style={ch.headerRight}>
          <Text style={[ch.currentValue, { color }]}>
            {latest.value.toFixed(2)}{unit}
          </Text>
          {delta !== 0 && (
            <Text style={[ch.delta, { color: delta > 0 ? Ocean.success : Ocean.danger }]}>
              {delta > 0 ? '+' : ''}{delta.toFixed(2)}
            </Text>
          )}
        </View>
      </View>

      <View style={ch.chartArea}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
          <View
            key={pct}
            style={[ch.gridLine, { top: (1 - pct) * (CHART_H - 20) + 10 }]}
          />
        ))}

        {/* Avg line */}
        <View
          style={[
            ch.avgLine,
            { top: CHART_H - ((avg - min) / range) * (CHART_H - 20) - 10 },
          ]}
        />

        {/* Bars / line segments */}
        {points.map((pt, i) => (
          <View key={i}>
            {/* Connecting line to next point */}
            {i < points.length - 1 && (
              <View
                style={[
                  ch.lineSegment,
                  {
                    left: pt.x,
                    top: Math.min(pt.y, points[i + 1].y),
                    width: Math.sqrt(
                      (points[i + 1].x - pt.x) ** 2 +
                      (points[i + 1].y - pt.y) ** 2
                    ),
                    transform: [{
                      rotate: `${Math.atan2(
                        points[i + 1].y - pt.y,
                        points[i + 1].x - pt.x
                      )}rad`,
                    }],
                    transformOrigin: 'left top',
                    backgroundColor: color + '88',
                  },
                ]}
              />
            )}
            {/* Dot */}
            {showDots && (
              <View
                style={[
                  ch.dot,
                  {
                    left: pt.x - 3,
                    top: pt.y - 3,
                    backgroundColor: color,
                    borderColor: color + '44',
                  },
                ]}
              />
            )}
          </View>
        ))}

        {/* Date labels */}
        {data.length > 1 && (
          <View style={ch.dateRow}>
            <Text style={ch.dateLabel}>{formatDate(data[0].date)}</Text>
            <Text style={ch.dateLabel}>{formatDate(latest.date)}</Text>
          </View>
        )}
      </View>

      <View style={ch.statsRow}>
        <StatPill label="Avg" value={avg.toFixed(2)} />
        <StatPill label="Min" value={Math.min(...data.map(d => d.value)).toFixed(2)} />
        <StatPill label="Max" value={Math.max(...data.map(d => d.value)).toFixed(2)} />
      </View>
    </View>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={ch.statPill}>
      <Text style={ch.statPillLabel}>{label}</Text>
      <Text style={ch.statPillValue}>{value}</Text>
    </View>
  );
}

const ch = StyleSheet.create({
  container:    { marginBottom: 14 },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  headerRight:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label:        { fontSize: 13, fontWeight: '600', color: Ocean.textSecondary },
  currentValue: { fontSize: 15, fontWeight: '700' },
  delta:        { fontSize: 11, fontWeight: '600' },
  chartArea:    { height: CHART_H, position: 'relative', overflow: 'hidden' },
  gridLine:     { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: Ocean.cardBorder + '44' },
  avgLine:      { position: 'absolute', left: 0, right: 0, height: 1, borderWidth: 1, borderColor: Ocean.textMuted + '44', borderStyle: 'dashed' },
  lineSegment:  { position: 'absolute', height: 2, borderRadius: 1 },
  dot:          { position: 'absolute', width: 6, height: 6, borderRadius: 3, borderWidth: 2 },
  dateRow:      { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between' },
  dateLabel:    { fontSize: 10, color: Ocean.textMuted },
  statsRow:     { flexDirection: 'row', gap: 8, marginTop: 8 },
  statPill:     { flexDirection: 'row', gap: 4, backgroundColor: Ocean.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statPillLabel:{ fontSize: 10, color: Ocean.textMuted, fontWeight: '600' },
  statPillValue:{ fontSize: 10, color: Ocean.textSecondary, fontWeight: '700' },
});

// ─── State Distribution Bar ──────────────────────────────────────────────────

function StateDistribution({ checkins }: { checkins: CheckinDoc[] }) {
  const counts = { stable: 0, elevated: 0, low: 0, mixed: 0 };
  checkins.forEach(c => { counts[c.todayState] = (counts[c.todayState] ?? 0) + 1; });
  const total = checkins.length || 1;

  const segments: { key: string; pct: number; color: string; label: string }[] = [
    { key: 'stable',   pct: counts.stable / total,   color: Ocean.accent,  label: 'Stable' },
    { key: 'elevated', pct: counts.elevated / total,  color: Ocean.warning, label: 'Elevated' },
    { key: 'low',      pct: counts.low / total,       color: '#7B8FD4',     label: 'Low' },
    { key: 'mixed',    pct: counts.mixed / total,      color: Ocean.danger,  label: 'Mixed' },
  ].filter(s => s.pct > 0);

  return (
    <View>
      <View style={sd.barContainer}>
        {segments.map(s => (
          <View
            key={s.key}
            style={[sd.segment, { flex: s.pct, backgroundColor: s.color }]}
          />
        ))}
      </View>
      <View style={sd.legendRow}>
        {segments.map(s => (
          <View key={s.key} style={sd.legendItem}>
            <View style={[sd.legendDot, { backgroundColor: s.color }]} />
            <Text style={sd.legendText}>
              {s.label} {(s.pct * 100).toFixed(0)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const sd = StyleSheet.create({
  barContainer: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 },
  segment:      { borderRadius: 4 },
  legendRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  legendItem:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot:    { width: 8, height: 8, borderRadius: 4 },
  legendText:   { fontSize: 11, color: Ocean.textSecondary, fontWeight: '600' },
});

// ─── Risk Timeline ───────────────────────────────────────────────────────────

function RiskTimeline({ checkins }: { checkins: CheckinDoc[] }) {
  const riskColor = (r: string) =>
    r === 'high' ? Ocean.danger : r === 'medium' ? Ocean.warning : Ocean.success;

  return (
    <View style={rt.container}>
      {checkins.slice(-10).map((c, i) => (
        <View key={c.date} style={rt.item}>
          <View style={[rt.dot, { backgroundColor: riskColor(c.riskLevel) }]} />
          <View style={rt.info}>
            <Text style={rt.date}>{formatDate(c.date)}</Text>
            <Text style={[rt.level, { color: riskColor(c.riskLevel) }]}>
              {c.riskLevel.toUpperCase()}
            </Text>
          </View>
          {c.flagged && <Text style={rt.flag}>flagged</Text>}
          {i < checkins.slice(-10).length - 1 && <View style={rt.line} />}
        </View>
      ))}
    </View>
  );
}

const rt = StyleSheet.create({
  container: {},
  item:      { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, position: 'relative' },
  dot:       { width: 10, height: 10, borderRadius: 5, zIndex: 1 },
  line:      { position: 'absolute', left: 4, top: 14, width: 2, height: 18, backgroundColor: Ocean.cardBorder },
  info:      { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  date:      { fontSize: 12, color: Ocean.textSecondary },
  level:     { fontSize: 12, fontWeight: '700' },
  flag:      { fontSize: 10, color: Ocean.danger, fontWeight: '700', textTransform: 'uppercase' },
});

// ─── Emotion Frequency ───────────────────────────────────────────────────────

function EmotionFrequency({ checkins }: { checkins: CheckinDoc[] }) {
  const freq: Record<string, { total: number; count: number }> = {};
  checkins.forEach(c => {
    c.topEmotions?.forEach(e => {
      if (!freq[e.name]) freq[e.name] = { total: 0, count: 0 };
      freq[e.name].total += e.score;
      freq[e.name].count += 1;
    });
  });

  const sorted = Object.entries(freq)
    .map(([name, { total, count }]) => ({ name, avgScore: total / count, appearances: count }))
    .sort((a, b) => b.appearances - a.appearances)
    .slice(0, 8);

  if (sorted.length === 0) return null;
  const maxAppearances = sorted[0].appearances;

  return (
    <View>
      {sorted.map(e => (
        <View key={e.name} style={ef.row}>
          <Text style={ef.name}>{e.name}</Text>
          <View style={ef.barTrack}>
            <View style={[ef.barFill, { width: `${(e.appearances / maxAppearances) * 100}%` }]} />
          </View>
          <Text style={ef.count}>{e.appearances}x</Text>
        </View>
      ))}
    </View>
  );
}

const ef = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  name:     { width: 80, fontSize: 12, color: Ocean.textSecondary, fontWeight: '600' },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Ocean.surface, overflow: 'hidden' },
  barFill:  { height: 6, borderRadius: 3, backgroundColor: Ocean.accent + 'AA' },
  count:    { width: 28, fontSize: 11, color: Ocean.textMuted, textAlign: 'right', fontWeight: '700' },
});

// ─── Insight Card ────────────────────────────────────────────────────────────

function InsightCard({ icon, title, body, color = Ocean.accent }: {
  icon: string; title: string; body: string; color?: string;
}) {
  return (
    <View style={[ins.card, { borderLeftColor: color }]}>
      <Text style={ins.icon}>{icon}</Text>
      <View style={ins.textWrap}>
        <Text style={ins.title}>{title}</Text>
        <Text style={ins.body}>{body}</Text>
      </View>
    </View>
  );
}

const ins = StyleSheet.create({
  card:     { flexDirection: 'row', gap: 12, backgroundColor: Ocean.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 3 },
  icon:     { fontSize: 20 },
  textWrap: { flex: 1 },
  title:    { fontSize: 13, fontWeight: '700', color: Ocean.textPrimary, marginBottom: 3 },
  body:     { fontSize: 12, color: Ocean.textSecondary, lineHeight: 18 },
});

// ─── Episode Trajectory Indicator ────────────────────────────────────────────

type Trajectory = {
  status: 'stable' | 'trending-manic' | 'trending-depressive' | 'entering-manic' | 'entering-depressive' | 'mixed-risk' | 'insufficient';
  confidence: number;     // 0–1
  manicTrend: number;     // -1 to 1, direction + magnitude
  depressiveTrend: number;
  signals: string[];
  recommendation: string;
};

function computeTrajectory(checkins: CheckinDoc[]): Trajectory {
  const insufficient: Trajectory = {
    status: 'insufficient', confidence: 0, manicTrend: 0, depressiveTrend: 0,
    signals: [], recommendation: 'Complete at least 3 check-ins to enable episode tracking.',
  };

  // Need minimum 3 data points for meaningful trend
  const recent = checkins.slice(-7);
  if (recent.length < 3) return insufficient;

  const withIndices = recent.filter(c => c.bipolarIndices);
  const n = withIndices.length;

  // Weighted averages — more recent days count more
  // Weights: latest = 1.0, next = 0.85, next = 0.7, ...
  const weight = (i: number) => 1 - (n - 1 - i) * 0.15;

  let wManicSum = 0, wDepressSum = 0, wTotal = 0;
  let wEnergySum = 0, wValenceSum = 0, wArousalSum = 0;
  withIndices.forEach((c, i) => {
    const w = Math.max(0.3, weight(i));
    wManicSum += (c.bipolarIndices?.manicIndex ?? 0) * w;
    wDepressSum += (c.bipolarIndices?.depressiveIndex ?? 0) * w;
    wEnergySum += c.humeScores.energy * w;
    wValenceSum += c.humeScores.valence * w;
    wArousalSum += c.humeScores.arousal * w;
    wTotal += w;
  });
  const wManicAvg = wManicSum / wTotal;
  const wDepressAvg = wDepressSum / wTotal;
  const wEnergyAvg = wEnergySum / wTotal;
  const wValenceAvg = wValenceSum / wTotal;
  const wArousalAvg = wArousalSum / wTotal;

  // Linear trend: compare first half vs second half
  const half = Math.floor(n / 2);
  const firstHalf = withIndices.slice(0, half);
  const secondHalf = withIndices.slice(half);
  const avgOf = (arr: CheckinDoc[], fn: (c: CheckinDoc) => number) =>
    arr.length > 0 ? arr.reduce((s, c) => s + fn(c), 0) / arr.length : 0;

  const manicFirst = avgOf(firstHalf, c => c.bipolarIndices?.manicIndex ?? 0);
  const manicSecond = avgOf(secondHalf, c => c.bipolarIndices?.manicIndex ?? 0);
  const depressFirst = avgOf(firstHalf, c => c.bipolarIndices?.depressiveIndex ?? 0);
  const depressSecond = avgOf(secondHalf, c => c.bipolarIndices?.depressiveIndex ?? 0);
  const manicTrend = manicSecond - manicFirst;
  const depressiveTrend = depressSecond - depressFirst;

  // Also check voice-level signals across all recent (not just those with indices)
  const wpmData = recent.filter(c => c.speechRate).map(c => c.speechRate!.wordsPerMinute);
  const avgWpm = wpmData.length > 0 ? wpmData.reduce((s, v) => s + v, 0) / wpmData.length : 130;
  const emotRangeData = recent.filter(c => c.prosody).map(c => c.prosody!.emotionalRange);
  const avgEmotRange = emotRangeData.length > 0 ? emotRangeData.reduce((s, v) => s + v, 0) / emotRangeData.length : 0.5;
  const coherenceData = recent.filter(c => c.speechOrganization).map(c => c.speechOrganization!.topicCoherence);
  const avgCoherence = coherenceData.length > 0 ? coherenceData.reduce((s, v) => s + v, 0) / coherenceData.length : 5;

  // Count state occurrences
  const stateCounts = { stable: 0, elevated: 0, low: 0, mixed: 0 };
  recent.forEach(c => { stateCounts[c.todayState] = (stateCounts[c.todayState] ?? 0) + 1; });
  const flaggedCount = recent.filter(c => c.flagged).length;

  // Build signal list & score
  const signals: string[] = [];
  let manicScore = 0;
  let depressScore = 0;

  // Bipolar index levels
  if (wManicAvg > 0.5) { manicScore += 2; signals.push(`Elevated manic index (${wManicAvg.toFixed(2)})`); }
  else if (wManicAvg > 0.3) { manicScore += 1; signals.push(`Rising manic index (${wManicAvg.toFixed(2)})`); }

  if (wDepressAvg > 0.5) { depressScore += 2; signals.push(`Elevated depressive index (${wDepressAvg.toFixed(2)})`); }
  else if (wDepressAvg > 0.3) { depressScore += 1; signals.push(`Rising depressive index (${wDepressAvg.toFixed(2)})`); }

  // Trend direction (accelerating)
  if (manicTrend > 0.15) { manicScore += 1.5; signals.push('Manic index accelerating upward'); }
  else if (manicTrend > 0.05) { manicScore += 0.5; }
  if (depressiveTrend > 0.15) { depressScore += 1.5; signals.push('Depressive index accelerating upward'); }
  else if (depressiveTrend > 0.05) { depressScore += 0.5; }

  // Voice prosody signals
  if (wEnergyAvg > 0.75) { manicScore += 0.5; signals.push('Consistently high vocal energy'); }
  if (wEnergyAvg < 0.25) { depressScore += 0.5; signals.push('Consistently low vocal energy'); }
  if (wValenceAvg < -0.35) { depressScore += 0.5; signals.push('Persistent negative emotional tone'); }
  if (wArousalAvg > 0.7) { manicScore += 0.5; signals.push('High agitation/arousal'); }
  if (wArousalAvg < 0.2) { depressScore += 0.5; signals.push('Very low arousal (psychomotor slowing)'); }

  // Speech rate
  if (avgWpm > 170) { manicScore += 1; signals.push(`Pressured speech (${avgWpm.toFixed(0)} wpm)`); }
  if (avgWpm < 85) { depressScore += 1; signals.push(`Poverty of speech (${avgWpm.toFixed(0)} wpm)`); }

  // Emotional range
  if (avgEmotRange > 0.7) { manicScore += 0.5; signals.push('High emotional lability'); }
  if (avgEmotRange < 0.2) { depressScore += 0.5; signals.push('Flat affect / blunted prosody'); }

  // Coherence
  if (avgCoherence < 4) { manicScore += 0.5; signals.push('Disorganized speech / flight of ideas'); }

  // State pattern
  if (stateCounts.elevated >= 3) { manicScore += 1; signals.push(`${stateCounts.elevated} elevated states in ${recent.length} days`); }
  if (stateCounts.low >= 3) { depressScore += 1; signals.push(`${stateCounts.low} low states in ${recent.length} days`); }
  if (flaggedCount >= 2) { signals.push(`${flaggedCount} flagged check-ins`); }

  // Determine status
  const totalSignals = manicScore + depressScore;
  const confidence = Math.min(1, totalSignals / 6);
  let status: Trajectory['status'] = 'stable';
  let recommendation = 'Your multi-day pattern looks stable. Keep checking in daily.';

  if (manicScore >= 4) {
    status = 'entering-manic';
    recommendation = 'Multiple signals suggest you may be entering a manic or hypomanic episode. Contact your psychiatrist or care team promptly.';
  } else if (depressScore >= 4) {
    status = 'entering-depressive';
    recommendation = 'Multiple signals suggest you may be entering a depressive episode. Reach out to your care team and lean on your support network.';
  } else if (manicScore >= 2.5 && depressScore >= 2.5) {
    status = 'mixed-risk';
    recommendation = 'Mixed signals detected — both manic and depressive indicators are present. This pattern warrants clinical attention.';
  } else if (manicScore >= 2) {
    status = 'trending-manic';
    recommendation = 'Some early manic indicators are appearing. Monitor closely and maintain sleep hygiene and routines.';
  } else if (depressScore >= 2) {
    status = 'trending-depressive';
    recommendation = 'Some early depressive indicators are appearing. Stay engaged with activities and consider reaching out early.';
  }

  return { status, confidence, manicTrend, depressiveTrend, signals, recommendation };
}

function EpisodeTrajectoryCard({ checkins }: { checkins: CheckinDoc[] }) {
  const t = computeTrajectory(checkins);

  if (t.status === 'insufficient') {
    return (
      <View style={[ep.card, { borderColor: Ocean.cardBorder }]}>
        <View style={ep.headerRow}>
          <View style={[ep.iconCircle, { backgroundColor: Ocean.textMuted + '22' }]}>
            <Text style={ep.iconText}>?</Text>
          </View>
          <View style={ep.headerText}>
            <Text style={ep.statusLabel}>Episode Tracking</Text>
            <Text style={[ep.statusValue, { color: Ocean.textMuted }]}>Insufficient Data</Text>
          </View>
        </View>
        <Text style={ep.recommendation}>{t.recommendation}</Text>
      </View>
    );
  }

  const config = {
    'stable':               { color: Ocean.success, icon: '✓', label: 'Stable',               bg: Ocean.success },
    'trending-manic':       { color: Ocean.warning, icon: '↑', label: 'Trending Elevated',     bg: Ocean.warning },
    'trending-depressive':  { color: '#7B8FD4',     icon: '↓', label: 'Trending Low',          bg: '#7B8FD4' },
    'entering-manic':       { color: Ocean.warning, icon: '⚡', label: 'Possible Manic Episode', bg: Ocean.warning },
    'entering-depressive':  { color: '#7B8FD4',     icon: '▼', label: 'Possible Depressive Episode', bg: '#7B8FD4' },
    'mixed-risk':           { color: Ocean.danger,  icon: '⚠', label: 'Mixed State Risk',      bg: Ocean.danger },
  }[t.status];

  const isAlert = t.status.startsWith('entering') || t.status === 'mixed-risk';
  const isTrending = t.status.startsWith('trending');

  return (
    <View style={[ep.card, { borderColor: isAlert ? config.color : Ocean.cardBorder, borderWidth: isAlert ? 2 : 1 }]}>
      {/* Status Header */}
      <View style={ep.headerRow}>
        <View style={[ep.iconCircle, { backgroundColor: config.bg + '22' }]}>
          <Text style={[ep.iconText, { color: config.color }]}>{config.icon}</Text>
        </View>
        <View style={ep.headerText}>
          <Text style={ep.statusLabel}>Multi-Day Episode Tracker</Text>
          <Text style={[ep.statusValue, { color: config.color }]}>{config.label}</Text>
        </View>
        <View style={[ep.confidencePill, { backgroundColor: config.bg + '22' }]}>
          <Text style={[ep.confidenceText, { color: config.color }]}>
            {(t.confidence * 100).toFixed(0)}%
          </Text>
        </View>
      </View>

      {/* Trend Gauges */}
      <View style={ep.gaugeRow}>
        <View style={ep.gauge}>
          <Text style={ep.gaugeLabel}>Manic Signal</Text>
          <View style={ep.gaugeTrack}>
            <View style={[ep.gaugeFill, {
              width: `${Math.min(100, Math.max(0, (t.manicTrend + 0.5) / 1 * 100))}%`,
              backgroundColor: Ocean.warning,
            }]} />
          </View>
          <Text style={[ep.gaugeValue, {
            color: t.manicTrend > 0.05 ? Ocean.warning : Ocean.textMuted,
          }]}>
            {t.manicTrend > 0 ? '+' : ''}{t.manicTrend.toFixed(2)}
          </Text>
        </View>
        <View style={ep.gauge}>
          <Text style={ep.gaugeLabel}>Depressive Signal</Text>
          <View style={ep.gaugeTrack}>
            <View style={[ep.gaugeFill, {
              width: `${Math.min(100, Math.max(0, (t.depressiveTrend + 0.5) / 1 * 100))}%`,
              backgroundColor: '#7B8FD4',
            }]} />
          </View>
          <Text style={[ep.gaugeValue, {
            color: t.depressiveTrend > 0.05 ? '#7B8FD4' : Ocean.textMuted,
          }]}>
            {t.depressiveTrend > 0 ? '+' : ''}{t.depressiveTrend.toFixed(2)}
          </Text>
        </View>
      </View>

      {/* Contributing Signals */}
      {t.signals.length > 0 && (
        <View style={ep.signalsWrap}>
          <Text style={ep.signalsTitle}>Contributing signals ({t.signals.length})</Text>
          {t.signals.map((sig, i) => (
            <View key={i} style={ep.signalRow}>
              <View style={[ep.signalDot, { backgroundColor: config.color }]} />
              <Text style={ep.signalText}>{sig}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Recommendation */}
      <View style={[ep.recBox, { backgroundColor: config.bg + '11' }]}>
        <Text style={ep.recommendation}>{t.recommendation}</Text>
      </View>

      <Text style={ep.disclaimer}>
        Based on {checkins.slice(-7).length}-day rolling analysis. Not a clinical diagnosis.
      </Text>
    </View>
  );
}

const ep = StyleSheet.create({
  card:           { backgroundColor: Ocean.card, borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
  headerRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  iconCircle:     { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  iconText:       { fontSize: 18, fontWeight: '800' },
  headerText:     { flex: 1 },
  statusLabel:    { fontSize: 10, fontWeight: '700', color: Ocean.textMuted, letterSpacing: 1, textTransform: 'uppercase' },
  statusValue:    { fontSize: 17, fontWeight: '800', marginTop: 2 },
  confidencePill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  confidenceText: { fontSize: 11, fontWeight: '700' },
  gaugeRow:       { flexDirection: 'row', gap: 12, marginBottom: 14 },
  gauge:          { flex: 1 },
  gaugeLabel:     { fontSize: 11, color: Ocean.textMuted, fontWeight: '600', marginBottom: 4 },
  gaugeTrack:     { height: 6, borderRadius: 3, backgroundColor: Ocean.surface, overflow: 'hidden' },
  gaugeFill:      { height: 6, borderRadius: 3 },
  gaugeValue:     { fontSize: 11, fontWeight: '700', marginTop: 3, textAlign: 'right' },
  signalsWrap:    { marginBottom: 12 },
  signalsTitle:   { fontSize: 10, fontWeight: '700', color: Ocean.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 },
  signalRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 5 },
  signalDot:      { width: 5, height: 5, borderRadius: 3, marginTop: 5 },
  signalText:     { flex: 1, fontSize: 12, color: Ocean.textSecondary, lineHeight: 16 },
  recBox:         { borderRadius: 10, padding: 12, marginBottom: 8 },
  recommendation: { fontSize: 13, color: Ocean.textSecondary, lineHeight: 19 },
  disclaimer:     { fontSize: 10, color: Ocean.textMuted, fontStyle: 'italic', textAlign: 'center' },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
}

function generateInsights(checkins: CheckinDoc[]): { icon: string; title: string; body: string; color: string }[] {
  if (checkins.length === 0) return [];
  const insights: { icon: string; title: string; body: string; color: string }[] = [];
  const recent = checkins.slice(-7);

  // Stability streak
  const stableStreak = [...checkins].reverse().findIndex(c => c.todayState !== 'stable');
  if (stableStreak >= 3) {
    insights.push({
      icon: '🟢', title: `${stableStreak}-day stable streak`,
      body: `You've maintained stability for ${stableStreak} consecutive check-ins. Keep up your routines.`,
      color: Ocean.success,
    });
  }

  // Elevated episodes
  const elevatedCount = recent.filter(c => c.todayState === 'elevated').length;
  if (elevatedCount >= 2) {
    insights.push({
      icon: '🟡', title: 'Elevated pattern detected',
      body: `${elevatedCount} elevated readings in the last ${recent.length} check-ins. Monitor for hypomanic escalation.`,
      color: Ocean.warning,
    });
  }

  // Depressive trend
  const lowCount = recent.filter(c => c.todayState === 'low').length;
  if (lowCount >= 2) {
    insights.push({
      icon: '🔵', title: 'Low mood pattern',
      body: `${lowCount} low readings recently. Consider discussing with your care team if this persists.`,
      color: '#7B8FD4',
    });
  }

  // Speech rate trends
  const wpmData = recent.filter(c => c.speechRate).map(c => c.speechRate!.wordsPerMinute);
  if (wpmData.length >= 2) {
    const avgWpm = wpmData.reduce((s, v) => s + v, 0) / wpmData.length;
    if (avgWpm > 160) {
      insights.push({
        icon: '🗣️', title: 'Pressured speech trend',
        body: `Average ${avgWpm.toFixed(0)} wpm recently (normal: 120-150). May indicate elevated energy.`,
        color: Ocean.warning,
      });
    } else if (avgWpm < 90) {
      insights.push({
        icon: '🤫', title: 'Reduced speech output',
        body: `Average ${avgWpm.toFixed(0)} wpm recently (normal: 120-150). May indicate low energy or depression.`,
        color: '#7B8FD4',
      });
    }
  }

  // Valence trend
  const valenceData = recent.map(c => c.humeScores.valence);
  const avgValence = valenceData.reduce((s, v) => s + v, 0) / valenceData.length;
  if (avgValence < -0.3) {
    insights.push({
      icon: '📉', title: 'Negative emotional tone',
      body: `Your voice has carried a predominantly negative valence (${avgValence.toFixed(2)}) over recent check-ins.`,
      color: Ocean.danger,
    });
  } else if (avgValence > 0.3) {
    insights.push({
      icon: '📈', title: 'Positive emotional tone',
      body: `Your voice has carried a predominantly positive valence (${avgValence.toFixed(2)}) recently.`,
      color: Ocean.success,
    });
  }

  // Flagged check-ins
  const flaggedCount = recent.filter(c => c.flagged).length;
  if (flaggedCount > 0) {
    insights.push({
      icon: '🚩', title: `${flaggedCount} flagged check-in${flaggedCount > 1 ? 's' : ''} recently`,
      body: 'Patterns were detected that may warrant attention from your care team.',
      color: Ocean.danger,
    });
  }

  // High risk
  const highRisk = recent.filter(c => c.riskLevel === 'high').length;
  if (highRisk > 0) {
    insights.push({
      icon: '⚠️', title: `${highRisk} high-risk assessment${highRisk > 1 ? 's' : ''}`,
      body: 'Multiple strong signals were detected. Please consider contacting your support network.',
      color: Ocean.danger,
    });
  }

  if (insights.length === 0) {
    insights.push({
      icon: '✨', title: 'Looking steady',
      body: 'No concerning patterns detected in your recent check-ins. Keep checking in regularly.',
      color: Ocean.accent,
    });
  }

  return insights;
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ReportScreen() {
  const { user } = useAuth();
  const uid = user?.uid ?? '';

  const [loading, setLoading] = useState(true);
  const [checkins, setCheckins] = useState<CheckinDoc[]>([]);
  const [range, setRange] = useState<TimeRange>('30d');
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    getAllCheckins(uid).then(data => {
      setCheckins(data);
      setLoading(false);
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    });
  }, [uid]);

  const filtered = useCallback(() => {
    if (range === 'all') return checkins;
    const days = range === '7d' ? 7 : range === '14d' ? 14 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return checkins.filter(c => c.date >= cutoffStr);
  }, [checkins, range])();

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.loadingWrap}>
          <ActivityIndicator color={Ocean.accent} size="large" />
          <Text style={s.loadingText}>Loading analytics...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (checkins.length === 0) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.loadingWrap}>
          <Text style={s.emptyIcon}>📊</Text>
          <Text style={s.emptyTitle}>No Check-ins Yet</Text>
          <Text style={s.emptyBody}>
            Complete your first voice check-in to start seeing analytics and trends here.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const latest = filtered[filtered.length - 1];
  const insights = generateInsights(filtered);

  // Build chart data series
  const energyData    = filtered.map(c => ({ date: c.date, value: c.humeScores.energy }));
  const valenceData   = filtered.map(c => ({ date: c.date, value: c.humeScores.valence }));
  const arousalData   = filtered.map(c => ({ date: c.date, value: c.humeScores.arousal }));
  const manicData     = filtered.filter(c => c.bipolarIndices).map(c => ({ date: c.date, value: c.bipolarIndices!.manicIndex }));
  const depressData   = filtered.filter(c => c.bipolarIndices).map(c => ({ date: c.date, value: c.bipolarIndices!.depressiveIndex }));
  const wpmData       = filtered.filter(c => c.speechRate).map(c => ({ date: c.date, value: c.speechRate!.wordsPerMinute }));
  const coherenceData = filtered.filter(c => c.speechOrganization).map(c => ({ date: c.date, value: c.speechOrganization!.topicCoherence }));
  const emotRangeData = filtered.filter(c => c.prosody).map(c => ({ date: c.date, value: c.prosody!.emotionalRange }));

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={s.header}>
            <Text style={s.title}>Analytics</Text>
            <Text style={s.subtitle}>
              {checkins.length} check-in{checkins.length !== 1 ? 's' : ''} recorded
            </Text>
          </View>

          {/* Time Range Selector */}
          <View style={s.rangeRow}>
            {(['7d', '14d', '30d', 'all'] as TimeRange[]).map(r => (
              <TouchableOpacity
                key={r}
                style={[s.rangeBtn, range === r && s.rangeBtnActive]}
                onPress={() => setRange(r)}
                activeOpacity={0.7}
              >
                <Text style={[s.rangeBtnText, range === r && s.rangeBtnTextActive]}>
                  {r === 'all' ? 'All' : r.replace('d', 'D')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Episode Trajectory — multi-day trend analysis */}
          <EpisodeTrajectoryCard checkins={filtered} />

          {/* Summary Card */}
          {latest && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Latest Check-in</Text>
              <View style={s.summaryRow}>
                <View style={s.summaryItem}>
                  <Text style={s.summaryLabel}>State</Text>
                  <View style={[s.stateBadge, {
                    backgroundColor: stateColor(latest.todayState) + '22',
                    borderColor: stateColor(latest.todayState),
                  }]}>
                    <Text style={[s.stateText, { color: stateColor(latest.todayState) }]}>
                      {latest.todayState.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <View style={s.summaryItem}>
                  <Text style={s.summaryLabel}>Risk</Text>
                  <View style={[s.stateBadge, {
                    backgroundColor: riskColor(latest.riskLevel) + '22',
                    borderColor: riskColor(latest.riskLevel),
                  }]}>
                    <Text style={[s.stateText, { color: riskColor(latest.riskLevel) }]}>
                      {latest.riskLevel.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <View style={s.summaryItem}>
                  <Text style={s.summaryLabel}>Date</Text>
                  <Text style={s.summaryValue}>{formatDate(latest.date)}</Text>
                </View>
              </View>
              <Text style={s.insightText}>{latest.insight}</Text>
            </View>
          )}

          {/* State Distribution */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Mood State Distribution</Text>
            <StateDistribution checkins={filtered} />
          </View>

          {/* AI Insights */}
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Insights</Text>
          </View>
          {insights.map((ins, i) => (
            <InsightCard key={i} {...ins} />
          ))}

          {/* Bipolar Indices Trends */}
          {manicData.length > 0 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Bipolar Index Trends</Text>
              <SparklineChart data={manicData} color={Ocean.warning} label="Manic Index" />
              <SparklineChart data={depressData} color="#7B8FD4" label="Depressive Index" />
            </View>
          )}

          {/* Voice Prosody Trends */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Voice Prosody Trends</Text>
            <SparklineChart data={energyData} color={Ocean.accent} label="Energy" />
            <SparklineChart data={valenceData} color={Ocean.success} label="Valence" min={-1} max={1} />
            <SparklineChart data={arousalData} color={Ocean.warning} label="Arousal" />
          </View>

          {/* Emotional Range */}
          {emotRangeData.length > 0 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Emotional Expressiveness</Text>
              <SparklineChart
                data={emotRangeData}
                color={Ocean.accent}
                label="Emotional Range"
              />
              <Text style={s.chartNote}>
                Low range may indicate flat affect (depression). High range may indicate emotional lability (mania).
              </Text>
            </View>
          )}

          {/* Speech Rate */}
          {wpmData.length > 0 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Speech Rate</Text>
              <SparklineChart
                data={wpmData}
                color={Ocean.accent}
                label="Words Per Minute"
                min={0}
                max={Math.max(200, ...wpmData.map(d => d.value))}
                unit=" wpm"
              />
              <View style={s.refRangeRow}>
                <View style={[s.refRange, { backgroundColor: '#7B8FD4' + '22' }]}>
                  <Text style={[s.refRangeText, { color: '#7B8FD4' }]}>{'<80 depressive'}</Text>
                </View>
                <View style={[s.refRange, { backgroundColor: Ocean.accent + '22' }]}>
                  <Text style={[s.refRangeText, { color: Ocean.accent }]}>120-150 normal</Text>
                </View>
                <View style={[s.refRange, { backgroundColor: Ocean.warning + '22' }]}>
                  <Text style={[s.refRangeText, { color: Ocean.warning }]}>{'>180 pressured'}</Text>
                </View>
              </View>
            </View>
          )}

          {/* Speech Organization */}
          {coherenceData.length > 0 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Speech Organization</Text>
              <SparklineChart
                data={coherenceData}
                color={Ocean.accent}
                label="Topic Coherence"
                min={0}
                max={10}
              />
              <Text style={s.chartNote}>
                Declining coherence may indicate flight of ideas (mania) or disorganized thinking.
              </Text>
            </View>
          )}

          {/* Risk Timeline */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Risk Timeline</Text>
            <RiskTimeline checkins={filtered} />
          </View>

          {/* Top Emotions */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Most Frequent Emotions</Text>
            <EmotionFrequency checkins={filtered} />
          </View>

          {/* Content Themes */}
          {filtered.some(c => c.contentThemes) && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Content Theme Averages</Text>
              <ContentThemesSummary checkins={filtered} />
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

// ─── Content Themes Summary ──────────────────────────────────────────────────

function ContentThemesSummary({ checkins }: { checkins: CheckinDoc[] }) {
  const withThemes = checkins.filter(c => c.contentThemes);
  if (withThemes.length === 0) return null;

  const avg = (fn: (c: CheckinDoc) => number) =>
    withThemes.reduce((s, c) => s + fn(c), 0) / withThemes.length;

  const themes = [
    { label: 'Grandiosity',  value: avg(c => c.contentThemes!.grandiosity),   color: Ocean.warning },
    { label: 'Hopelessness', value: avg(c => c.contentThemes!.hopelessness),  color: '#7B8FD4' },
    { label: 'Self-Criticism',value: avg(c => c.contentThemes!.selfCriticism), color: '#7B8FD4' },
    { label: 'Anhedonia',    value: avg(c => c.contentThemes!.anhedonia),     color: '#7B8FD4' },
  ];

  return (
    <View>
      {themes.map(t => (
        <View key={t.label} style={ct.row}>
          <Text style={ct.label}>{t.label}</Text>
          <View style={ct.barTrack}>
            <View style={[ct.barFill, { width: `${(t.value / 10) * 100}%`, backgroundColor: t.color }]} />
          </View>
          <Text style={ct.value}>{t.value.toFixed(1)}/10</Text>
        </View>
      ))}
    </View>
  );
}

const ct = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  label:    { width: 90, fontSize: 12, color: Ocean.textSecondary, fontWeight: '600' },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Ocean.surface, overflow: 'hidden' },
  barFill:  { height: 6, borderRadius: 3 },
  value:    { width: 44, fontSize: 11, color: Ocean.textMuted, textAlign: 'right', fontWeight: '700' },
});

// ─── Color Helpers ───────────────────────────────────────────────────────────

function stateColor(state: string) {
  return state === 'elevated' ? Ocean.warning :
         state === 'low'      ? '#7B8FD4' :
         state === 'mixed'    ? Ocean.danger : Ocean.accent;
}

function riskColor(risk: string) {
  return risk === 'high' ? Ocean.danger : risk === 'medium' ? Ocean.warning : Ocean.success;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Ocean.bg },
  scroll:      { flex: 1 },
  content:     { paddingHorizontal: 20, paddingBottom: 40 },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Ocean.textSecondary },
  emptyIcon:   { fontSize: 48, marginBottom: 4 },
  emptyTitle:  { fontSize: 20, fontWeight: '700', color: Ocean.textPrimary },
  emptyBody:   { fontSize: 14, color: Ocean.textSecondary, textAlign: 'center', paddingHorizontal: 40, lineHeight: 20 },

  header:      { paddingTop: 20, paddingBottom: 4 },
  title:       { fontSize: 28, fontWeight: '800', color: Ocean.textPrimary },
  subtitle:    { fontSize: 13, color: Ocean.textSecondary, marginTop: 4 },

  rangeRow:        { flexDirection: 'row', gap: 8, marginTop: 16, marginBottom: 18 },
  rangeBtn:        { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: Ocean.surface, borderWidth: 1, borderColor: Ocean.cardBorder },
  rangeBtnActive:  { backgroundColor: Ocean.accent + '22', borderColor: Ocean.accent },
  rangeBtnText:    { fontSize: 12, fontWeight: '700', color: Ocean.textMuted },
  rangeBtnTextActive: { color: Ocean.accent },

  card:        { backgroundColor: Ocean.card, borderRadius: 16, borderWidth: 1, borderColor: Ocean.cardBorder, padding: 16, marginBottom: 14 },
  cardTitle:   { fontSize: 11, fontWeight: '700', color: Ocean.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },

  summaryRow:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  summaryItem: { alignItems: 'center', gap: 6 },
  summaryLabel:{ fontSize: 11, color: Ocean.textMuted, fontWeight: '600' },
  summaryValue:{ fontSize: 14, color: Ocean.textPrimary, fontWeight: '700' },
  stateBadge:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  stateText:   { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  insightText: { fontSize: 13, color: Ocean.textSecondary, fontStyle: 'italic', textAlign: 'center' },

  sectionHeader: { marginTop: 6, marginBottom: 10 },
  sectionTitle:  { fontSize: 11, fontWeight: '700', color: Ocean.textMuted, letterSpacing: 1, textTransform: 'uppercase' },

  chartNote:   { fontSize: 11, color: Ocean.textMuted, fontStyle: 'italic', marginTop: 6, lineHeight: 16 },

  refRangeRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  refRange:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  refRangeText:{ fontSize: 10, fontWeight: '600' },
});
