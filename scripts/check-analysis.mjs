/**
 * Sanity checks for Anchor's analysis logic.
 *
 * Runs against `lib/analysis.ts` only, which has no imports — so this executes
 * in plain Node with no Firebase, no Expo runtime, no network and no API keys.
 * It guards the behaviour the app falls back to when Claude is unavailable,
 * which is exactly the path least likely to be exercised by hand.
 *
 *   npm run check:analysis
 */
import {
  averageVoice,
  classify,
  CRISIS_RECOMMENDATION,
  detectStreak,
  localAnalysis,
  describeMeasure,
  riskBand,
  spokenText,
  STREAK_THRESHOLD,
  transcriptSignals,
} from '../lib/analysis.ts';

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failures.push(`${name}\n    ${e.message}`);
  }
}

function eq(actual, expected, what = 'value') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
}

function ok(cond, message) {
  if (!cond) throw new Error(message);
}

const voice = (over = {}) => ({
  speechRate: 0.5,
  pitchVariance: 0.5,
  energy: 0.5,
  valence: 0.5,
  ...over,
});

let dayCounter = 0;
const day = (over = {}) => {
  dayCounter += 1;
  return {
    date: `2026-03-${String(dayCounter).padStart(2, '0')}`,
    mood: 0,
    energy: 5,
    sleepHours: 7.5,
    irritability: 2,
    symptoms: [],
    note: '',
    voice: null,
    turns: [],
    analysis: null,
    createdAt: 0,
    ...over,
  };
};

// --- classify ---------------------------------------------------------------

check('classify: an ordinary day is stable', () => {
  eq(classify({ mood: 0, energy: 5, sleepHours: 7.5, irritability: 2 }), 'stable');
});

check('classify: high mood reads elevated', () => {
  eq(classify({ mood: 2, energy: 7, sleepHours: 7, irritability: 2 }), 'elevated');
});

check('classify: high energy on little sleep reads elevated even at neutral mood', () => {
  eq(classify({ mood: 0, energy: 9, sleepHours: 4, irritability: 1 }), 'elevated');
});

check('classify: low mood reads low', () => {
  eq(classify({ mood: -2, energy: 3, sleepHours: 9, irritability: 1 }), 'low');
});

check('classify: elevated plus irritability reads mixed', () => {
  eq(classify({ mood: 2, energy: 8, sleepHours: 5, irritability: 8 }), 'mixed');
});

// --- averageVoice -----------------------------------------------------------

check('averageVoice: no turns yields null', () => {
  eq(averageVoice([]), null);
});

check('averageVoice: averages each axis across turns', () => {
  const turns = [
    { question: 'q', transcript: '', durationMs: 1000, scores: voice({ energy: 0.2, valence: 1 }) },
    { question: 'q', transcript: '', durationMs: 1000, scores: voice({ energy: 0.8, valence: 0 }) },
  ];
  const avg = averageVoice(turns);
  eq(avg.energy, 0.5, 'energy');
  eq(avg.valence, 0.5, 'valence');
  eq(avg.speechRate, 0.5, 'speechRate');
});

// --- localAnalysis ----------------------------------------------------------

check('localAnalysis: a steady day carries low risk and a steady tone', () => {
  const a = localAnalysis(day(), null);
  eq(a.state, 'stable', 'state');
  eq(a.tone, 'steady', 'tone');
  ok(a.risk < 0.2, `expected low risk, got ${a.risk}`);
  eq(a.discrepancy, null, 'discrepancy');
  eq(a.source, 'local', 'source');
});

check('localAnalysis: severe sleep loss raises risk', () => {
  const rested = localAnalysis(day({ sleepHours: 8 }), null);
  const sleepless = localAnalysis(day({ sleepHours: 3 }), null);
  ok(
    sleepless.risk > rested.risk + 0.25,
    `expected sleep loss to raise risk materially (${rested.risk} -> ${sleepless.risk})`,
  );
});

check('localAnalysis: calm self-report over an activated voice flags a discrepancy', () => {
  const a = localAnalysis(
    day({ mood: 0, voice: voice({ energy: 0.85, speechRate: 0.8 }) }),
    null,
  );
  ok(a.discrepancy !== null, 'expected a discrepancy to be surfaced');
  ok(/faster|activated/.test(a.discrepancy), `unexpected wording: ${a.discrepancy}`);
});

check('localAnalysis: calm self-report over a flattened voice flags a discrepancy', () => {
  const a = localAnalysis(day({ mood: 0, voice: voice({ energy: 0.2, valence: 0.25 }) }), null);
  ok(a.discrepancy !== null, 'expected a discrepancy to be surfaced');
  ok(/flatter|lower-energy/.test(a.discrepancy), `unexpected wording: ${a.discrepancy}`);
});

