import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/lib/auth';
import { useAnchor } from '@/lib/anchor';
import { classify, describeMeasure, riskBand } from '@/lib/checkins';
import { markDoseTaken, type DayDose } from '@/lib/medications';
import { Card } from '@/components/Card';
import { MetricRow } from '@/components/MetricRow';
import { PulseDot } from '@/components/PulseDot';
import { Waveform } from '@/components/Waveform';
import { Ocean, radius, stateColor, stateLabel } from '@/constants/theme';

const RISK_COLOR = { low: Ocean.success, medium: Ocean.warning, high: Ocean.danger } as const;

/** Doses are shown one row per medication, with its times as chips. */
function groupDoses(doses: DayDose[]) {
  const byMed = new Map<string, DayDose[]>();
  for (const d of [...doses].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))) {
    byMed.set(d.medName, [...(byMed.get(d.medName) ?? []), d]);
  }
  return [...byMed.entries()];
}

export default function Home() {
  const { user } = useAuth();
  const router = useRouter();
  const { loading, today, dayLog, adherence, activeAlert, dismissAlert, refresh } = useAnchor();
  const [refreshing, setRefreshing] = useState(false);
  const [busyDose, setBusyDose] = useState<string | null>(null);

  // Coming back from the check-in flow should show the new result immediately.
  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => {});
    }, [refresh]),
  );

  const doses = useMemo(() => dayLog?.doses ?? [], [dayLog]);
  const grouped = useMemo(() => groupDoses(doses), [doses]);
  const taken = doses.filter((d) => d.status === 'taken').length;

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh().catch(() => {});
    setRefreshing(false);
  };

  const takeDose = async (dose: DayDose) => {
    if (!user || busyDose) return;
    setBusyDose(dose.id);
    try {
      await markDoseTaken(user.uid, dose);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await refresh();
    } catch {
      // Surfaced on the Meds tab; leave the row untouched here.
    } finally {
      setBusyDose(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator size="large" color={Ocean.accent} />
      </SafeAreaView>
    );
  }

  const analysis = today?.analysis ?? null;
  const state = analysis?.state ?? (today ? classify(today) : null);
  const color = state ? stateColor(state) : Ocean.textMuted;
  const voice = today?.voice ?? null;
  const band = analysis ? riskBand(analysis.risk) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Ocean.accent} />
        }
      >
        <View style={styles.header}>
          <MaterialCommunityIcons name="anchor" size={26} color={Ocean.accent} />
          <Text style={styles.headerTitle}>Anchor</Text>
        </View>

        {activeAlert && (
          <Card style={styles.alertCard}>
            <View style={styles.alertHead}>
              <Ionicons name="warning" size={18} color={Ocean.warning} />
              <Text style={styles.alertTitle}>{activeAlert.title}</Text>
              <TouchableOpacity onPress={() => dismissAlert(activeAlert.id)} hitSlop={10}>
                <Ionicons name="close" size={18} color={Ocean.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.alertBody}>{activeAlert.body}</Text>
            {activeAlert.recommendations.map((r) => (
              <View key={r} style={styles.bulletRow}>
                <View style={[styles.bullet, { backgroundColor: Ocean.warning }]} />
                <Text style={styles.bulletText}>{r}</Text>
              </View>
            ))}
          </Card>
        )}

        {/* Today's state */}
        <Card style={styles.stateCard}>
          <View style={styles.stateTop}>
            <View style={styles.flex}>
              <Text style={styles.sectionLabel}>Today&apos;s state</Text>
              <Text style={[styles.stateValue, { color }]}>
                {state ? stateLabel[state] : 'No check-in yet'}
              </Text>
            </View>
            <PulseDot size={15} color={color} />
          </View>
          <View style={styles.waveWrap}>
            <Waveform bars={20} active={!!today} color={today ? color : Ocean.textMuted} />
          </View>
        </Card>

        {/* Check-in call to action */}
        <TouchableOpacity
          style={styles.checkinCard}
          onPress={() => router.push('/checkin')}
          activeOpacity={0.85}
        >
          <View style={styles.micCircle}>
            <Ionicons name="mic" size={22} color={Ocean.accent} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.checkinTitle}>
              {today ? 'Start another check-in' : 'Start your voice check-in'}
            </Text>
            <Text style={styles.checkinSub}>
              {today
                ? 'A second read later in the day sharpens the trend.'
                : 'A few spoken questions. About two minutes.'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Ocean.accent} />
        </TouchableOpacity>

        {/* Today's doses */}
        <View style={styles.rowHead}>
          <Text style={styles.sectionLabel}>Today&apos;s doses</Text>
          {doses.length > 0 && (
            <Text style={styles.headCount}>
              {taken}/{doses.length} taken
            </Text>
          )}
        </View>
        <Card style={styles.flushCard}>
          {grouped.length === 0 ? (
            <Text style={styles.emptyText}>No doses scheduled today</Text>
          ) : (
            grouped.map(([medName, slots], i) => {
              const allTaken = slots.every((s) => s.status === 'taken');
              const nextPending = slots.find((s) => s.status === 'pending');
              const anyMissed = slots.some((s) => s.status === 'missed');
              return (
                <View
                  key={medName}
                  style={[
                    styles.doseRow,
                    i < grouped.length - 1 && styles.doseRowBorder,
                    allTaken && styles.doseRowDone,
                  ]}
                >
                  <View
                    style={[
                      styles.doseDot,
                      {
                        backgroundColor: allTaken
                          ? Ocean.success
                          : anyMissed
                            ? Ocean.danger
                            : Ocean.warning,
                      },
                    ]}
                  />
                  <View style={styles.flex}>
                    <Text style={[styles.doseName, allTaken && styles.doseNameDone]}>
                      {medName}
                      {slots[0].dosage ? ` · ${slots[0].dosage}` : ''}
                    </Text>
                    <View style={styles.chipRow}>
                      {slots.map((s) => (
                        <View key={s.id} style={styles.timeChip}>
                          <Text
                            style={[
                              styles.timeChipText,
                              s.status === 'taken' && { color: Ocean.success },
                              s.status === 'missed' && { color: Ocean.danger },
                            ]}
                          >
                            {s.time || 'As needed'}
                            {s.status === 'taken' ? ' · done' : s.status === 'missed' ? ' · missed' : ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  {nextPending && (
                    <TouchableOpacity
                      style={styles.takeBtn}
                      onPress={() => takeDose(nextPending)}
                      disabled={busyDose === nextPending.id}
                    >
                      {busyDose === nextPending.id ? (
                        <ActivityIndicator size="small" color={Ocean.accent} />
                      ) : (
                        <Text style={styles.takeText}>Take</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
          )}
          <TouchableOpacity style={styles.cardFooter} onPress={() => router.push('/(tabs)/meds')}>
            <Text style={styles.cardFooterText}>Manage medications →</Text>
          </TouchableOpacity>
        </Card>

        {/* What today reads as */}
        {analysis && (
          <Card style={styles.insightCard}>
            <View style={[styles.iconCircle, { borderColor: color }]}>
              <Ionicons name="trending-up" size={18} color={color} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.insightTitle}>Pattern insight</Text>
              <Text style={styles.insightBody}>{analysis.summary}</Text>
            </View>
          </Card>
        )}

        {analysis?.discrepancy && (
          <View style={styles.discrepancy}>
            <Ionicons name="pulse" size={16} color={Ocean.mixed} />
            <Text style={styles.discrepancyText}>{analysis.discrepancy}</Text>
          </View>
        )}

        {/* Latest check-in measures */}
        <View style={styles.rowHead}>
          <Text style={styles.sectionLabel}>Latest check-in</Text>
          {band && (
            <View style={[styles.riskPill, { backgroundColor: `${RISK_COLOR[band]}22` }]}>
              <Text style={[styles.riskText, { color: RISK_COLOR[band] }]}>{band} risk</Text>
            </View>
          )}
        </View>
        <Card style={styles.metricsCard}>
          {voice ? (
            <>
              <MetricRow
                label="Speech rate"
                descriptor={describeMeasure('speechRate', voice.speechRate)}
                value={voice.speechRate}
                color={color}
              />
              <MetricRow
                label="Vocal energy"
                descriptor={describeMeasure('energy', voice.energy)}
                value={voice.energy}
                color={color}
              />
              <MetricRow
                label="Pitch range"
                descriptor={describeMeasure('pitchVariance', voice.pitchVariance)}
                value={voice.pitchVariance}
                color={color}
              />
              <MetricRow
                label="Valence"
                descriptor={describeMeasure('valence', voice.valence)}
                value={voice.valence}
                color={Ocean.mixed}
                last
              />
            </>
          ) : (
            <Text style={styles.emptyText}>
              {today
                ? 'This check-in was saved without voice signals.'
                : 'Complete a voice check-in to see your measures.'}
            </Text>
          )}
        </Card>

        {/* Signs flagged today */}
        <Card style={styles.signsCard}>
          <Text style={styles.sectionLabel}>Signs flagged today</Text>
          {today && today.symptoms.length > 0 ? (
            <View style={styles.chipRow}>
              {today.symptoms.map((s) => (
                <View key={s} style={styles.signChip}>
                  <Text style={styles.signChipText}>{s}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>
              {today ? 'None of your own signs flagged today.' : 'Nothing logged yet today.'}
            </Text>
          )}
        </Card>

        {/* Where the detail lives */}
        <TouchableOpacity
          style={styles.reportCard}
          onPress={() => router.push('/(tabs)/insights')}
          activeOpacity={0.85}
        >
          <View style={styles.iconCircle}>
            <Ionicons name="bar-chart" size={18} color={Ocean.accent} />
          </View>
          <Text style={styles.reportText}>Insights &amp; psychiatrist report</Text>
          <Ionicons name="chevron-forward" size={20} color={Ocean.textSecondary} />
        </TouchableOpacity>

        {adherence && adherence.taken + adherence.missed > 0 && (
          <Text style={styles.footnote}>
            {Math.round(adherence.rate * 100)}% medication adherence over the last 30 days.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: Ocean.bg },
  center: { flex: 1, backgroundColor: Ocean.bg, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 40 },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  headerTitle: { color: Ocean.textPrimary, fontSize: 25, fontWeight: '700', marginLeft: 9 },

  sectionLabel: {
    color: Ocean.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 9,
  },
  headCount: { color: Ocean.accent, fontSize: 13, fontWeight: '700' },
  emptyText: { color: Ocean.textMuted, fontSize: 14, lineHeight: 20, paddingVertical: 8 },

  alertCard: {
    marginBottom: 16,
    borderColor: Ocean.warning,
    backgroundColor: 'rgba(245,158,11,0.10)',
  },
  alertHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  alertTitle: { flex: 1, color: Ocean.warning, fontSize: 15, fontWeight: '700', marginLeft: 8 },
  alertBody: { color: Ocean.textPrimary, fontSize: 14, lineHeight: 21 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 },
  bullet: { width: 5, height: 5, borderRadius: 2.5, marginTop: 7, marginRight: 10 },
  bulletText: { flex: 1, color: Ocean.textSecondary, fontSize: 14, lineHeight: 20 },

  stateCard: { padding: 20, marginBottom: 16 },
  stateTop: { flexDirection: 'row', alignItems: 'flex-start' },
  stateValue: { fontSize: 28, fontWeight: '700', marginTop: 4 },
  waveWrap: { marginTop: 14 },

  checkinCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Ocean.card,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: Ocean.accent,
    padding: 18,
    marginBottom: 22,
  },
  micCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Ocean.accentDim,
    borderWidth: 1,
    borderColor: Ocean.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  checkinTitle: { color: Ocean.textPrimary, fontSize: 16.5, fontWeight: '700' },
  checkinSub: { color: Ocean.textSecondary, fontSize: 13, marginTop: 3, lineHeight: 18 },

  flushCard: { padding: 0, overflow: 'hidden', marginBottom: 22 },
  doseRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 },
  doseRowBorder: { borderBottomWidth: 1, borderBottomColor: Ocean.cardBorder },
  doseRowDone: { opacity: 0.55 },
  doseDot: { width: 9, height: 9, borderRadius: 4.5, marginRight: 12 },
  doseName: { color: Ocean.textPrimary, fontSize: 14.5, fontWeight: '600' },
  doseNameDone: { textDecorationLine: 'line-through' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 5 },
  timeChip: {
    backgroundColor: Ocean.surface,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 6,
    marginBottom: 4,
  },
  timeChipText: { color: Ocean.textSecondary, fontSize: 11, fontWeight: '600' },
  takeBtn: {
    borderWidth: 1,
    borderColor: Ocean.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 15,
    paddingVertical: 7,
    minWidth: 66,
    alignItems: 'center',
  },
  takeText: { color: Ocean.accent, fontSize: 13.5, fontWeight: '700' },
  cardFooter: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Ocean.cardBorder,
  },
  cardFooterText: { color: Ocean.accent, fontSize: 13, fontWeight: '700' },

  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Ocean.accentDim,
    borderWidth: 1,
    borderColor: Ocean.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  insightCard: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  insightTitle: { color: Ocean.textPrimary, fontSize: 15, fontWeight: '700' },
  insightBody: { color: Ocean.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 3 },

  discrepancy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(192,132,252,0.12)',
    borderRadius: radius.md,
    padding: 13,
    marginBottom: 20,
  },
  discrepancyText: { flex: 1, color: Ocean.mixed, fontSize: 13.5, lineHeight: 19, marginLeft: 9 },

  metricsCard: { paddingVertical: 2, marginBottom: 20 },
  signsCard: { marginBottom: 20 },
  signChip: {
    backgroundColor: Ocean.surface,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 7,
    marginTop: 8,
  },
  signChipText: { color: Ocean.textPrimary, fontSize: 12.5, fontWeight: '600' },

  riskPill: { borderRadius: radius.sm, paddingHorizontal: 9, paddingVertical: 3 },
  riskText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },

  reportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Ocean.card,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    borderRadius: radius.lg,
    padding: 18,
  },
  reportText: { flex: 1, color: Ocean.textPrimary, fontSize: 15.5, fontWeight: '700' },

  footnote: { color: Ocean.textMuted, fontSize: 12.5, textAlign: 'center', marginTop: 20 },
});
