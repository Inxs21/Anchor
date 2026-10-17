import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/lib/auth';
import { useAnchor } from '@/lib/anchor';
import {
  addMedication,
  deleteMedication,
  getMedications,
  markDoseTaken,
  undoDose,
  type DayDose,
  type MedDraft,
  type Medication,
} from '@/lib/medications';
import { dateKey, shortLabel } from '@/lib/dates';
import { Card } from '@/components/Card';
import { MedEditor } from '@/components/MedEditor';
import { Ocean, radius } from '@/constants/theme';

const statusMeta: Record<DayDose['status'], { icon: keyof typeof Ionicons.glyphMap; color: string }> =
  {
    taken: { icon: 'checkmark-circle', color: Ocean.success },
    missed: { icon: 'close-circle', color: Ocean.danger },
    pending: { icon: 'ellipse-outline', color: Ocean.textMuted },
  };

export default function Meds() {
  const { user } = useAuth();
  const { loading, dayLog, adherence, refresh } = useAnchor();
  const [meds, setMeds] = useState<Medication[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadMeds = useCallback(() => {
    if (!user) return;
    getMedications(user.uid)
      .then(setMeds)
      .catch(() => {});
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadMeds();
    }, [loadMeds]),
  );

  const onAdd = async (draft: MedDraft) => {
    if (!user) return;
    const id = await addMedication(user.uid, draft);
    setMeds((prev) => [...prev, { id, ...draft }]);
    setShowEditor(false);
    await refresh().catch(() => {});
  };

  const onDelete = (med: Medication) => {
    Alert.alert('Remove medication', `Stop tracking ${med.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (!user) return;
          await deleteMedication(user.uid, med.id).catch(() => {});
          setMeds((prev) => prev.filter((m) => m.id !== med.id));
          await refresh().catch(() => {});
        },
      },
    ]);
  };

  const toggleDose = async (dose: DayDose) => {
    if (!user || busy) return;
    setBusy(dose.id);
    try {
      if (dose.status === 'taken') {
        await undoDose(user.uid, dateKey(), dose.id);
      } else {
        await markDoseTaken(user.uid, dose);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      await refresh();
    } catch {
      Alert.alert('Could not save', 'Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator size="large" color={Ocean.accent} />
      </SafeAreaView>
    );
  }

  const doses = dayLog?.doses ?? [];
  const takenToday = doses.filter((d) => d.status === 'taken').length;
  const recent = (adherence?.days ?? []).slice(-14);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Medications</Text>
        <Text style={styles.subtitle}>
          {doses.length === 0
            ? 'No doses scheduled for today.'
            : `${takenToday} of ${doses.length} logged today.`}
        </Text>

        {adherence && adherence.taken + adherence.missed > 0 && (
          <Card style={styles.adherenceCard}>
            <View style={styles.adherenceHead}>
              <View>
                <Text style={styles.adherenceValue}>{Math.round(adherence.rate * 100)}%</Text>
                <Text style={styles.adherenceLabel}>30-day adherence</Text>
              </View>
              <Text style={styles.adherenceCount}>
                {adherence.taken} taken · {adherence.missed} missed
              </Text>
            </View>

            {/* Fourteen-day strip: one column per day, taken over missed. */}
            <View style={styles.strip}>
              {recent.map((d) => {
                const total = d.taken + d.missed + d.pending;
                const fill =
                  total === 0 ? 0 : d.taken / (d.taken + d.missed || 1);
                const color =
                  total === 0
                    ? Ocean.cardBorder
                    : d.missed === 0
                      ? Ocean.success
                      : d.taken === 0
                        ? Ocean.danger
                        : Ocean.warning;
                return (
                  <View key={d.date} style={styles.stripCol}>
                    <View style={styles.stripTrack}>
                      <View
                        style={[
                          styles.stripFill,
                          { height: `${Math.max(total === 0 ? 6 : fill * 100, 6)}%`, backgroundColor: color },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
            <View style={styles.stripLabels}>
              <Text style={styles.stripLabel}>
                {recent.length > 0 ? shortLabel(recent[0].date) : ''}
              </Text>
              <Text style={styles.stripLabel}>Today</Text>
            </View>
          </Card>
        )}

        <Text style={styles.sectionLabel}>Today</Text>
        {doses.length === 0 ? (
          <Card>
            <Text style={styles.empty}>
              Nothing scheduled. Add a medication below and its doses will appear here.
            </Text>
          </Card>
        ) : (
          doses.map((dose) => {
            const meta = statusMeta[dose.status];
            return (
              <TouchableOpacity
                key={dose.id}
                style={styles.doseRow}
                onPress={() => toggleDose(dose)}
                disabled={busy === dose.id}
                activeOpacity={0.75}
              >
                {busy === dose.id ? (
                  <ActivityIndicator size="small" color={Ocean.accent} style={styles.doseIcon} />
                ) : (
                  <Ionicons name={meta.icon} size={24} color={meta.color} style={styles.doseIcon} />
                )}
                <View style={styles.flex}>
                  <Text
                    style={[styles.doseName, dose.status === 'taken' && styles.doseNameTaken]}
                  >
                    {dose.medName}
                    {dose.dosage ? ` · ${dose.dosage}` : ''}
                  </Text>
                  <Text style={styles.doseMeta}>
                    {dose.time || 'As needed'}
                    {dose.status === 'missed' ? ' · missed' : ''}
                    {dose.status === 'taken' ? ' · logged' : ''}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}

        <Text style={styles.sectionLabel}>Your medications</Text>
        {meds.map((m) => (
          <View key={m.id} style={styles.medRow}>
            <View style={styles.medIcon}>
              <MaterialCommunityIcons name="pill" size={16} color={Ocean.accent} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.medName}>
                {m.name}
                {m.dosage ? ` · ${m.dosage}` : ''}
              </Text>
              <Text style={styles.doseMeta}>
                {m.times.length === 0
                  ? 'As-needed'
                  : `${m.schedule === 'daily' ? 'Daily' : `${m.days.length} days/week`} at ${m.times.join(', ')}`}
              </Text>
            </View>
            <TouchableOpacity onPress={() => onDelete(m)} hitSlop={10}>
              <Ionicons name="trash-outline" size={19} color={Ocean.textMuted} />
            </TouchableOpacity>
          </View>
        ))}

        {showEditor ? (
          <Card style={styles.editorCard}>
            <MedEditor onSubmit={onAdd} submitLabel="Save medication" />
            <TouchableOpacity style={styles.cancel} onPress={() => setShowEditor(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowEditor(true)}>
            <Ionicons name="add" size={20} color={Ocean.accent} />
            <Text style={styles.addText}>Add a medication</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.footnote}>
          Anchor never nags about a missed dose. It notes the pattern, folds it into your
          psychiatrist report, and your companion may mention it once in conversation.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: Ocean.bg },
  center: { flex: 1, backgroundColor: Ocean.bg, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 40 },
  title: { color: Ocean.textPrimary, fontSize: 26, fontWeight: '700' },
  subtitle: { color: Ocean.textSecondary, fontSize: 14.5, marginTop: 4, marginBottom: 18 },

  adherenceCard: { marginBottom: 6 },
  adherenceHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  adherenceValue: { color: Ocean.textPrimary, fontSize: 32, fontWeight: '700', letterSpacing: -0.8 },
  adherenceLabel: { color: Ocean.textMuted, fontSize: 12, marginTop: 1 },
  adherenceCount: { color: Ocean.textSecondary, fontSize: 13 },
  strip: { flexDirection: 'row', height: 46, alignItems: 'flex-end', marginTop: 16 },
  stripCol: { flex: 1, paddingHorizontal: 1.5, height: '100%', justifyContent: 'flex-end' },
  stripTrack: {
    height: '100%',
    backgroundColor: Ocean.surface,
    borderRadius: 3,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  stripFill: { width: '100%', borderRadius: 3 },
  stripLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  stripLabel: { color: Ocean.textMuted, fontSize: 11 },

  sectionLabel: {
    color: Ocean.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 26,
    marginBottom: 10,
  },
  empty: { color: Ocean.textSecondary, fontSize: 14.5, lineHeight: 21 },

  doseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Ocean.card,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 8,
  },
  doseIcon: { width: 26, marginRight: 12 },
  doseName: { color: Ocean.textPrimary, fontSize: 15.5, fontWeight: '600' },
  doseNameTaken: { color: Ocean.textSecondary },
  doseMeta: { color: Ocean.textSecondary, fontSize: 13, marginTop: 2 },

  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Ocean.surface,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 8,
  },
  medIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Ocean.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  medName: { color: Ocean.textPrimary, fontSize: 15, fontWeight: '700' },

  editorCard: { marginTop: 6 },
  cancel: { alignItems: 'center', paddingTop: 14 },
  cancelText: { color: Ocean.textSecondary, fontSize: 15, fontWeight: '600' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Ocean.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    marginTop: 4,
  },
  addText: { color: Ocean.accent, fontSize: 15, fontWeight: '700', marginLeft: 7 },
  footnote: { color: Ocean.textMuted, fontSize: 12.5, lineHeight: 19, marginTop: 24 },
});
