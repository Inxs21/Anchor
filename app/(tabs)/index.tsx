import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useRef, useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/lib/auth';
import { Ocean } from '@/constants/theme';
import {
  getDailyLog,
  markDoseTaken,
  todayStr,
  formatTime,
  type DailyLog,
  type DoseLog,
} from '@/lib/medications';
import { getTodayCheckin, type CheckinDoc } from '@/lib/checkins';

// ─── Icon components (no emojis) ─────────────────────────────────────────────

function AnchorIcon({ size = 28, color = Ocean.accent }: { size?: number; color?: string }) {
  const sw = Math.max(2, Math.round(size * 0.09));
  const ringD = size * 0.34; const ringR = ringD / 2; const cx = size / 2;
  const armY = ringD + size * 0.14; const armW = size * 0.76; const botD = size * 0.28;
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ width: ringD, height: ringD, borderRadius: ringR, borderWidth: sw, borderColor: color, position: 'absolute', top: 0, left: cx - ringR }} />
      <View style={{ width: sw, height: size * 0.48, backgroundColor: color, position: 'absolute', top: ringD, left: cx - sw / 2 }} />
      <View style={{ width: armW, height: sw, backgroundColor: color, position: 'absolute', top: armY, left: (size - armW) / 2 }} />
      <View style={{ width: botD, height: botD, borderRadius: botD / 2, borderWidth: sw, borderColor: color, borderTopColor: 'transparent', borderRightColor: 'transparent', position: 'absolute', bottom: size * 0.01, left: size * 0.06, transform: [{ rotate: '20deg' }] }} />
      <View style={{ width: botD, height: botD, borderRadius: botD / 2, borderWidth: sw, borderColor: color, borderTopColor: 'transparent', borderLeftColor: 'transparent', position: 'absolute', bottom: size * 0.01, right: size * 0.06, transform: [{ rotate: '-20deg' }] }} />
    </View>
  );
}

// ─── Analytics row ────────────────────────────────────────────────────────────

function AnalyticsRow({
  label, descriptor, value, color, last = false,
}: {
  label: string; descriptor: string; value: number; color: string; last?: boolean;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <View style={[arStyles.row, !last && arStyles.rowBorder]}>
      <View style={arStyles.left}>
        <Text style={arStyles.label}>{label}</Text>
        <Text style={[arStyles.descriptor, { color }]}>{descriptor}</Text>
      </View>
      <View style={arStyles.barWrap}>
        <View style={{ height: 6, backgroundColor: Ocean.surface, borderRadius: 3, overflow: 'hidden' }}>
          <View style={{ height: 6, width: `${pct}%` as any, backgroundColor: color, borderRadius: 3 }} />
        </View>
        <Text style={[arStyles.pct, { color }]}>{pct}%</Text>
      </View>
    </View>
  );
}
const arStyles = StyleSheet.create({
  row:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 12 },
  rowBorder:  { borderBottomWidth: 1, borderBottomColor: Ocean.cardBorder },
  left:       { width: 90 },
  label:      { fontSize: 11, fontWeight: '600', color: Ocean.textMuted, textTransform: 'uppercase', letterSpacing: 0.7 },
  descriptor: { fontSize: 15, fontWeight: '700', marginTop: 2 },
  barWrap:    { flex: 1, gap: 5 },
  pct:        { fontSize: 11, fontWeight: '600', textAlign: 'right' },
});

function BarChartIcon({ size = 20, color = Ocean.accent }: { size?: number; color?: string }) {
  const barW = size * 0.2; const gap = size * 0.1;
  const heights = [size * 0.5, size * 0.8, size * 0.6, size * 0.95];
  return (
    <View style={{ width: size, height: size, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: gap }}>
      {heights.map((h, i) => (
        <View key={i} style={{ width: barW, height: h, backgroundColor: color, borderRadius: 2 }} />
      ))}
    </View>
  );
}

