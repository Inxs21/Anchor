import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  StatusBar,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRef, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { Audio } from 'expo-av';
import { useAuth } from '@/lib/auth';
import { Ocean } from '@/constants/theme';
import { todayStr } from '@/lib/medications';
import {
  speakText,
  startRecording,
  stopRecording,
  requestMicPermission,
  analyzeWithHume,
  analyzeCheckin,
  saveCheckin,
  type HumeResult,
  type CheckinResult,
} from '@/lib/voice';
import { getEpisodeFingerprint } from '@/lib/checkins';
import type { EpisodeFingerprint } from '@/lib/checkins';

// ─── Questions ────────────────────────────────────────────────────────────────

const QUESTIONS = [
  'How has your energy felt today?',
  'How would you describe your mood right now?',
  'How well did you sleep last night?',
  'Have you noticed any shifts in your thoughts or feelings?',
];

type Phase = 'init' | 'speaking' | 'recording' | 'analyzing' | 'results';

// ─── Bowtie Waveform ──────────────────────────────────────────────────────────

const BAR_COUNT   = 28;
const BASE_HEIGHTS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const dist = Math.abs(i - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2);
  return 6 + dist * 32;
});
const BAR_CFGS = BASE_HEIGHTS.map((base, i) => ({
  base, amp: 4 + (i % 4) * 2,
  dur1: 500 + (i * 71) % 600, dur2: 450 + (i * 53) % 550,
}));

function BowtiWaveform({ active }: { active: boolean }) {
  const anims    = useRef(BAR_CFGS.map(() => new Animated.Value(0))).current;
  const loopsRef = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    loopsRef.current.forEach((l) => l.stop());
    if (active) {
      loopsRef.current = anims.map((anim, i) => {
        const c = BAR_CFGS[i];
        const loop = Animated.loop(
          Animated.sequence([
            Animated.timing(anim, { toValue: 1, duration: c.dur1, useNativeDriver: false }),
            Animated.timing(anim, { toValue: 0, duration: c.dur2, useNativeDriver: false }),
          ])
        );
        setTimeout(() => loop.start(), i * 30);
        return loop;
      });
    } else {
      anims.forEach((a) => a.setValue(0));
    }
    return () => loopsRef.current.forEach((l) => l.stop());
  }, [active]);

  return (
    <View style={wv.container}>
      {anims.map((anim, i) => {
        const c      = BAR_CFGS[i];
        const height = anim.interpolate({ inputRange: [0, 1], outputRange: [c.base, c.base + c.amp] });
        return <Animated.View key={i} style={[wv.bar, { height, opacity: active ? 0.85 : 0.35 }]} />;
      })}
    </View>
  );
}
const wv = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 60 },
  bar: { width: 4, borderRadius: 3, backgroundColor: Ocean.accent },
});

// ─── Listening dots ───────────────────────────────────────────────────────────

function ListeningDots() {
  const dots = [
    useRef(new Animated.Value(0.3)).current,
    useRef(new Animated.Value(0.3)).current,
    useRef(new Animated.Value(0.3)).current,
  ];
  useEffect(() => {
    const anims = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 180),
          Animated.timing(d, { toValue: 1,   duration: 350, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.3, duration: 350, useNativeDriver: true }),
        ])
      )
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []);
  return (
    <View style={ld.row}>
      {dots.map((d, i) => <Animated.View key={i} style={[ld.dot, { opacity: d }]} />)}
    </View>
  );
}
const ld = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, marginTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Ocean.accent },
});

// ─── Score Bar ────────────────────────────────────────────────────────────────

function ScoreBar({ label, value, min = 0, max = 1, color = Ocean.accent }: {
  label: string; value: number; min?: number; max?: number; color?: string;
}) {
  const pct   = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const widthA = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(widthA, { toValue: pct, duration: 700, useNativeDriver: false }).start();
  }, [pct]);

  return (
    <View style={sb.row}>
      <Text style={sb.label}>{label}</Text>
      <View style={sb.track}>
        <Animated.View style={[sb.fill, { width: widthA.interpolate({ inputRange: [0,1], outputRange: ['0%','100%'] }), backgroundColor: color }]} />
      </View>
      <Text style={sb.value}>{value.toFixed(2)}</Text>
    </View>
  );
}
const sb = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  label: { width: 64, fontSize: 12, fontWeight: '600', color: Ocean.textSecondary },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Ocean.surface, overflow: 'hidden' },
  fill:  { height: 6, borderRadius: 3 },
  value: { width: 38, fontSize: 12, color: Ocean.textMuted, textAlign: 'right' },
});

