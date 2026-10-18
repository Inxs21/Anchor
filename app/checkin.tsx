import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/lib/auth';
import { useAnchor } from '@/lib/anchor';
import { averageVoice, saveCheckIn, type Analysis, type VoiceTurn } from '@/lib/checkins';
import { voiceQuestions, DEFAULT_VOICE_QUESTIONS } from '@/lib/claude';
import { analyzeCheckIn } from '@/lib/llm';
import { analyzeProsody, speechRateScore } from '@/lib/hume';
import { canTranscribe, transcribe } from '@/lib/stt';
import { requestMicPermission, speak, stopSpeaking, VoiceRecorder } from '@/lib/voice';
import { Chip } from '@/components/Chip';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Scale } from '@/components/Scale';
import { ScoreBar } from '@/components/ScoreBar';
import { StateBadge } from '@/components/StateBadge';
import { Waveform } from '@/components/Waveform';
import { Ocean, radius, stateColor } from '@/constants/theme';

type Stage = 'self' | 'voice' | 'working' | 'done';
type VoicePhase = 'asking' | 'ready' | 'recording' | 'processing' | 'typing';

const SLEEP_MIN = 0;
const SLEEP_MAX = 14;

export default function CheckIn() {
  const { user } = useAuth();
  const router = useRouter();
  const { fingerprint, companionContext, refresh } = useAnchor();

  const [stage, setStage] = useState<Stage>('self');

  // Self-report
  const [mood, setMood] = useState(0);
  const [energy, setEnergy] = useState(5);
  const [sleepHours, setSleepHours] = useState(7);
  const [irritability, setIrritability] = useState(3);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [note, setNote] = useState('');

  // Voice
  const [questions, setQuestions] = useState<string[]>(DEFAULT_VOICE_QUESTIONS);
  const [qIndex, setQIndex] = useState(0);
  const [phase, setPhase] = useState<VoicePhase>('asking');
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [micDenied, setMicDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A take whose words we could not hear, held while the person types them.
  // The spoken span rides along so a typed answer gets the same rate basis.
  const [pending, setPending] = useState<{ turn: VoiceTurn; spokenMs: number } | null>(null);
  const [typed, setTyped] = useState('');

  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  const recorder = useRef(new VoiceRecorder()).current;
  const cancelled = useRef(false);

  const allSigns = useMemo(
    () => [...(fingerprint?.maniaSymptoms ?? []), ...(fingerprint?.depressionSymptoms ?? [])],
    [fingerprint],
  );

  // Leaving mid-session must not leave the mic hot or the companion talking.
  useEffect(() => {
    return () => {
      cancelled.current = true;
      recorder.cancel().catch(() => {});
      stopSpeaking().catch(() => {});
    };
  }, [recorder]);

  const toggleSymptom = (s: string) =>
    setSymptoms((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  // -------------------------------------------------------------------------
  // Voice stage
  // -------------------------------------------------------------------------

  const askQuestion = useCallback(
    async (index: number, qs: string[]) => {
      setPhase('asking');
      await speak(qs[index], mood >= 2 ? 'grounding' : mood <= -2 ? 'activating' : 'steady');
      if (!cancelled.current) setPhase('ready');
    },
    [mood],
  );

  const startVoice = async () => {
    const granted = await requestMicPermission();
    if (!granted) {
      setMicDenied(true);
      await finish([]);
      return;
    }
    setStage('voice');
    setPhase('asking');
    // Resolve the question list before the first one is spoken, so what is read
    // aloud always matches what is on screen.
    const qs = await voiceQuestions(companionContext).catch(() => DEFAULT_VOICE_QUESTIONS);
    if (cancelled.current) return;
    setQuestions(qs);
    await askQuestion(0, qs);
  };

  const beginRecording = async () => {
    setError(null);
    try {
      await stopSpeaking();
      await recorder.start();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setPhase('recording');
    } catch {
      setError('Could not reach the microphone. You can skip the voice part.');
      setPhase('ready');
    }
  };

  // The ref is the source of truth: finish() runs in the same tick as the last
  // setTurns, so reading React state there would miss the final answer.
  const turnsRef = useRef<VoiceTurn[]>([]);

  const commitTurn = (turn: VoiceTurn) => {
    const next = [...turnsRef.current, turn];
    turnsRef.current = next;
    setTurns(next);
  };

  const advance = async () => {
    const nextIndex = qIndex + 1;
    if (nextIndex >= questions.length) {
      await finish(turnsRef.current);
      return;
    }
    setQIndex(nextIndex);
    await askQuestion(nextIndex, questions);
  };

  const endRecording = async () => {
    setPhase('processing');
    let captured: { turn: VoiceTurn; spokenMs: number } | null = null;
    try {
      const take = await recorder.stop();
      // Takes under ~0.7s carry no usable prosody — treat them as a non-answer.
      if (take && take.durationMs > 700) {
        // Transcribe before prosody: the words give the count, and their
        // timestamps give the span the rate is measured against.
        const spoken = await transcribe({ uri: take.uri });
        const { scores, transcript } = await analyzeProsody({
          uri: take.uri,
          durationMs: take.durationMs,
          transcript: spoken.text,
          spokenMs: spoken.spokenMs || undefined,
          meterSamples: take.meterSamples,
          meterIntervalMs: take.meterIntervalMs,
        });
        captured = {
          turn: {
            question: questions[qIndex],
            transcript,
            scores,
            durationMs: take.durationMs,
          },
          spokenMs: spoken.spokenMs,
        };
      }
    } catch {
      // A failed take is skipped rather than failing the whole check-in.
    }
    if (cancelled.current) return;

    // Nothing came back in words — offer to type it rather than storing silence.
    if (captured && !captured.turn.transcript.trim()) {
      setPending(captured);
      setTyped('');
      setPhase('typing');
      return;
    }
    if (captured) commitTurn(captured.turn);
    await advance();
  };

  /** Leaves the typing step, with or without words. Never discards the take. */
  const confirmTyped = async () => {
    const take = pending;
    const text = typed.trim();
    setPending(null);
    setTyped('');
    if (take) {
      commitTurn(
        text
          ? {
              ...take.turn,
              transcript: text,
              // Rate was measured as neutral without words; the real count beats
              // it, measured against the span they were audible for.
              scores: {
                ...take.turn.scores,
                speechRate: speechRateScore(text, take.turn.durationMs, take.spokenMs || undefined),
              },
            }
          : take.turn,
      );
    }
    await advance();
  };

  const skipVoice = async () => {
    await recorder.cancel().catch(() => {});
    await stopSpeaking().catch(() => {});
    // A take waiting on typed words is still a measured answer — keep it.
    if (pending) {
      const text = typed.trim();
      commitTurn(
        text
          ? {
              ...pending.turn,
              transcript: text,
              scores: {
                ...pending.turn.scores,
                speechRate: speechRateScore(
                  text,
                  pending.turn.durationMs,
                  pending.spokenMs || undefined,
                ),
              },
            }
          : pending.turn,
      );
      setPending(null);
      setTyped('');
    }
    await finish(turnsRef.current);
  };

  // -------------------------------------------------------------------------
  // Save and analyze
  // -------------------------------------------------------------------------

  const finish = async (collected: VoiceTurn[]) => {
    if (!user) return;
    setStage('working');
    const voice = averageVoice(collected);
    const draft = {
      mood,
      energy,
      sleepHours,
      irritability,
      symptoms,
      note: note.trim(),
      voice,
      turns: collected,
      analysis: null,
    };

    try {
      // Save first so the day is recorded even if analysis fails.
      const saved = await saveCheckIn(user.uid, draft);
      const result = await analyzeCheckIn({ ...companionContext, today: saved }, saved);
      await saveCheckIn(user.uid, { ...draft, analysis: result });
      if (cancelled.current) return;
      setAnalysis(result);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await refresh().catch(() => {});
      setStage('done');
    } catch (e) {
      if (cancelled.current) return;
      setError((e as Error)?.message ?? 'Could not save your check-in. Please try again.');
      setStage('self');
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (stage === 'working') {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={Ocean.accent} />
        <Text style={styles.workingText}>Reading today against your pattern…</Text>
      </SafeAreaView>
    );
  }

  if (stage === 'done' && analysis) {
    const color = stateColor(analysis.state);
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.doneHead}>
            <StateBadge state={analysis.state} />
            <Text style={styles.risk}>Episode risk {Math.round(analysis.risk * 100)}%</Text>
          </View>

          <Text style={styles.doneSummary}>{analysis.summary}</Text>

          {analysis.discrepancy && (
            <View style={styles.discrepancy}>
              <Ionicons name="pulse" size={18} color={Ocean.mixed} />
              <Text style={styles.discrepancyText}>{analysis.discrepancy}</Text>
            </View>
          )}

          {turns.length > 0 && (
            <View style={styles.voiceCard}>
              <Text style={styles.sectionLabel}>
                Voice signals · {turns.length} answer{turns.length === 1 ? '' : 's'}
              </Text>
              {(() => {
                const v = averageVoice(turns);
                if (!v) return null;
                return (
                  <>
                    <ScoreBar label="Speech rate" value={v.speechRate} color={color} />
                    <ScoreBar label="Pitch variance" value={v.pitchVariance} color={color} />
                    <ScoreBar label="Vocal energy" value={v.energy} color={color} />
                    <ScoreBar label="Emotional valence" value={v.valence} color={Ocean.mixed} />
                  </>
                );
              })()}
            </View>
          )}

          <Text style={styles.sectionLabel}>What would help today</Text>
          {analysis.recommendations.map((r) => (
            <View key={r} style={styles.bulletRow}>
              <View style={[styles.bullet, { backgroundColor: color }]} />
              <Text style={styles.bulletText}>{r}</Text>
            </View>
          ))}

          <PrimaryButton
            title="Keep talking with Anchor"
            onPress={() => router.replace('/(tabs)/companion')}
            style={styles.primary}
          />
          <TouchableOpacity style={styles.skip} onPress={() => router.replace('/(tabs)')}>
            <Text style={styles.skipText}>Back to today</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (stage === 'voice') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.voiceStage}>
          <Text style={styles.stepText}>
            Question {qIndex + 1} of {questions.length}
          </Text>
          <Text style={styles.question}>{questions[qIndex]}</Text>

          <View style={styles.waveWrap}>
            <Waveform
              active={phase === 'recording' || phase === 'asking'}
              color={phase === 'recording' ? Ocean.accent : Ocean.textMuted}
            />
          </View>

          <Text style={styles.phaseHint}>
            {phase === 'asking'
              ? 'Listening to the question…'
              : phase === 'ready'
                ? 'Tap to answer out loud. Tap again when you are done.'
                : phase === 'recording'
                  ? 'Recording — take your time.'
                  : phase === 'typing'
                    ? canTranscribe()
                      ? 'Your voice was measured, but I could not make out the words.'
                      : 'Your voice was measured. Transcription is off, so the words are not saved unless you type them.'
                    : 'Reading your voice…'}
          </Text>

          {error && <Text style={styles.error}>{error}</Text>}

          {phase === 'typing' ? (
            <KeyboardAvoidingView
              style={styles.typingBlock}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              <TextInput
                style={styles.typedInput}
                value={typed}
                onChangeText={setTyped}
                placeholder="Type roughly what you said (optional)"
                placeholderTextColor={Ocean.textMuted}
                multiline
                autoFocus
              />
              <PrimaryButton
                title={typed.trim() ? 'Save answer' : 'Continue without words'}
                onPress={confirmTyped}
              />
            </KeyboardAvoidingView>
          ) : (
            <TouchableOpacity
              style={[
                styles.micBtn,
                phase === 'recording' && styles.micBtnActive,
                (phase === 'asking' || phase === 'processing') && styles.micBtnDisabled,
              ]}
              onPress={phase === 'recording' ? endRecording : beginRecording}
              disabled={phase === 'asking' || phase === 'processing'}
              activeOpacity={0.85}
            >
              {phase === 'processing' ? (
                <ActivityIndicator color={Ocean.bg} />
              ) : (
                <Ionicons
                  name={phase === 'recording' ? 'stop' : 'mic'}
                  size={34}
                  color={Ocean.bg}
                />
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.skip} onPress={skipVoice} disabled={phase === 'processing'}>
            <Text style={styles.skipText}>
              {turns.length > 0 || pending ? 'Finish here' : 'Skip the voice part'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.headRow}>
            <Text style={styles.stepText}>Daily check-in</Text>
            <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
              <Ionicons name="close" size={24} color={Ocean.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.title}>How is today sitting with you?</Text>

          <Scale
            label="Mood"
            value={mood}
            min={-3}
            max={3}
            endLabels={['Deeply low', 'Highly elevated']}
            color={mood > 0 ? Ocean.elevated : mood < 0 ? Ocean.low : Ocean.accent}
            onChange={setMood}
          />
          <Scale
            label="Energy"
            value={energy}
            min={0}
            max={10}
            endLabels={['Depleted', 'Wired']}
            onChange={setEnergy}
          />
          <Scale
            label="Irritability"
            value={irritability}
            min={0}
            max={10}
            endLabels={['Even', 'On edge']}
            color={Ocean.warning}
            onChange={setIrritability}
          />

          <View style={styles.sleepBlock}>
            <Text style={styles.label}>Hours slept last night</Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => setSleepHours((h) => Math.max(SLEEP_MIN, h - 0.5))}
              >
                <Ionicons name="remove" size={22} color={Ocean.accent} />
              </TouchableOpacity>
              <Text style={styles.sleepValue}>{sleepHours}h</Text>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => setSleepHours((h) => Math.min(SLEEP_MAX, h + 0.5))}
              >
                <Ionicons name="add" size={22} color={Ocean.accent} />
              </TouchableOpacity>
            </View>
          </View>

          {allSigns.length > 0 && (
            <View style={styles.signsBlock}>
              <Text style={styles.label}>Any of your signs showing up?</Text>
              <Text style={styles.hint}>These are the ones you told us about during setup.</Text>
              <View style={styles.chips}>
                {allSigns.map((s) => (
                  <Chip
                    key={s}
                    label={s}
                    selected={symptoms.includes(s)}
                    onPress={() => toggleSymptom(s)}
                  />
                ))}
              </View>
            </View>
          )}

          <Text style={styles.label}>Anything else? (optional)</Text>
          <TextInput
            style={styles.noteInput}
            value={note}
            onChangeText={setNote}
            placeholder="In your own words…"
            placeholderTextColor={Ocean.textMuted}
            multiline
          />

          {micDenied && (
            <Text style={styles.hint}>
              Microphone access is off, so this check-in will be saved without voice signals.
            </Text>
          )}
          {error && <Text style={styles.error}>{error}</Text>}

          <PrimaryButton title="Continue to voice check-in" onPress={startVoice} style={styles.primary} />
          <TouchableOpacity style={styles.skip} onPress={() => finish([])}>
            <Text style={styles.skipText}>Save without the voice part</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: Ocean.bg },
  center: { flex: 1, backgroundColor: Ocean.bg, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 40 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepText: { color: Ocean.textMuted, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  title: { color: Ocean.textPrimary, fontSize: 25, fontWeight: '700', marginTop: 14, marginBottom: 26 },
  label: { color: Ocean.textPrimary, fontSize: 15, fontWeight: '600', marginBottom: 8 },
  hint: { color: Ocean.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 12 },

  sleepBlock: { marginBottom: 24 },
  stepperRow: { flexDirection: 'row', alignItems: 'center' },
  stepperBtn: {
    width: 48,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: Ocean.surface,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sleepValue: {
    flex: 1,
    textAlign: 'center',
    color: Ocean.textPrimary,
    fontSize: 22,
    fontWeight: '700',
  },

  signsBlock: { marginBottom: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },

  noteInput: {
    backgroundColor: Ocean.surface,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    borderRadius: radius.md,
    padding: 14,
    color: Ocean.textPrimary,
    fontSize: 15,
    minHeight: 88,
    textAlignVertical: 'top',
    marginBottom: 18,
  },

  primary: { marginTop: 10 },
  skip: { alignItems: 'center', paddingVertical: 16 },
  skipText: { color: Ocean.textSecondary, fontSize: 15, fontWeight: '600' },
  error: { color: Ocean.danger, fontSize: 14, marginTop: 12, textAlign: 'center' },

  // Voice stage
  voiceStage: { flex: 1, paddingHorizontal: 26, paddingTop: 24, alignItems: 'center' },
  question: {
    color: Ocean.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 33,
    textAlign: 'center',
    marginTop: 22,
  },
  waveWrap: { marginTop: 40, marginBottom: 20 },
  phaseHint: { color: Ocean.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  micBtn: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Ocean.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 36,
  },
  micBtnActive: { backgroundColor: Ocean.danger },
  micBtnDisabled: { opacity: 0.45 },

  typingBlock: { alignSelf: 'stretch', marginTop: 24 },
  typedInput: {
    backgroundColor: Ocean.surface,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    borderRadius: radius.md,
    padding: 14,
    color: Ocean.textPrimary,
    fontSize: 15,
    minHeight: 96,
    textAlignVertical: 'top',
    marginBottom: 14,
  },

  // Done stage
  doneHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  risk: { color: Ocean.textSecondary, fontSize: 13, fontWeight: '600' },
  doneSummary: {
    color: Ocean.textPrimary,
    fontSize: 19,
    lineHeight: 27,
    fontWeight: '600',
    marginTop: 20,
  },
  discrepancy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(192,132,252,0.12)',
    borderRadius: radius.md,
    padding: 14,
    marginTop: 18,
  },
  discrepancyText: { flex: 1, color: Ocean.mixed, fontSize: 14.5, lineHeight: 21, marginLeft: 10 },
  voiceCard: {
    backgroundColor: Ocean.card,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    borderRadius: radius.md,
    padding: 16,
    marginTop: 20,
  },
  sectionLabel: {
    color: Ocean.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 22,
    marginBottom: 10,
  },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 9 },
  bullet: { width: 5, height: 5, borderRadius: 2.5, marginTop: 8, marginRight: 11 },
  bulletText: { flex: 1, color: Ocean.textSecondary, fontSize: 15, lineHeight: 22 },
  workingText: { color: Ocean.textSecondary, fontSize: 15, marginTop: 18 },
});