// ─── Waveform bar config ──────────────────────────────────────────────────────

const BAR_COUNT = 20;

const BAR_CONFIGS = Array.from({ length: BAR_COUNT }, (_, i) => ({
  minH: 4 + (i % 3) * 2,
  maxH: 10 + ((i * 7 + 3) % 9),
  dur1: 600 + (i * 83) % 700,
  dur2: 500 + (i * 61) % 600,
}));

// ─── Animated Waveform ───────────────────────────────────────────────────────

function Waveform() {
  const anims = useRef(BAR_CONFIGS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const loops = anims.map((anim, i) => {
      const cfg = BAR_CONFIGS[i];
      return Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: cfg.dur1, useNativeDriver: false }),
          Animated.timing(anim, { toValue: 0, duration: cfg.dur2, useNativeDriver: false }),
        ])
      );
    });
    loops.forEach((l, i) => setTimeout(() => l.start(), i * 40));
    return () => loops.forEach((l) => l.stop());
  }, []);

  return (
    <View style={waveStyles.container}>
      {anims.map((anim, i) => {
        const cfg = BAR_CONFIGS[i];
        const height = anim.interpolate({
          inputRange: [0, 1],
          outputRange: [cfg.minH, cfg.maxH],
        });
        return <Animated.View key={i} style={[waveStyles.bar, { height }]} />;
      })}
    </View>
  );
}

const waveStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 22,
    marginTop: 14,
  },
  bar: {
    width: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(78,205,196,0.6)',
  },
});

// ─── Pulsing status circle ────────────────────────────────────────────────────

function PulseCircle({ size, color }: { size: number; color: string }) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.15, duration: 900, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        transform: [{ scale }],
      }}
    />
  );
}

// ─── Icon circle (replaces emojis) ───────────────────────────────────────────

function IconCircle({ size = 44, children }: { size?: number; children: React.ReactNode }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: Ocean.accentDim,
      borderWidth: 1, borderColor: Ocean.accent,
      alignItems: 'center', justifyContent: 'center',
    }}>
      {children}
    </View>
  );
}

// Mic icon drawn with RN views
function MicShape({ size = 20, color = Ocean.accent }: { size?: number; color?: string }) {
  const w = size * 0.44; const h = size * 0.58; const r = w / 2;
  return (
    <View style={{ width: size, height: size, alignItems: 'center' }}>
      <View style={{ width: w, height: h, borderRadius: r, borderWidth: 2, borderColor: color, position: 'absolute', top: 0 }} />
      <View style={{ width: size * 0.8, height: size * 0.38, borderBottomLeftRadius: size * 0.4, borderBottomRightRadius: size * 0.4, borderWidth: 2, borderColor: color, borderTopColor: 'transparent', position: 'absolute', top: size * 0.3 }} />
      <View style={{ width: 2, height: size * 0.2, backgroundColor: color, position: 'absolute', bottom: 0, left: size / 2 - 1 }} />
      <View style={{ width: size * 0.4, height: 2, backgroundColor: color, position: 'absolute', bottom: 0, left: size * 0.3 }} />
    </View>
  );
}

// ─── Pulsing mic circle ───────────────────────────────────────────────────────

function PulsingMicCircle() {
  const scale   = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale,   { toValue: 1.2, duration: 700, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.6, duration: 700, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale,   { toValue: 1,   duration: 700, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1,   duration: 700, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, []);

  return (
    <Animated.View style={[micStyles.circle, { transform: [{ scale }], opacity }]}>
      <MicShape size={22} color={Ocean.accent} />
    </Animated.View>
  );
}

const micStyles = StyleSheet.create({
  circle: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Ocean.accentDim,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Ocean.accent,
  },
});

// ─── Home Dose Row ────────────────────────────────────────────────────────────

