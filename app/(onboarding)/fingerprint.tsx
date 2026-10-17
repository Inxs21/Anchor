import {
  View, Text, TouchableOpacity, ScrollView, TextInput,
  StyleSheet, Animated, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { saveEpisodeFingerprint } from '@/lib/checkins';
import { Ocean } from '@/constants/theme';

// ─── Preset symptom lists ─────────────────────────────────────────────────────

const MANIA_PRESETS = [
  'Racing thoughts',
  'Overspending',
  'Low sleep',
  'High energy',
  'Impulsivity',
  'Grandiosity',
  'Fast speech',
  'Risky behavior',
  'Hypersexuality',
  'Irritability',
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

// ─── Chip component ───────────────────────────────────────────────────────────

function Chip({
  label, selected, onPress,
}: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Step dot indicator ───────────────────────────────────────────────────────

function StepDots({ step }: { step: number }) {
  return (
    <View style={styles.dotsRow}>
      {[0, 1].map((i) => (
        <View
          key={i}
          style={[
            styles.dot,
            i === step ? styles.dotActive : styles.dotInactive,
          ]}
        />
      ))}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function FingerprintScreen() {
  const { user } = useAuth();
  const router   = useRouter();

  const [step,            setStep]           = useState(0);
  const [maniaSelected,   setManiaSelected]  = useState<Set<string>>(new Set());
  const [depSelected,     setDepSelected]    = useState<Set<string>>(new Set());
  const [maniaCustom,     setManiaCustom]    = useState('');
  const [depCustom,       setDepCustom]      = useState('');
  const [saving,          setSaving]         = useState(false);

  const slideAnim = useRef(new Animated.Value(0)).current;

  function toggle(set: Set<string>, setFn: (s: Set<string>) => void, label: string) {
    const next = new Set(set);
    next.has(label) ? next.delete(label) : next.add(label);
    setFn(next);
  }

  function addCustom(
    value: string,
    set: Set<string>,
    setFn: (s: Set<string>) => void,
    clearFn: (v: string) => void,
  ) {
    const trimmed = value.trim();
    if (!trimmed) return;
    const next = new Set(set);
    next.add(trimmed);
    setFn(next);
    clearFn('');
  }

  function advanceStep() {
    Animated.timing(slideAnim, {
      toValue: -400,
      duration: 260,
      useNativeDriver: true,
    }).start(() => {
      slideAnim.setValue(400);
      setStep(1);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }).start();
    });
  }

  async function handleComplete() {
    if (!user) return;
    setSaving(true);
    try {
      const maniaList = Array.from(maniaSelected);
      const depList   = Array.from(depSelected);
      await saveEpisodeFingerprint(user.uid, {
        maniaSymptoms:      maniaList,
        depressionSymptoms: depList,
      });
    } catch (e) {
      console.warn('fingerprint save error:', e);
    } finally {
      setSaving(false);
      router.replace('/');
    }
  }

  const isStep0 = step === 0;
  const presets = isStep0 ? MANIA_PRESETS : DEPRESSION_PRESETS;
  const selected = isStep0 ? maniaSelected : depSelected;
  const setSelected = isStep0
    ? (s: Set<string>) => setManiaSelected(s)
    : (s: Set<string>) => setDepSelected(s);
  const customValue = isStep0 ? maniaCustom : depCustom;
  const setCustomValue = isStep0 ? setManiaCustom : setDepCustom;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Animated.View
          style={[styles.content, { transform: [{ translateX: slideAnim }] }]}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            {/* Title */}
            <Text style={styles.title}>
              {isStep0
                ? 'When you feel unusually energized...'
                : 'When you feel low...'}
            </Text>
            <Text style={styles.subtitle}>
              {isStep0
                ? 'What changes do you notice?'
                : 'What does that look like?'}
            </Text>

            {/* Preset chips */}
            <View style={styles.chipsWrap}>
              {presets.map((label) => (
                <Chip
                  key={label}
                  label={label}
                  selected={selected.has(label)}
                  onPress={() => toggle(selected, setSelected, label)}
                />
              ))}

              {/* Custom chips added by user */}
              {Array.from(selected)
                .filter((s) => !presets.includes(s))
                .map((label) => (
                  <Chip
                    key={label}
                    label={label}
                    selected
                    onPress={() => toggle(selected, setSelected, label)}
                  />
                ))}
            </View>

            {/* Custom symptom input */}
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder="Add your own..."
                placeholderTextColor={Ocean.textMuted}
                value={customValue}
                onChangeText={setCustomValue}
                onSubmitEditing={() =>
                  addCustom(customValue, selected, setSelected, setCustomValue)
                }
                returnKeyType="done"
              />
              {customValue.trim().length > 0 && (
                <TouchableOpacity
                  style={styles.addBtn}
                  onPress={() =>
                    addCustom(customValue, selected, setSelected, setCustomValue)
                  }
                >
                  <Text style={styles.addBtnText}>Add</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </Animated.View>

        {/* Bottom area */}
        <View style={styles.bottom}>
          <TouchableOpacity
            style={[styles.btn, saving && styles.btnDisabled]}
            onPress={isStep0 ? advanceStep : handleComplete}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>
              {isStep0 ? 'Continue' : saving ? 'Saving...' : 'Complete Setup'}
            </Text>
          </TouchableOpacity>
          <StepDots step={step} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Ocean.bg,
  },
  content: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: Ocean.textPrimary,
    marginBottom: 8,
    lineHeight: 36,
  },
  subtitle: {
    fontSize: 15,
    color: Ocean.textSecondary,
    marginBottom: 32,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: Ocean.cardBorder,
    backgroundColor: Ocean.surface,
  },
  chipSelected: {
    borderColor: Ocean.accent,
    backgroundColor: 'rgba(78,205,196,0.12)',
  },
  chipText: {
    fontSize: 14,
    color: Ocean.textSecondary,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: Ocean.accent,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    gap: 8,
  },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Ocean.cardBorder,
    backgroundColor: Ocean.surface,
    paddingHorizontal: 14,
    color: Ocean.textPrimary,
    fontSize: 14,
  },
  addBtn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Ocean.accentDim,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtnText: {
    color: Ocean.accent,
    fontWeight: '600',
    fontSize: 14,
  },
  bottom: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    gap: 16,
  },
  btn: {
    height: 54,
    borderRadius: 14,
    backgroundColor: Ocean.accentBtn,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color: Ocean.bg,
    fontSize: 16,
    fontWeight: '700',
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 4,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    width: 24,
    backgroundColor: Ocean.accent,
  },
  dotInactive: {
    width: 6,
    backgroundColor: Ocean.textMuted,
  },
});