check('localAnalysis: a self-reported elevated day does not double-count as a discrepancy', () => {
  // They already said they are elevated — the voice agreeing is not a gap.
  const a = localAnalysis(day({ mood: 3, voice: voice({ energy: 0.9, speechRate: 0.9 }) }), null);
  eq(a.discrepancy, null, 'discrepancy');
});

check('localAnalysis: elevated days get a grounding tone, low days an activating one', () => {
  eq(localAnalysis(day({ mood: 3 }), null).tone, 'grounding', 'elevated tone');
  eq(localAnalysis(day({ mood: -3 }), null).tone, 'activating', 'low tone');
});

check('localAnalysis: matching the user fingerprint raises risk', () => {
  const fp = {
    maniaSymptoms: ['Racing thoughts', 'Overspending', 'Low sleep'],
    depressionSymptoms: ['Fatigue'],
  };
  const base = localAnalysis(day({ symptoms: [] }), fp);
  const matched = localAnalysis(
    day({ symptoms: ['Racing thoughts', 'Overspending', 'Low sleep'] }),
    fp,
  );
  ok(matched.risk > base.risk, `expected fingerprint matches to raise risk`);
  ok(/fingerprint/.test(matched.summary), `expected the summary to cite the fingerprint`);
});

check('localAnalysis: risk never leaves 0..1', () => {
  const worst = localAnalysis(
    day({
      mood: 3,
      energy: 10,
      sleepHours: 0,
      irritability: 10,
      symptoms: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      voice: voice({ energy: 0.99, speechRate: 0.99 }),
    }),
    { maniaSymptoms: ['a', 'b', 'c'], depressionSymptoms: [] },
  );
  ok(worst.risk >= 0 && worst.risk <= 1, `risk out of range: ${worst.risk}`);
});

check('localAnalysis: always returns at least one recommendation', () => {
  for (const mood of [-3, -1, 0, 1, 3]) {
    const a = localAnalysis(day({ mood }), null);
    ok(a.recommendations.length > 0, `no recommendations at mood ${mood}`);
  }
});

// --- transcript signals -----------------------------------------------------

const turn = (transcript) => ({
  question: 'How has today been?',
  transcript,
  scores: { speechRate: 0.5, pitchVariance: 0.5, energy: 0.5, valence: 0.5 },
  durationMs: 8000,
});

check('transcriptSignals: an empty transcript produces no signals', () => {
  const s = transcriptSignals('');
  eq(s.words, 0, 'words');
  eq(s.elevated, [], 'elevated');
  eq(s.low, [], 'low');
  eq(s.urgent, false, 'urgent');
});

check('transcriptSignals: phrase matching ignores case', () => {
  const s = transcriptSignals('My thoughts are RACING and I barely slept');
  ok(s.elevated.includes('racing'), 'racing not matched');
  ok(s.elevated.includes('barely slept'), 'barely slept not matched');
});

check('transcriptSignals: elevated and low lexicons do not bleed into each other', () => {
  eq(transcriptSignals('everything feels heavy and pointless').elevated, [], 'elevated');
  eq(transcriptSignals('so much energy, cannot stop').low, [], 'low');
});

check('transcriptSignals: crisis language is flagged', () => {
  ok(transcriptSignals('I keep thinking about killing myself').urgent, 'missed crisis phrase');
  ok(!transcriptSignals('I am tired of this week').urgent, 'false positive');
});

check('spokenText: joins every answer and the typed note', () => {
  const text = spokenText({ turns: [turn('slept badly'), turn('')], note: 'and wired all day' });
  eq(text, 'slept badly and wired all day', 'text');
});

check('localAnalysis: what they said out loud raises risk', () => {
  const quiet = localAnalysis(day(), null);
  const spoken = localAnalysis(
    day({ turns: [turn('my thoughts are racing and I barely slept, so much energy')] }),
    null,
  );
  ok(spoken.risk > quiet.risk, `expected a higher risk, got ${spoken.risk} vs ${quiet.risk}`);
});

check('localAnalysis: steady self-report over elevated words flags a discrepancy', () => {
  const a = localAnalysis(
    day({ mood: 0, turns: [turn('thoughts racing, I have a million ideas, barely slept')] }),
    null,
  );
  ok(a.discrepancy !== null, 'expected a discrepancy');
});

check('localAnalysis: measured voice discrepancy wins over the transcript one', () => {
  const a = localAnalysis(
    day({
      mood: 0,
      voice: voice({ energy: 0.9, speechRate: 0.9 }),
      turns: [turn('everything feels heavy and pointless')],
    }),
    null,
  );
  ok(a.discrepancy.includes('your voice'), `expected the voice wording, got: ${a.discrepancy}`);
});

check('localAnalysis: crisis language pins risk and leads with 988', () => {
  const a = localAnalysis(day({ mood: 0, turns: [turn('I want to end my life')] }), null);
  eq(a.risk, 1, 'risk');
  eq(a.recommendations[0], CRISIS_RECOMMENDATION, 'first recommendation');
  eq(a.tone, 'grounding', 'tone');
  ok(a.state !== 'stable', 'crisis language should not read as stable');
});

