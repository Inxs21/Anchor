import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth';
import { useAnchor } from '@/lib/anchor';
import { classify } from '@/lib/checkins';
import { shortLabel } from '@/lib/dates';
import { detectStreak, STREAK_THRESHOLD } from '@/lib/prodrome';
import { Card } from '@/components/Card';
import { TrendStrip, type TrendPoint } from '@/components/TrendStrip';
import { Ocean, radius, stateColor, stateLabel, type MoodState } from '@/constants/theme';

// Validated for this surface: every adjacent pair clears ΔE 15 under
// deuteranopia/protanopia, and all three sit inside the dark lightness band.
const VOICE_COLORS = {
  speechRate: '#33A89F',
  energy: '#D08005',
  valence: '#A368E0',
} as const;

const WINDOW = 14;

export default function Insights() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { loading, history, alerts, adherence, refresh } = useAnchor();
  const [refreshing, setRefreshing] = useState(false);

  const recent = useMemo(() => history.slice(-WINDOW), [history]);
  const withVoice = useMemo(() => recent.filter((c) => c.voice), [recent]);
  const streak = useMemo(() => detectStreak(history), [history]);

  const stateCounts = useMemo(() => {
    const counts: Record<MoodState, number> = { stable: 0, elevated: 0, low: 0, mixed: 0 };
    for (const c of history) counts[c.analysis?.state ?? classify(c)] += 1;
    return counts;
  }, [history]);

  const moodPoints: TrendPoint[] = recent.map((c) => ({
    key: c.date,
    value: c.mood / 3,
    color: c.mood > 0 ? Ocean.elevated : c.mood < 0 ? Ocean.low : Ocean.textMuted,
  }));

  const sleepPoints: TrendPoint[] = recent.map((c) => ({
    key: c.date,
    value: Math.min(c.sleepHours / 12, 1),
  }));

  const voicePoints = (key: 'speechRate' | 'energy' | 'valence'): TrendPoint[] =>
    withVoice.map((c) => ({ key: c.date, value: c.voice![key] }));

  const latestVoice = withVoice[withVoice.length - 1]?.voice ?? null;
  const avgSleep =
    recent.length > 0 ? recent.reduce((a, c) => a + c.sleepHours, 0) / recent.length : 0;

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh().catch(() => {});
    setRefreshing(false);
  };

  const confirmSignOut = () => {
    Alert.alert('Sign out', 'You can sign back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut().catch(() => {}) },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator size="large" color={Ocean.accent} />
      </SafeAreaView>
    );
  }

  const range =
    recent.length > 0 ? `${shortLabel(recent[0].date)} – ${shortLabel(recent[recent.length - 1].date)}` : '';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Ocean.accent} />
        }
      >
        <Text style={styles.title}>Insights</Text>
        <Text style={styles.subtitle}>
          {history.length === 0
            ? 'Your patterns will show up here once you start checking in.'
            : `${history.length} check-in${history.length === 1 ? '' : 's'} recorded${range ? ` · last ${recent.length} days ${range}` : ''}`}
        </Text>

        {streak && (
          <Card style={styles.streakCard}>
            <View style={styles.streakHead}>
              <Ionicons name="trending-up" size={18} color={stateColor(streak.direction)} />
              <Text style={[styles.streakTitle, { color: stateColor(streak.direction) }]}>
                {streak.days.length} days trending {streak.direction}
              </Text>
            </View>
            <Text style={styles.streakBody}>
              {STREAK_THRESHOLD}+ consecutive days in one direction is the pattern Anchor watches
              for. Acting early is the whole point — this is not a diagnosis.
            </Text>
          </Card>
        )}

        <Card style={styles.card}>
          <TrendStrip
            title="Mood"
            latest={recent.length ? `${recent[recent.length - 1].mood > 0 ? '+' : ''}${recent[recent.length - 1].mood}` : undefined}
            points={moodPoints}
            mode="diverging"
            footnote="Above the line is elevated, below is low. One bar per check-in."
            emptyText="No mood check-ins yet."
          />
          <TrendStrip
            title="Sleep"
            latest={recent.length ? `${recent[recent.length - 1].sleepHours}h` : undefined}
            points={sleepPoints}
            band={[7 / 12, 9 / 12]}
            footnote={
              recent.length
                ? `Averaging ${Math.round(avgSleep * 10) / 10}h. Shaded band marks 7–9 hours.`
                : undefined
            }
            emptyText="No sleep data yet."
          />
        </Card>

        <Text style={styles.sectionLabel}>Voice biomarkers</Text>
        <Card style={styles.card}>
          <TrendStrip
            title="Speech rate"
            latest={latestVoice ? `${Math.round(latestVoice.speechRate * 100)}` : undefined}
            points={voicePoints('speechRate')}
            color={VOICE_COLORS.speechRate}
            emptyText="Record a spoken check-in to start this trend."
          />
          <TrendStrip
            title="Vocal energy"
            latest={latestVoice ? `${Math.round(latestVoice.energy * 100)}` : undefined}
            points={voicePoints('energy')}
            color={VOICE_COLORS.energy}
            emptyText="Record a spoken check-in to start this trend."
          />
          <TrendStrip
            title="Emotional valence"
            latest={latestVoice ? `${Math.round(latestVoice.valence * 100)}` : undefined}
            points={voicePoints('valence')}
            color={VOICE_COLORS.valence}
            footnote="Each measure is normalised 0–100 per sample, not against a clinical baseline."
            emptyText="Record a spoken check-in to start this trend."
          />
        </Card>

        <Text style={styles.sectionLabel}>Day states</Text>
        <Card style={styles.card}>
          {(['stable', 'elevated', 'low', 'mixed'] as const).map((s) => {
            const n = stateCounts[s];
            const share = history.length ? n / history.length : 0;
            return (
              <View key={s} style={styles.stateRow}>
                <View style={[styles.stateDot, { backgroundColor: stateColor(s) }]} />
                <Text style={styles.stateName}>{stateLabel[s]}</Text>
                <View style={styles.stateTrack}>
                  <View
                    style={[
                      styles.stateFill,
                      { width: `${share * 100}%`, backgroundColor: stateColor(s) },
                    ]}
                  />
                </View>
                <Text style={styles.stateCount}>{n}</Text>
              </View>
            );
          })}
        </Card>

        <Text style={styles.sectionLabel}>Early-warning history</Text>
        {alerts.length === 0 ? (
          <Card style={styles.card}>
            <Text style={styles.empty}>No alerts have fired. That is good news.</Text>
          </Card>
        ) : (
          alerts.map((a) => (
            <Card key={a.id} style={styles.alertCard}>
              <View style={styles.alertHead}>
                <Text style={[styles.alertTitle, { color: stateColor(a.direction) }]}>{a.title}</Text>
                <Text style={styles.alertDate}>{shortLabel(a.firedOn)}</Text>
              </View>
              <Text style={styles.alertBody}>{a.body}</Text>
            </Card>
          ))
        )}

        <TouchableOpacity
          style={styles.reportBtn}
          onPress={() => router.push('/report')}
          activeOpacity={0.85}
        >
          <Ionicons name="document-text" size={20} color={Ocean.bg} />
          <Text style={styles.reportText}>Build psychiatrist report</Text>
        </TouchableOpacity>

        {adherence && (
          <Text style={styles.footnote}>
            Report covers 30 days of mood, sleep, voice trends and {Math.round(adherence.rate * 100)}%
            medication adherence.
          </Text>
        )}

        <View style={styles.account}>
          <Text style={styles.accountEmail}>{user?.email}</Text>
          <TouchableOpacity onPress={confirmSignOut}>
            <Text style={styles.signOut}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Ocean.bg },
  center: { flex: 1, backgroundColor: Ocean.bg, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 40 },
  title: { color: Ocean.textPrimary, fontSize: 26, fontWeight: '700' },
  subtitle: { color: Ocean.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 4, marginBottom: 18 },

  card: { marginBottom: 6, paddingBottom: 6 },
  sectionLabel: {
    color: Ocean.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 22,
    marginBottom: 10,
  },
  empty: { color: Ocean.textSecondary, fontSize: 14.5 },

  streakCard: { marginBottom: 16, backgroundColor: Ocean.surface },
  streakHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 7 },
  streakTitle: { fontSize: 15, fontWeight: '700', marginLeft: 8 },
  streakBody: { color: Ocean.textSecondary, fontSize: 13.5, lineHeight: 20 },

  stateRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  stateDot: { width: 8, height: 8, borderRadius: 4, marginRight: 9 },
  stateName: { color: Ocean.textSecondary, fontSize: 13.5, width: 66 },
  stateTrack: {
    flex: 1,
    height: 7,
    borderRadius: 4,
    backgroundColor: Ocean.surface,
    overflow: 'hidden',
    marginRight: 10,
  },
  stateFill: { height: '100%', borderRadius: 4 },
  stateCount: {
    color: Ocean.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    width: 22,
    textAlign: 'right',
  },

  alertCard: { marginBottom: 8 },
  alertHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  alertTitle: { flex: 1, fontSize: 14.5, fontWeight: '700', marginRight: 10 },
  alertDate: { color: Ocean.textMuted, fontSize: 12 },
  alertBody: { color: Ocean.textSecondary, fontSize: 13.5, lineHeight: 20, marginTop: 6 },

  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Ocean.accent,
    borderRadius: radius.md,
    paddingVertical: 16,
    marginTop: 24,
  },
  reportText: { color: Ocean.bg, fontSize: 16, fontWeight: '700', marginLeft: 9 },
  footnote: { color: Ocean.textMuted, fontSize: 12.5, lineHeight: 18, marginTop: 10, textAlign: 'center' },

  account: {
    marginTop: 32,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: Ocean.cardBorder,
    alignItems: 'center',
  },
  accountEmail: { color: Ocean.textMuted, fontSize: 13 },
  signOut: { color: Ocean.danger, fontSize: 15, fontWeight: '600', marginTop: 12 },
});
