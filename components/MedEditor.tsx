import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Chip } from './Chip';
import { PrimaryButton } from './PrimaryButton';
import { TextField } from './TextField';
import { Ocean, radius } from '@/constants/theme';
import type { MedDraft } from '@/lib/medications';

type Props = {
  onSubmit: (draft: MedDraft) => Promise<void>;
  submitLabel?: string;
};

const QUICK_TIMES = ['08:00', '12:00', '18:00', '21:00'];
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

export function MedEditor({ onSubmit, submitLabel = 'Add medication' }: Props) {
  const [name, setName] = useState('');
  const [dosage, setDosage] = useState('');
  const [schedule, setSchedule] = useState<'daily' | 'custom'>('daily');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [times, setTimes] = useState<string[]>([]);
  const [timeInput, setTimeInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addTime = (raw: string) => {
    const t = raw.trim();
    if (!TIME_RE.test(t)) {
      setError('Times look like 08:00 or 21:30.');
      return;
    }
    const normalized = t.length === 4 ? `0${t}` : t;
    setError(null);
    setTimes((prev) => (prev.includes(normalized) ? prev : [...prev, normalized].sort()));
    setTimeInput('');
  };

  const removeTime = (t: string) => setTimes((prev) => prev.filter((x) => x !== t));

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const submit = async () => {
    if (!name.trim()) {
      setError('Give the medication a name.');
      return;
    }
    if (schedule === 'custom' && days.length === 0) {
      setError('Pick at least one day.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        dosage: dosage.trim(),
        schedule,
        days: schedule === 'daily' ? [] : [...days].sort(),
        times,
      });
      setName('');
      setDosage('');
      setTimes([]);
      setTimeInput('');
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Lithium" />
      <TextField label="Dosage" value={dosage} onChangeText={setDosage} placeholder="e.g. 400mg" />

      <Text style={styles.label}>Schedule</Text>
      <View style={styles.row}>
        <Chip label="Daily" selected={schedule === 'daily'} onPress={() => setSchedule('daily')} />
        <Chip label="Choose days" selected={schedule === 'custom'} onPress={() => setSchedule('custom')} />
      </View>

      {schedule === 'custom' && (
        <View style={styles.daysRow}>
          {DAY_LETTERS.map((letter, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.day, days.includes(i) && styles.dayActive]}
              onPress={() => toggleDay(i)}
            >
              <Text style={[styles.dayText, days.includes(i) && styles.dayTextActive]}>{letter}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={styles.label}>Times</Text>
      <View style={styles.row}>
        {times.map((t) => (
          <Chip key={t} label={`${t}  ×`} selected onPress={() => removeTime(t)} />
        ))}
      </View>
      <View style={styles.timeRow}>
        <TextInput
          style={styles.timeInput}
          value={timeInput}
          onChangeText={setTimeInput}
          placeholder="HH:MM"
          placeholderTextColor={Ocean.textMuted}
          keyboardType="numbers-and-punctuation"
          onSubmitEditing={() => addTime(timeInput)}
          returnKeyType="done"
        />
        <TouchableOpacity style={styles.timeAdd} onPress={() => addTime(timeInput)}>
          <Text style={styles.timeAddText}>Add</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.row}>
        {QUICK_TIMES.filter((t) => !times.includes(t)).map((t) => (
          <Chip key={t} label={`+ ${t}`} selected={false} onPress={() => addTime(t)} />
        ))}
      </View>
      <Text style={styles.hint}>
        {times.length === 0
          ? 'No times = as-needed (you log these when you take them).'
          : `${times.length} time${times.length === 1 ? '' : 's'} a day.`}
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <PrimaryButton title={submitLabel} onPress={submit} busy={busy} style={styles.submit} />
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: Ocean.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 4,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  daysRow: { flexDirection: 'row', marginBottom: 10 },
  day: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Ocean.surface,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  dayActive: { backgroundColor: Ocean.accentDim, borderColor: Ocean.accent },
  dayText: { color: Ocean.textSecondary, fontSize: 14, fontWeight: '700' },
  dayTextActive: { color: Ocean.accent },
  timeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  timeInput: {
    flex: 1,
    backgroundColor: Ocean.surface,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: Ocean.textPrimary,
    fontSize: 15,
  },
  timeAdd: {
    backgroundColor: Ocean.accentDim,
    borderWidth: 1,
    borderColor: Ocean.accent,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 11,
    marginLeft: 8,
  },
  timeAddText: { color: Ocean.accent, fontWeight: '700', fontSize: 14 },
  hint: { color: Ocean.textMuted, fontSize: 13, marginTop: 6, lineHeight: 18 },
  error: { color: Ocean.danger, fontSize: 14, marginTop: 10 },
  submit: { marginTop: 18 },
});