function HomeDoseRow({
  medName, slots, isLast, onMarkTaken,
}: {
  medName: string;
  slots: { key: string; dose: DoseLog }[];
  isLast: boolean;
  onMarkTaken: (key: string) => void;
}) {
  const allTaken    = slots.every((s) => s.dose.status === 'taken');
  const anyMissed   = slots.some((s) => s.dose.status === 'missed');
  const nextPending = slots.find((s) => s.dose.status === 'pending');
  const scaleAnim   = useRef(new Animated.Value(1)).current;

  function handlePress() {
    if (!nextPending) return;
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.97, duration: 70, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, bounciness: 10, useNativeDriver: true }),
    ]).start();
    onMarkTaken(nextPending.key);
  }

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <View style={[
        styles.homeDoseRow,
        !isLast && styles.homeDoseRowBorder,
        allTaken && { opacity: 0.5 },
      ]}>
        <View style={[
          styles.homeDoseDot,
          allTaken  && { backgroundColor: Ocean.success },
          anyMissed && !allTaken && { backgroundColor: Ocean.danger },
          !allTaken && !anyMissed && { backgroundColor: Ocean.warning },
        ]} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.homeDoseName, allTaken && { textDecorationLine: 'line-through' }]}>
            {medName}
          </Text>
          <View style={styles.homeTimeSlots}>
            {slots.map(({ key, dose }) => (
              <View key={key} style={styles.homeTimeChip}>
                <Text style={[
                  styles.homeDoseTime,
                  dose.status === 'taken'  && { color: Ocean.success },
                  dose.status === 'missed' && { color: Ocean.danger },
                ]}>
                  {formatTime(dose.scheduledTime)}{dose.status === 'taken' ? '  done' : dose.status === 'missed' ? '  missed' : ''}
                </Text>
              </View>
            ))}
          </View>
        </View>
        {nextPending && (
          <TouchableOpacity style={styles.homeDoseBtn} onPress={handlePress}>
            <Text style={styles.homeDoseBtnText}>Take</Text>
          </TouchableOpacity>
        )}
        {allTaken && (
          <View style={styles.homeDoneDot} />
        )}
      </View>
    </Animated.View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { user } = useAuth();
  const router   = useRouter();
  const uid      = user?.uid ?? '';
  const today    = todayStr();

  const [dailyLog,    setDailyLog]    = useState<DailyLog | null>(null);
  const [checkin,     setCheckin]     = useState<CheckinDoc | null>(null);

  // 7 staggered card anims
  const cardAnims = useRef(Array.from({ length: 7 }, () => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.stagger(
      80,
      cardAnims.map((a) =>
        Animated.timing(a, { toValue: 1, duration: 400, useNativeDriver: true })
      )
    ).start();
  }, []);

  const loadData = useCallback(async () => {
    if (!uid) return;
    try {
      const [log, ci] = await Promise.all([
        getDailyLog(uid, today),
        getTodayCheckin(uid, today),
      ]);
      setDailyLog(log);
      setCheckin(ci);
    } catch {
      // degrades gracefully if offline
    }
  }, [uid, today]);

  // Reload every time the home tab is focused so it stays in sync with other tabs
  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  if (!user) return null;

  async function handleMarkTaken(key: string) {
    if (!dailyLog) return;
    setDailyLog((prev) =>
      prev
        ? { ...prev, doses: { ...prev.doses, [key]: { ...prev.doses[key], status: 'taken' } } }
        : prev
    );
    await markDoseTaken(uid, today, key);
  }

  const doses = dailyLog
    ? Object.entries(dailyLog.doses)
        .filter(([, d]) => d.scheduledTime !== 'manual')
        .sort(([, a], [, b]) => a.scheduledTime.localeCompare(b.scheduledTime))
    : [];
  const takenCount = doses.filter(([, d]) => d.status === 'taken').length;
  const totalCount = doses.length;

  const groupedDoses = doses.reduce<Record<string, { medName: string; slots: { key: string; dose: DoseLog }[] }>>(
    (acc, [key, dose]) => {
      if (!acc[dose.medId]) acc[dose.medId] = { medName: dose.medName, slots: [] };
      acc[dose.medId].slots.push({ key, dose });
      return acc;
    }, {}
  );
  const groupedList = Object.entries(groupedDoses);

  const stateColor =
    checkin?.todayState === 'elevated' ? '#F5A623' :
    checkin?.todayState === 'low'      ? '#7B8FD4' :
    Ocean.accent;

  const stateLabel =
    checkin?.todayState === 'elevated' ? 'Elevated' :
    checkin?.todayState === 'low'      ? 'Low'      :
    checkin                            ? 'Stable'   :
    'No check-in';

  const energyColor = !checkin ? Ocean.textMuted :
    checkin.humeScores.energy > 0.75 ? Ocean.danger  :
    checkin.humeScores.energy > 0.55 ? Ocean.warning :
    checkin.humeScores.energy > 0.35 ? Ocean.accent  : '#7B8FD4';

  const energyLabel = !checkin ? '—' :
    checkin.humeScores.energy > 0.75 ? 'Very High' :
    checkin.humeScores.energy > 0.55 ? 'High'      :
    checkin.humeScores.energy > 0.35 ? 'Moderate'  : 'Low';

  const valenceColor = !checkin ? Ocean.textMuted :
    checkin.humeScores.valence > 0.65 ? Ocean.success :
    checkin.humeScores.valence > 0.45 ? Ocean.accent  : Ocean.danger;

  const valenceLabel = !checkin ? '—' :
    checkin.humeScores.valence > 0.65 ? 'Positive' :
    checkin.humeScores.valence > 0.45 ? 'Neutral'  : 'Negative';

  const arousalColor = !checkin ? Ocean.textMuted :
    checkin.humeScores.arousal > 0.65 ? Ocean.danger  :
    checkin.humeScores.arousal > 0.45 ? Ocean.warning : Ocean.accent;

  const arousalLabel = !checkin ? '—' :
    checkin.humeScores.arousal > 0.65 ? 'Agitated' :
    checkin.humeScores.arousal > 0.45 ? 'Alert'    : 'Calm';

  const riskColor = checkin?.riskLevel === 'high' ? Ocean.danger :
    checkin?.riskLevel === 'medium' ? Ocean.warning : Ocean.success;

  const riskBg = checkin?.riskLevel === 'high' ? 'rgba(255,107,107,0.12)' :
    checkin?.riskLevel === 'medium' ? 'rgba(245,158,11,0.12)' : 'rgba(78,205,196,0.12)';

  function fadeCard(index: number) {
    return {
      opacity: cardAnims[index],
      transform: [{
        translateY: cardAnims[index].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
      }],
    };
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Ocean.bg} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── Header ── */}
        <Animated.View style={[styles.header, fadeCard(0)]}>
          <AnchorIcon size={28} color={Ocean.accent} />
          <Text style={styles.headerTitle}>Anchor</Text>
        </Animated.View>

        {/* ── Today's State card ── */}
        <Animated.View style={[styles.card, styles.stateCard, fadeCard(1)]}>
          <View style={styles.stateTopRow}>
            <View>
              <Text style={styles.stateLabel}>Today's State</Text>
              <Text style={[styles.stateValue, { color: stateColor }]}>{stateLabel}</Text>
            </View>
            <PulseCircle size={16} color={stateColor} />
          </View>
          <Waveform />
        </Animated.View>

        {/* ── Start 60-sec check-in ── */}
        <Animated.View style={fadeCard(2)}>
          <TouchableOpacity
            style={styles.checkinCard}
            onPress={() => router.push('/(tabs)/talk')}
            activeOpacity={0.85}
          >
            <PulsingMicCircle />
            <Text style={styles.checkinText}>
              {checkin ? 'Start another check-in' : 'Start 60-sec check-in'}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* ── Today's Doses widget ── */}
        <Animated.View style={fadeCard(3)}>
          <View style={styles.dosesHeader}>
            <Text style={styles.sectionLabel}>Today's Doses</Text>
            {totalCount > 0 && (
              <Text style={styles.dosesCount}>{takenCount}/{totalCount} taken</Text>
            )}
          </View>
          <View style={[styles.card, styles.dosesCard]}>
            {totalCount === 0 ? (
              <View style={styles.dosesEmpty}>
                <Text style={styles.dosesEmptyText}>No doses scheduled today</Text>
              </View>
            ) : (
              groupedList.map(([medId, group], i) => (
                <HomeDoseRow
                  key={medId}
                  medName={group.medName}
                  slots={group.slots}
                  isLast={i === groupedList.length - 1}
                  onMarkTaken={handleMarkTaken}
                />
              ))
            )}
            <TouchableOpacity
              style={styles.dosesFooter}
              onPress={() => router.push('/(tabs)/medications')}
            >
              <Text style={styles.dosesFooterText}>Manage medications →</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* ── Pattern Insight card ── */}
        <Animated.View style={[styles.card, styles.insightCard, fadeCard(4)]}>
          <IconCircle size={40}>
            <Text style={styles.insightIconText}>↗</Text>
          </IconCircle>
          <View style={styles.insightBody}>
            <Text style={styles.insightTitle}>Pattern Insight</Text>
            <Text style={styles.insightSub}>{checkin?.insight ?? 'Complete a voice check-in to see your pattern'}</Text>
          </View>
        </Animated.View>

        {/* ── Check-in Analytics ── */}
        <Animated.View style={fadeCard(5)}>
          <View style={styles.analyticsHeader}>
            <Text style={styles.sectionLabel}>Latest Check-in</Text>
            {checkin && (
              <View style={[styles.riskBadge, { backgroundColor: riskBg }]}>
                <Text style={[styles.riskBadgeText, { color: riskColor }]}>
                  {checkin.riskLevel} risk
                </Text>
              </View>
            )}
          </View>

          <View style={[styles.card, styles.analyticsMainCard]}>
            {checkin ? (
              <>
                <AnalyticsRow
                  label="Energy"
                  descriptor={energyLabel}
                  value={checkin.humeScores.energy}
                  color={energyColor}
                />
                <AnalyticsRow
                  label="Mood"
                  descriptor={valenceLabel}
                  value={checkin.humeScores.valence}
                  color={valenceColor}
                />
                <AnalyticsRow
                  label="Arousal"
                  descriptor={arousalLabel}
                  value={checkin.humeScores.arousal}
                  color={arousalColor}
                  last
                />
              </>
            ) : (
              <Text style={styles.analyticsEmpty}>Complete a check-in to see your analytics</Text>
            )}
          </View>

          {/* Top Emotions */}
          <View style={[styles.card, styles.emotionsCard]}>
            <Text style={styles.emotionsTitle}>Detected Emotions</Text>
            {checkin?.topEmotions?.length ? (
              <View style={styles.emotionChips}>
                {checkin.topEmotions.slice(0, 5).map((e, i) => (
                  <View key={i} style={styles.emotionChip}>
                    <Text style={styles.emotionChipName}>{e.name}</Text>
                    <Text style={styles.emotionChipScore}>{Math.round(e.score * 100)}%</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emotionsEmpty}>Complete a check-in to see detected emotions</Text>
            )}
          </View>
        </Animated.View>

        {/* ── View Insights & Reports ── */}
        <Animated.View style={fadeCard(6)}>
          <TouchableOpacity
            style={[styles.card, styles.reportsCard]}
            onPress={() => router.push('/(tabs)/report')}
            activeOpacity={0.85}
          >
            <IconCircle size={44}>
              <BarChartIcon size={20} color={Ocean.accent} />
            </IconCircle>
            <Text style={styles.reportsText}>View Insights & Reports</Text>
          </TouchableOpacity>
        </Animated.View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Ocean.bg },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24, marginBottom: 24 },
  headerAnchor: { fontSize: 24 },
  headerTitle:  { fontSize: 26, fontWeight: '700', color: Ocean.textPrimary },

  // Card base
  card: { backgroundColor: Ocean.card, borderRadius: 20, borderWidth: 1, borderColor: Ocean.cardBorder },

  // Today's State
  stateCard:    { padding: 20, marginBottom: 16 },
  stateTopRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  stateLabel:   { fontSize: 12, fontWeight: '600', color: Ocean.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 },
  stateValue:   { fontSize: 28, fontWeight: '700', color: Ocean.textPrimary },

  // Check-in CTA
  checkinCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: Ocean.card,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Ocean.accent,
    padding: 18,
    marginBottom: 24,
  },
  checkinText: { fontSize: 17, fontWeight: '700', color: Ocean.textPrimary, flex: 1 },

  // Section label
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Ocean.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // Doses widget
  dosesHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  dosesCount:     { fontSize: 13, fontWeight: '600', color: Ocean.accent },
  dosesCard:      { overflow: 'hidden', marginBottom: 20 },
  dosesEmpty:     { padding: 20, alignItems: 'center' },
  dosesEmptyText: { fontSize: 14, color: Ocean.textMuted },

  homeDoseRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  homeDoseRowBorder: { borderBottomWidth: 1, borderBottomColor: Ocean.cardBorder },
  homeDoseDot:       { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  homeDoseName:      { fontSize: 14, fontWeight: '600', color: Ocean.textPrimary },
  homeTimeSlots:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 5 },
  homeTimeChip:      { backgroundColor: Ocean.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: Ocean.cardBorder },
  homeDoseTime:      { fontSize: 11, fontWeight: '600', color: Ocean.textSecondary },
  homeDoseBtn:       { backgroundColor: Ocean.accentBtn, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14 },
  homeDoseBtnText:   { color: '#fff', fontWeight: '700', fontSize: 12 },
  homeDoneDot:       { width: 10, height: 10, borderRadius: 5, backgroundColor: Ocean.success },
  dosesFooter:       { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Ocean.cardBorder },
  dosesFooterText:   { fontSize: 13, color: Ocean.accent, fontWeight: '600' },

  // Pattern Insight
  insightCard: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14, marginBottom: 20 },
  insightIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Ocean.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Ocean.accent,
  },
  insightIconText: { fontSize: 18, color: Ocean.accent, fontWeight: '700' },
  insightBody:     { flex: 1 },
  insightTitle:    { fontSize: 15, fontWeight: '700', color: Ocean.textPrimary },
  insightSub:      { fontSize: 12, color: Ocean.textSecondary, marginTop: 3 },

  // 2-column grid
  grid: { flexDirection: 'row', gap: 12, marginBottom: 12 },

  // Analytics cards
  analyticsHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  analyticsCard:    { flex: 1, padding: 16 },
  analyticsMainCard:{ paddingHorizontal: 16, marginBottom: 12 },
  analyticsEmpty:   { fontSize: 14, color: Ocean.textMuted, paddingVertical: 20, textAlign: 'center' },
  riskBadge:        { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  riskBadgeText:    { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },

  // Emotions card
  emotionsCard:      { padding: 16, marginBottom: 16 },
  emotionsTitle:     { fontSize: 12, fontWeight: '600', color: Ocean.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 12 },
  emotionChips:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emotionChip:       { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Ocean.surface, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: Ocean.cardBorder },
  emotionChipName:   { fontSize: 12, fontWeight: '600', color: Ocean.textPrimary, textTransform: 'capitalize' },
  emotionChipScore:  { fontSize: 11, color: Ocean.accent, fontWeight: '700' },
  emotionsEmpty:     { fontSize: 13, color: Ocean.textMuted },

  // Reports card
  reportsCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, marginBottom: 32 },
  reportsText: { fontSize: 16, fontWeight: '700', color: Ocean.textPrimary },
});