// ─── Results Panel ────────────────────────────────────────────────────────────

function ResultsPanel({
  hume, result, questions, transcripts, durations, onDone,
}: {
  hume:        HumeResult;
  result:      CheckinResult;
  questions:   string[];
  transcripts: string[];
  durations:   number[];
  onDone:      () => void;
}) {
  const stateColor =
    result.todayState === 'elevated' ? Ocean.warning :
    result.todayState === 'low'      ? '#7B8FD4'    :
    result.todayState === 'mixed'    ? Ocean.danger  : Ocean.accent;

  const riskColor =
    result.riskLevel === 'high'   ? Ocean.danger  :
    result.riskLevel === 'medium' ? Ocean.warning : Ocean.success;

  const { bipolarIndices, speechOrganization, contentThemes } = result;
  const { speechRate, prosody } = hume;

  return (
    <ScrollView
      style={rp.scroll}
      contentContainerStyle={rp.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={rp.header}>
        <View style={[rp.stateBadge, { backgroundColor: stateColor + '22', borderColor: stateColor }]}>
          <Text style={[rp.stateText, { color: stateColor }]}>
            {result.todayState.toUpperCase()}
          </Text>
        </View>
        <Text style={rp.insight}>{result.insight}</Text>
      </View>

      {/* Bipolar Indices */}
      <View style={rp.card}>
        <Text style={rp.cardTitle}>Bipolar State Indices</Text>
        <ScoreBar label="Manic"      value={bipolarIndices.manicIndex}      color={Ocean.warning} />
        <ScoreBar label="Depressive"  value={bipolarIndices.depressiveIndex} color="#7B8FD4" />
        {bipolarIndices.mixedStateFlag && (
          <View style={rp.flagRow}>
            <View style={rp.flagDot} />
            <Text style={rp.flagText}>Mixed state detected — agitation with depressive content</Text>
          </View>
        )}
      </View>

      {/* Speech Rate Metrics */}
      <View style={rp.card}>
        <Text style={rp.cardTitle}>Speech Rate</Text>
        <View style={rp.metricRow}>
          <Text style={rp.metricLabel}>Words/min</Text>
          <Text style={[rp.metricValue, {
            color: speechRate.wordsPerMinute > 180 ? Ocean.warning :
                   speechRate.wordsPerMinute < 80  ? '#7B8FD4' : Ocean.textSecondary
          }]}>{speechRate.wordsPerMinute.toFixed(0)} wpm</Text>
        </View>
        <View style={rp.metricRow}>
          <Text style={rp.metricLabel}>Total words</Text>
          <Text style={rp.metricValue}>{speechRate.totalWordCount}</Text>
        </View>
        <View style={rp.metricRow}>
          <Text style={rp.metricLabel}>Avg response</Text>
          <Text style={rp.metricValue}>{speechRate.avgResponseLength.toFixed(1)} words</Text>
        </View>
        <View style={rp.metricRow}>
          <Text style={rp.metricLabel}>Avg latency</Text>
          <Text style={rp.metricValue}>{speechRate.avgResponseLatency.toFixed(1)}s</Text>
        </View>
        <View style={rp.metricRow}>
          <Text style={rp.metricLabel}>Brief responses</Text>
          <Text style={[rp.metricValue, {
            color: speechRate.shortResponseRatio > 0.5 ? '#7B8FD4' : Ocean.textSecondary
          }]}>{(speechRate.shortResponseRatio * 100).toFixed(0)}%</Text>
        </View>
      </View>

      {/* Prosody */}
      <View style={rp.card}>
        <Text style={rp.cardTitle}>Vocal Prosody</Text>
        <ScoreBar label="Energy"  value={hume.scores.energy}  color={Ocean.accent} />
        <ScoreBar
          label="Valence"
          value={hume.scores.valence}
          min={-1} max={1}
          color={hume.scores.valence >= 0 ? Ocean.success : Ocean.danger}
        />
        <ScoreBar label="Arousal" value={hume.scores.arousal} color={Ocean.warning} />
        <ScoreBar label="Emot. Range" value={prosody.emotionalRange} color={Ocean.accent} />
        <ScoreBar label="Emot. Var."  value={prosody.emotionVariance} color={Ocean.accent} />
        <ScoreBar
          label="Polarity"
          value={prosody.dominantValencePolarity}
          min={-1} max={1}
          color={prosody.dominantValencePolarity >= 0 ? Ocean.success : Ocean.danger}
        />

        {hume.topEmotions.length > 0 && (
          <>
            <Text style={[rp.cardTitle, { marginTop: 14 }]}>Top Emotions</Text>
            <View style={rp.emotionRow}>
              {hume.topEmotions.map((e) => (
                <View key={e.name} style={rp.emotionChip}>
                  <Text style={rp.emotionName}>{e.name}</Text>
                  <Text style={rp.emotionScore}>{(e.score * 100).toFixed(0)}%</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </View>

      {/* Speech Organization */}
      <View style={rp.card}>
        <Text style={rp.cardTitle}>Speech Organization</Text>
        <ScoreBar label="Coherence"  value={speechOrganization.topicCoherence}  min={0} max={10} color={Ocean.accent} />
        <View style={rp.metricRow}>
          <Text style={rp.metricLabel}>Topic shifts</Text>
          <Text style={[rp.metricValue, {
            color: speechOrganization.topicShiftCount > 3 ? Ocean.warning : Ocean.textSecondary
          }]}>{speechOrganization.topicShiftCount}</Text>
        </View>
        <ScoreBar label="Rumination" value={speechOrganization.ruminationScore} min={0} max={10} color="#7B8FD4" />
      </View>

      {/* Content Themes */}
      <View style={rp.card}>
        <Text style={rp.cardTitle}>Content Themes</Text>
        <ScoreBar label="Grandiosity"  value={contentThemes.grandiosity}   min={0} max={10} color={Ocean.warning} />
        <ScoreBar label="Hopelessness" value={contentThemes.hopelessness}  min={0} max={10} color="#7B8FD4" />
        <ScoreBar label="Self-crit."   value={contentThemes.selfCriticism} min={0} max={10} color="#7B8FD4" />
        <ScoreBar label="Anhedonia"    value={contentThemes.anhedonia}     min={0} max={10} color="#7B8FD4" />
        {contentThemes.racingThoughts && (
          <View style={rp.flagRow}>
            <View style={[rp.flagDot, { backgroundColor: Ocean.warning }]} />
            <Text style={rp.flagText}>Racing thoughts detected</Text>
          </View>
        )}
      </View>

      {/* Risk level */}
      <View style={rp.card}>
        <Text style={rp.cardTitle}>Assessment</Text>
        <View style={rp.assessRow}>
          <Text style={rp.assessLabel}>Risk level</Text>
          <View style={[rp.riskBadge, { backgroundColor: riskColor + '22', borderColor: riskColor }]}>
            <Text style={[rp.riskText, { color: riskColor }]}>{result.riskLevel.toUpperCase()}</Text>
          </View>
        </View>
        {result.flagged && (
          <View style={rp.flagRow}>
            <View style={rp.flagDot} />
            <Text style={rp.flagText}>Pattern flagged — consider reaching out to your care team</Text>
          </View>
        )}
      </View>

      {/* Transcripts */}
      <View style={rp.card}>
        <Text style={rp.cardTitle}>Transcripts</Text>
        {questions.map((q, i) => (
          <View key={i} style={rp.transcriptRow}>
            <Text style={rp.transcriptQ}>{q}</Text>
            <Text style={rp.transcriptA}>
              {transcripts[i] && transcripts[i].trim()
                ? `"${transcripts[i]}"`
                : `(${durations[i]?.toFixed(1) ?? '?'}s recorded — no transcript)`}
            </Text>
          </View>
        ))}
      </View>

      <TouchableOpacity style={rp.doneBtn} onPress={onDone} activeOpacity={0.85}>
        <Text style={rp.doneBtnText}>Continue to Home</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const rp = StyleSheet.create({
  scroll:  { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },

  header:    { alignItems: 'center', paddingVertical: 28, gap: 10 },
  stateBadge: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  stateText:  { fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  insight:    { fontSize: 16, fontWeight: '600', color: Ocean.textPrimary, textAlign: 'center' },

  card:      { backgroundColor: Ocean.card, borderRadius: 16, borderWidth: 1, borderColor: Ocean.cardBorder, padding: 16, marginBottom: 14 },
  cardTitle: { fontSize: 11, fontWeight: '700', color: Ocean.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },

  emotionRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emotionChip:  { backgroundColor: Ocean.surface, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: Ocean.cardBorder },
  emotionName:  { fontSize: 12, color: Ocean.textSecondary, fontWeight: '600' },
  emotionScore: { fontSize: 11, color: Ocean.accent, fontWeight: '700', textAlign: 'center' },

  assessRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  assessLabel:{ fontSize: 14, color: Ocean.textSecondary },
  riskBadge:  { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 14, borderWidth: 1 },
  riskText:   { fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  flagRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 },
  flagDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: Ocean.danger, marginTop: 4 },
  flagText:   { flex: 1, fontSize: 13, color: Ocean.textSecondary },

  metricRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  metricLabel: { fontSize: 13, color: Ocean.textSecondary },
  metricValue: { fontSize: 13, fontWeight: '700', color: Ocean.textSecondary },

  transcriptRow: { marginBottom: 14 },
  transcriptQ:   { fontSize: 12, fontWeight: '600', color: Ocean.textMuted, marginBottom: 4 },
  transcriptA:   { fontSize: 14, color: Ocean.textPrimary, lineHeight: 20 },

  doneBtn:     { backgroundColor: Ocean.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  doneBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TalkScreen() {
  const { user } = useAuth();
  const router   = useRouter();
  const uid      = user?.uid ?? '';
  const today    = todayStr();

  const [step,       setStep]      = useState(0);
  const [phase,      setPhase]     = useState<Phase>('init');
  const [statusMsg,  setStatusMsg] = useState('');
  const [error,      setError]     = useState('');
  const [humeResult, setHumeResult]  = useState<HumeResult | null>(null);
  const [checkinRes, setCheckinRes]  = useState<CheckinResult | null>(null);

  const recordingRef    = useRef<Audio.Recording | null>(null);
  const audioUrisRef    = useRef<string[]>([]);
  const durationsRef    = useRef<number[]>([]);
  const startTimeRef    = useRef<number>(0);
  const fingerprintRef  = useRef<EpisodeFingerprint | null>(null);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const questionAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: (step + 1) / QUESTIONS.length,
      duration: 350, useNativeDriver: false,
    }).start();
  }, [step]);

  useEffect(() => {
    (async () => {
      const [granted, fp] = await Promise.all([
        requestMicPermission(),
        getEpisodeFingerprint(uid),
      ]);
      fingerprintRef.current = fp;
      if (!granted) { setError('Microphone permission is required.'); return; }
      await runQuestion(0);
    })();
  }, []);

  const runQuestion = useCallback(async (idx: number) => {
    setPhase('speaking');
    setStatusMsg('');
    try { await speakText(QUESTIONS[idx]); } catch {}
    try {
      recordingRef.current = await startRecording();
      startTimeRef.current = Date.now();
      setPhase('recording');
    } catch {
      setError('Could not start recording. Check microphone permissions.');
    }
  }, []);

  async function handleNext() {
    if (phase !== 'recording') return;

    const duration = (Date.now() - startTimeRef.current) / 1000;
    durationsRef.current.push(duration);

    let uri: string | null = null;
    if (recordingRef.current) {
      uri = await stopRecording(recordingRef.current);
      recordingRef.current = null;
    }
    if (uri) audioUrisRef.current.push(uri);

    if (step < QUESTIONS.length - 1) {
      Animated.timing(questionAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(async () => {
        const next = step + 1;
        setStep(next);
        Animated.timing(questionAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
        await runQuestion(next);
      });
    } else {
      setPhase('analyzing');

      setStatusMsg('Analyzing voice prosody...');
      const hume = await analyzeWithHume(audioUrisRef.current, durationsRef.current);
      setHumeResult(hume);

      setStatusMsg('Running Claude analysis...');
      const result = await analyzeCheckin(QUESTIONS, durationsRef.current, hume, fingerprintRef.current);
      setCheckinRes(result);

      setStatusMsg('Saving to Firebase...');
      try { await saveCheckin(uid, today, hume, result, QUESTIONS, durationsRef.current); } catch (e) { console.warn('Save failed:', e); }

      setPhase('results');
    }
  }

  function handleClose() {
    recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    router.replace('/');
  }

  const isRecording = phase === 'recording';
  const isAnalyzing = phase === 'analyzing';
  const btnDisabled = phase !== 'recording';
  const isLastQ     = step === QUESTIONS.length - 1;

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1], outputRange: ['0%', '100%'],
  });

  if (error) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.errorBtn} onPress={() => router.replace('/')}>
            <Text style={styles.errorBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Results view ──────────────────────────────────────────────────────────

  if (phase === 'results' && humeResult && checkinRes) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={Ocean.bg} />
        <View style={styles.resultsHeader}>
          <Text style={styles.resultsTitle}>Check-in Analysis</Text>
          <TouchableOpacity onPress={handleClose} hitSlop={12}>
            <View style={styles.closeBtn}>
              <View style={[styles.closeLine, { transform: [{ rotate: '45deg' }] }]} />
              <View style={[styles.closeLine, { transform: [{ rotate: '-45deg' }] }]} />
            </View>
          </TouchableOpacity>
        </View>
        <ResultsPanel
          hume={humeResult}
          result={checkinRes}
          questions={QUESTIONS}
          transcripts={humeResult.transcripts}
          durations={durationsRef.current}
          onDone={() => router.replace('/')}
        />
      </SafeAreaView>
    );
  }

  // ── Check-in view ─────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Ocean.bg} />

      <View style={styles.topBar}>
        <Text style={styles.stepText}>{step + 1} of {QUESTIONS.length}</Text>
        <TouchableOpacity onPress={handleClose} hitSlop={12}>
          <View style={styles.closeBtn}>
            <View style={[styles.closeLine, { transform: [{ rotate: '45deg' }] }]} />
            <View style={[styles.closeLine, { transform: [{ rotate: '-45deg' }] }]} />
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
      </View>

      <View style={styles.waveWrap}>
        <BowtiWaveform active={isRecording} />
      </View>

      <Animated.View style={[styles.questionWrap, { opacity: questionAnim }]}>
        <Text style={styles.questionText}>{QUESTIONS[step]}</Text>
        {isRecording && <ListeningDots />}
        <Text style={styles.phaseLabel}>
          {phase === 'speaking'  ? 'Speaking...' :
           phase === 'recording' ? 'Listening'   : ''}
        </Text>
      </Animated.View>

      {isAnalyzing ? (
        <View style={styles.footer}>
          <ActivityIndicator color={Ocean.accent} size="large" />
          <Text style={styles.analyzingText}>{statusMsg}</Text>
        </View>
      ) : (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.nextBtn, btnDisabled && styles.nextBtnDisabled]}
            onPress={handleNext}
            disabled={btnDisabled}
            activeOpacity={0.8}
          >
            <Text style={[styles.nextBtnText, btnDisabled && { opacity: 0.4 }]}>
              {isLastQ ? 'Done' : 'Next'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Ocean.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32 },

  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16,
  },
  stepText: { fontSize: 14, fontWeight: '600', color: Ocean.textSecondary },
  closeBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  closeLine: { position: 'absolute', width: 18, height: 2, borderRadius: 1, backgroundColor: Ocean.textSecondary },

  progressTrack: { height: 3, backgroundColor: Ocean.surface, marginHorizontal: 24, borderRadius: 2 },
  progressFill:  { height: 3, backgroundColor: Ocean.accent, borderRadius: 2 },

  waveWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },

  questionWrap: { paddingHorizontal: 32, alignItems: 'center', marginBottom: 40 },
  questionText: { fontSize: 22, fontWeight: '700', color: Ocean.textPrimary, textAlign: 'center', lineHeight: 32 },
  phaseLabel:   { fontSize: 14, color: Ocean.accent, fontWeight: '600', marginTop: 12 },

  footer:          { paddingHorizontal: 24, paddingBottom: 32, alignItems: 'center', gap: 14 },
  nextBtn:         { backgroundColor: Ocean.surface, borderRadius: 32, paddingVertical: 16, paddingHorizontal: 56, borderWidth: 1, borderColor: Ocean.cardBorder },
  nextBtnDisabled: { borderColor: Ocean.surface },
  nextBtnText:     { fontSize: 17, fontWeight: '700', color: Ocean.textPrimary },
  analyzingText:   { fontSize: 14, color: Ocean.textSecondary, marginTop: 12 },

  resultsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  resultsTitle:  { fontSize: 20, fontWeight: '700', color: Ocean.textPrimary },

  errorText:    { fontSize: 16, color: Ocean.danger, textAlign: 'center' },
  errorBtn:     { backgroundColor: Ocean.card, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  errorBtnText: { color: Ocean.textPrimary, fontWeight: '600' },
});
