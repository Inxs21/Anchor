import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth';
import { saveFingerprint } from '@/lib/fingerprint';
import { Chip } from '@/components/Chip';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Ocean, radius } from '@/constants/theme';

const MANIA_PRESETS = [
  'Racing thoughts',
  'Overspending',
  'Low sleep',
  'High energy',
  'Impulsivity',
  'Grandiosity',
  'Fast speech',
  'Risky behavior',
  'Irritability',
  'Goal-driven activity',
];

const DEPRESSION_PRESETS = [
  'Low motivation',
  'Withdrawn',
  'Fatigue',
  'Restlessness',
  'Hypersomnia',
  'Poor concentration',
  'Hopelessness',
  'Appetite changes',
  'Slowed thinking',
  'Social isolation',
];

const STEPS = [
  {
    key: 'mania' as const,
    title: 'What does YOUR mania look like?',
    subtitle:
      'Pick the signs that show up when you are elevated. Anchor uses this to recognize your personal pattern — not a generic one.',
    presets: MANIA_PRESETS,
  },
  {
    key: 'depression' as const,
    title: 'What does YOUR depression look like?',
    subtitle: 'Pick the signs that show up when you are low. You can mix both lists freely.',
    presets: DEPRESSION_PRESETS,
  },
];

export default function Fingerprint() {
  const { user } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [mania, setMania] = useState<string[]>([]);
  const [depression, setDepression] = useState<string[]>([]);
  const [customText, setCustomText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = STEPS[step];
  const selected = current.key === 'mania' ? mania : depression;
  const setSelected = current.key === 'mania' ? setMania : setDepression;

  const toggle = (label: string) => {
    setSelected((prev) => (prev.includes(label) ? prev.filter((s) => s !== label) : [...prev, label]));
  };

  const addCustom = () => {
    const value = customText.trim();
    if (!value) return;
    if (!selected.includes(value)) setSelected((prev) => [...prev, value]);
    setCustomText('');
  };

  const onNext = async () => {
    if (selected.length === 0) {
      setError('Pick at least one sign, or add your own below.');
      return;
    }
    setError(null);
    if (step === 0) {
      setStep(1);
      return;
    }
    if (!user) return;
    setBusy(true);
    try {
      await saveFingerprint(user.uid, { maniaSymptoms: mania, depressionSymptoms: depression });
      router.replace('/(onboarding)/setup');
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not save your profile. Please try again.');
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.stepRow}>
            <Text style={styles.stepText}>Step {step + 1} of 2 · Episode Fingerprint</Text>
            <View style={styles.dots}>
              {[0, 1].map((i) => (
                <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
              ))}
            </View>
          </View>

          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.subtitle}>{current.subtitle}</Text>

          <View style={styles.chips}>
            {current.presets.map((p) => (
              <Chip key={p} label={p} selected={selected.includes(p)} onPress={() => toggle(p)} />
            ))}
            {selected
              .filter((s) => !current.presets.includes(s))
              .map((s) => (
                <Chip key={s} label={s} selected onPress={() => toggle(s)} />
              ))}
          </View>

          <View style={styles.customRow}>
            <TextInput
              style={styles.customInput}
              value={customText}
              onChangeText={setCustomText}
              placeholder="Add your own sign…"
              placeholderTextColor={Ocean.textMuted}
              autoCapitalize="sentences"
              onSubmitEditing={addCustom}
              returnKeyType="done"
            />
            <TouchableOpacity style={styles.addBtn} onPress={addCustom}>
              <Ionicons name="add" size={22} color={Ocean.bg} />
            </TouchableOpacity>
          </View>

          <Text style={styles.count}>
            {selected.length} selected
          </Text>

          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>

        <View style={styles.footer}>
          {step === 1 && (
            <TouchableOpacity style={styles.back} onPress={() => setStep(0)} disabled={busy}>
              <Ionicons name="chevron-back" size={20} color={Ocean.textSecondary} />
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
          )}
          {busy ? (
            <ActivityIndicator color={Ocean.accent} />
          ) : (
            <PrimaryButton
              title={step === 0 ? 'Continue' : 'Save my fingerprint'}
              onPress={onNext}
              style={styles.nextBtn}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: Ocean.bg },
  scroll: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 32 },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepText: { color: Ocean.textMuted, fontSize: 13, fontWeight: '600' },
  dots: { flexDirection: 'row' },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Ocean.cardBorder,
    marginLeft: 6,
  },
  dotActive: { backgroundColor: Ocean.accent, width: 18 },
  title: { color: Ocean.textPrimary, fontSize: 26, fontWeight: '700', marginTop: 22 },
  subtitle: { color: Ocean.textSecondary, fontSize: 15, lineHeight: 21, marginTop: 10, marginBottom: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  customRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  customInput: {
    flex: 1,
    backgroundColor: Ocean.surface,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Ocean.textPrimary,
    fontSize: 15,
  },
  addBtn: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: Ocean.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  count: { color: Ocean.textMuted, fontSize: 13, marginTop: 14 },
  error: { color: Ocean.danger, fontSize: 14, marginTop: 12 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: Ocean.cardBorder,
    backgroundColor: Ocean.bg,
  },
  back: { flexDirection: 'row', alignItems: 'center', marginRight: 14 },
  backText: { color: Ocean.textSecondary, fontSize: 15, fontWeight: '600', marginLeft: 2 },
  nextBtn: { flex: 1 },
});