check('localAnalysis: a single ordinary phrase does not move the reading', () => {
  const quiet = localAnalysis(day(), null);
  const one = localAnalysis(day({ turns: [turn('work was heavy today')] }), null);
  eq(one.risk, quiet.risk, 'risk');
  eq(one.discrepancy, null, 'discrepancy');
});

// --- putting numbers into words ---------------------------------------------

check('describeMeasure: speech rate reads from slowed to pressured', () => {
  eq(describeMeasure('speechRate', 0), 'Slowed', 'floor');
  eq(describeMeasure('speechRate', 0.5), 'Measured', 'middle');
  eq(describeMeasure('speechRate', 0.95), 'Pressured', 'ceiling');
});

check('describeMeasure: every axis is covered across the whole 0..1 range', () => {
  for (const axis of ['speechRate', 'pitchVariance', 'energy', 'valence']) {
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const word = describeMeasure(axis, v);
      ok(typeof word === 'string' && word.length > 0, `${axis} at ${v.toFixed(2)} had no word`);
    }
  }
});

check('describeMeasure: values outside 0..1 are clamped, not dropped', () => {
  eq(describeMeasure('energy', -5), describeMeasure('energy', 0), 'below floor');
  eq(describeMeasure('energy', 5), describeMeasure('energy', 1), 'above ceiling');
});

check('riskBand: bands split low / medium / high', () => {
  eq(riskBand(0), 'low', '0');
  eq(riskBand(0.32), 'low', 'just under medium');
  eq(riskBand(0.33), 'medium', 'medium floor');
  eq(riskBand(0.65), 'medium', 'just under high');
  eq(riskBand(0.66), 'high', 'high floor');
  eq(riskBand(1), 'high', '1');
});

// --- detectStreak -----------------------------------------------------------

check('detectStreak: no history yields no streak', () => {
  eq(detectStreak([]), null);
});

check('detectStreak: a run shorter than the threshold does not fire', () => {
  const days = Array.from({ length: STREAK_THRESHOLD - 1 }, () => day({ mood: 3 }));
  eq(detectStreak(days), null);
});

check('detectStreak: a run at the threshold fires', () => {
  const days = Array.from({ length: STREAK_THRESHOLD }, () => day({ mood: 3 }));
  const s = detectStreak(days);
  ok(s !== null, 'expected a streak');
  eq(s.direction, 'elevated', 'direction');
  eq(s.days.length, STREAK_THRESHOLD, 'length');
});

check('detectStreak: a stable day breaks the run', () => {
  const days = [day({ mood: 3 }), day({ mood: 0 }), day({ mood: 3 }), day({ mood: 3 })];
  eq(detectStreak(days), null);
});

check('detectStreak: only the most recent run counts', () => {
  const days = [
    day({ mood: -3 }),
    day({ mood: -3 }),
    day({ mood: -3 }),
    day({ mood: 0 }), // breaks it
    day({ mood: 3 }),
    day({ mood: 3 }),
  ];
  eq(detectStreak(days), null, 'a 2-day run after a break should not fire');
});

check('detectStreak: a polarity flip ends the run', () => {
  const days = [day({ mood: 3 }), day({ mood: 3 }), day({ mood: -3 }), day({ mood: -3 })];
  eq(detectStreak(days), null);
});

check('detectStreak: mixed days extend an adjacent run', () => {
  const days = [
    day({ mood: 3 }),
    day({ mood: 3, energy: 9, sleepHours: 4, irritability: 9 }), // mixed
    day({ mood: 3 }),
  ];
  const s = detectStreak(days);
  ok(s !== null, 'expected a streak across the mixed day');
  eq(s.days.length, 3, 'length');
});

check('detectStreak: a stored model verdict overrides the heuristic', () => {
  const elevated = { state: 'elevated', risk: 0.6, discrepancy: null, summary: '', recommendations: [], tone: 'grounding', source: 'claude' };
  const days = Array.from({ length: STREAK_THRESHOLD }, () => day({ mood: 0, analysis: elevated }));
  const s = detectStreak(days);
  ok(s !== null, 'expected the stored analysis to drive the streak');
  eq(s.direction, 'elevated', 'direction');
});

check('detectStreak: history order does not matter', () => {
  const days = Array.from({ length: STREAK_THRESHOLD + 1 }, () => day({ mood: -3 }));
  const forward = detectStreak(days);
  const shuffled = detectStreak([...days].reverse());
  eq(shuffled.days.length, forward.days.length, 'length');
  eq(shuffled.direction, forward.direction, 'direction');
});

// --- report -----------------------------------------------------------------

const total = passed + failures.length;
if (failures.length > 0) {
  console.error(`\n  ${failures.length} of ${total} checks FAILED\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`\n  ${passed}/${total} analysis checks passed\n`);
