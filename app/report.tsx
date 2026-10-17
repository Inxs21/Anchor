import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAnchor } from '@/lib/anchor';
import { buildStats, generateReport, shareReport, statsDigest } from '@/lib/report';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Card } from '@/components/Card';
import { Ocean } from '@/constants/theme';

export default function Report() {
  const router = useRouter();
  const { loading, history, adherence, alerts, companionContext } = useAnchor();
  const [building, setBuilding] = useState(false);
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharedOnce, setSharedOnce] = useState(false);

  const stats = useMemo(
    () =>
      adherence
        ? buildStats(history, adherence, alerts, 30)
        : null,
    [history, adherence, alerts],
  );

  // Clear a stale PDF if the underlying data changes while this screen is open.
  useEffect(() => {
    setUri(null);
    setSharedOnce(false);
  }, [stats]);

  const build = async () => {
    if (!stats || building) return;
    setBuilding(true);
    setError(null);
    try {
      const result = await generateReport(companionContext, stats);
      setUri(result.uri);
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not build the report. Please try again.');
    } finally {
      setBuilding(false);
    }
  };

  const share = async () => {
    if (!uri) return;
    try {
      const ok = await shareReport(uri);
      if (!ok) setError('Sharing is not available on this device.');
      else setSharedOnce(true);
    } catch {
      setError('Could not open the share sheet.');
    }
  };

  if (loading || !stats) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={Ocean.accent} />
      </SafeAreaView>
    );
  }

  const completion = Math.round((stats.checkIns.length / stats.days) * 100);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headRow}>
          <Text style={styles.stepText}>Psychiatrist report</Text>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="close" size={24} color={Ocean.textSecondary} />
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>30 days, one page</Text>
        <Text style={styles.subtitle}>
          Mood and sleep charts, medication adherence, voice-trend graphs, and any early-warning
          alerts — with a plain-language summary at the top a doctor can read in 30 seconds.
        </Text>

        <View style={styles.tiles}>
          <View style={styles.tile}>
            <Text style={styles.tileValue}>
              {stats.checkIns.length}/{stats.days}
            </Text>
            <Text style={styles.tileLabel}>check-ins ({completion}%)</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.tileValue}>{Math.round(stats.adherence.rate * 100)}%</Text>
            <Text style={styles.tileLabel}>adherence</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.tileValue}>{stats.voiceTrend.length}</Text>
            <Text style={styles.tileLabel}>voice samples</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.tileValue}>{stats.alerts.length}</Text>
            <Text style={styles.tileLabel}>alerts fired</Text>
          </View>
        </View>

        <Card style={styles.previewCard}>
          <Text style={styles.previewLabel}>What goes in</Text>
          <Text style={styles.preview}>{statsDigest(stats)}</Text>
        </Card>

        {stats.checkIns.length === 0 && (
          <Text style={styles.warning}>
            There are no check-ins in this window yet, so the report will be mostly empty. Record
            one first for something worth handing over.
          </Text>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        {uri ? (
          <>
            <View style={styles.ready}>
              <Ionicons name="checkmark-circle" size={20} color={Ocean.success} />
              <Text style={styles.readyText}>
                {sharedOnce ? 'Shared. The PDF is still ready below.' : 'PDF ready.'}
              </Text>
            </View>
            <PrimaryButton title="Share or save PDF" onPress={share} style={styles.primary} />
            <TouchableOpacity style={styles.skip} onPress={build}>
              <Text style={styles.skipText}>Rebuild with the latest data</Text>
            </TouchableOpacity>
          </>
        ) : (
          <PrimaryButton
            title={building ? 'Building…' : 'Build the report'}
            onPress={build}
            busy={building}
            style={styles.primary}
          />
        )}

        <Text style={styles.footnote}>
          The report is generated on your device and shared only when you choose to share it.
          It is patient-generated data, intended to support a clinical conversation rather than
          replace one.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Ocean.bg },
  center: { flex: 1, backgroundColor: Ocean.bg, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 40 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepText: { color: Ocean.textMuted, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  title: { color: Ocean.textPrimary, fontSize: 26, fontWeight: '700', marginTop: 14 },
  subtitle: { color: Ocean.textSecondary, fontSize: 14.5, lineHeight: 21, marginTop: 10 },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 22, marginHorizontal: -4 },
  tile: {
    width: '50%',
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  tileValue: { color: Ocean.textPrimary, fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  tileLabel: { color: Ocean.textMuted, fontSize: 12.5, marginTop: 1 },

  previewCard: { marginTop: 14, backgroundColor: Ocean.surface },
  previewLabel: {
    color: Ocean.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  preview: { color: Ocean.textSecondary, fontSize: 13, lineHeight: 20 },

  warning: { color: Ocean.warning, fontSize: 13.5, lineHeight: 20, marginTop: 16 },
  error: { color: Ocean.danger, fontSize: 14, marginTop: 16, textAlign: 'center' },

  ready: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
    marginBottom: 4,
  },
  readyText: { color: Ocean.success, fontSize: 14.5, fontWeight: '600', marginLeft: 8 },

  primary: { marginTop: 18 },
  skip: { alignItems: 'center', paddingVertical: 14 },
  skipText: { color: Ocean.textSecondary, fontSize: 14.5, fontWeight: '600' },
  footnote: {
    color: Ocean.textMuted,
    fontSize: 12.5,
    lineHeight: 19,
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: Ocean.cardBorder,
    paddingTop: 16,
  },
});
