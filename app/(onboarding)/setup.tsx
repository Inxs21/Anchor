import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@/lib/auth';
import { addMedication, getMedications, type MedDraft, type Medication } from '@/lib/medications';
import { MedEditor } from '@/components/MedEditor';
import { Ocean, radius } from '@/constants/theme';

export default function Setup() {
  const { user } = useAuth();
  const router = useRouter();
  const [meds, setMeds] = useState<Medication[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getMedications(user.uid)
      .then((list) => {
        if (!cancelled) setMeds(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  const addMed = async (draft: MedDraft) => {
    if (!user) return;
    const id = await addMedication(user.uid, draft);
    setMeds((prev) => [...prev, { id, ...draft }]);
  };

  const finish = async (withNotifications: boolean) => {
    if (busy) return;
    setBusy(true);
    if (withNotifications) {
      try {
        await Notifications.requestPermissionsAsync();
      } catch {
        // Notifications unavailable in this environment (e.g. Expo Go) — continue
      }
    }
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.stepRow}>
          <Text style={styles.stepText}>Final step · Medications</Text>
          <Ionicons name="medical" size={16} color={Ocean.textMuted} />
        </View>

        <Text style={styles.title}>Track your medications</Text>
        <Text style={styles.subtitle}>
          Anchor logs adherence, folds it into your psychiatrist report, and a companion will
          mention missed doses conversationally — never as a nag.
        </Text>

        {meds.length > 0 && (
          <View style={styles.medList}>
            {meds.map((m) => (
              <View key={m.id} style={styles.medRow}>
                <View style={styles.medIcon}>
                  <MaterialCommunityIcons name="pill" size={16} color={Ocean.accent} />
                </View>
                <View style={styles.medInfo}>
                  <Text style={styles.medName}>
                    {m.name}
                    {m.dosage ? ` · ${m.dosage}` : ''}
                  </Text>
                  <Text style={styles.medMeta}>
                    {m.times.length === 0
                      ? 'As-needed'
                      : `${m.schedule === 'daily' ? 'Daily' : `${m.days.length} days/week`} at ${m.times.join(', ')}`}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.editorCard}>
          <MedEditor onSubmit={addMed} submitLabel="Add medication" />
        </View>

        <TouchableOpacity style={styles.finish} onPress={() => finish(true)} disabled={busy}>
          <Text style={styles.finishText}>{busy ? 'Finishing…' : 'Finish setup'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.skip} onPress={() => finish(false)} disabled={busy}>
          <Text style={styles.skipText}>Skip — I&apos;ll add these later</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Ocean.bg },
  scroll: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 48 },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepText: { color: Ocean.textMuted, fontSize: 13, fontWeight: '600' },
  title: { color: Ocean.textPrimary, fontSize: 26, fontWeight: '700', marginTop: 20 },
  subtitle: { color: Ocean.textSecondary, fontSize: 15, lineHeight: 21, marginTop: 10, marginBottom: 22 },
  medList: { marginBottom: 16 },
  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Ocean.card,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 8,
  },
  medIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Ocean.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  medInfo: { flex: 1 },
  medName: { color: Ocean.textPrimary, fontSize: 15, fontWeight: '700' },
  medMeta: { color: Ocean.textSecondary, fontSize: 13, marginTop: 2 },
  editorCard: {
    backgroundColor: Ocean.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    padding: 16,
    marginBottom: 24,
  },
  finish: {
    backgroundColor: Ocean.accent,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  finishText: { color: Ocean.bg, fontSize: 17, fontWeight: '700' },
  skip: { alignItems: 'center', paddingVertical: 14 },
  skipText: { color: Ocean.textSecondary, fontSize: 15, fontWeight: '600' },
});
