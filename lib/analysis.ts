/**
 * Pure analysis logic — the parts of Anchor that decide what a day means.
 *
 * This module imports nothing. That is deliberate: it keeps the clinical-ish
 * reasoning testable outside the app (see `npm run check:analysis`), and it
 * guarantees the local fallbacks work with no Firebase, no network, and no
 * API keys. The Firestore-backed and Claude-backed modules re-export from here.
 */

export type MoodState = 'stable' | 'elevated' | 'low' | 'mixed';

/** Vocal prosody biomarkers, each normalized 0..1. */
export type VoiceScores = {
  speechRate: number; // 0 slowed speech .. 1 pressured speech
  pitchVariance: number; // 0 flat affect .. 1 highly animated
  energy: number; // 0 depleted .. 1 activated
  valence: number; // 0 negative affect .. 1 positive affect
};

export type VoiceTurn = {
  question: string;
  transcript: string;
  scores: VoiceScores;
  durationMs: number;
};

export type Analysis = {
  state: MoodState;
  /** 0..1 — likelihood that an episode is building. */
  risk: number;
  /** Set when voice biomarkers contradict the self-report. */
  discrepancy: string | null;
  summary: string;
  recommendations: string[];
  /** Tone the companion should adopt for this session. */
  tone: 'grounding' | 'activating' | 'steady';
  source: 'claude' | 'gemini' | 'groq' | 'local';
};

export type CheckIn = {
  date: string;
  /** -3 deeply low .. 0 even .. +3 highly elevated */
  mood: number;
  energy: number; // 0..10
  sleepHours: number;
  irritability: number; // 0..10
  symptoms: string[]; // drawn from the user's episode fingerprint
  note: string;
  voice: VoiceScores | null;
  turns: VoiceTurn[];
  analysis: Analysis | null;
  createdAt: number;
};

export type CheckInDraft = Omit<CheckIn, 'date' | 'createdAt'>;

/** Structural shape of the episode fingerprint, without the Firestore fields. */
export type FingerprintLike = {
  maniaSymptoms: string[];
  depressionSymptoms: string[];
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Maps a check-in to a mood state when no model analysis is available. */
export function classify(
  c: Pick<CheckIn, 'mood' | 'energy' | 'sleepHours' | 'irritability'>,
): MoodState {
  const elevated = c.mood >= 2 || (c.energy >= 8 && c.sleepHours < 6);
  const low = c.mood <= -2 || (c.energy <= 3 && c.mood < 0);
  if (elevated && (low || c.irritability >= 7)) return 'mixed';
  if (elevated) return 'elevated';
  if (low) return 'low';
  return 'stable';
}

export function averageVoice(turns: VoiceTurn[]): VoiceScores | null {
  if (turns.length === 0) return null;
  const sum = turns.reduce(
    (acc, t) => ({
      speechRate: acc.speechRate + t.scores.speechRate,
      pitchVariance: acc.pitchVariance + t.scores.pitchVariance,
      energy: acc.energy + t.scores.energy,
      valence: acc.valence + t.scores.valence,
    }),
    { speechRate: 0, pitchVariance: 0, energy: 0, valence: 0 },
  );
  const n = turns.length;
  return {
    speechRate: sum.speechRate / n,
    pitchVariance: sum.pitchVariance / n,
    energy: sum.energy / n,
    valence: sum.valence / n,
  };
}

// ---------------------------------------------------------------------------
// What they said out loud
// ---------------------------------------------------------------------------

/**
 * Phrase lists, not a model. They are deliberately literal: each entry is
 * something people actually say about their own state, so a hit means the
 * person said roughly that, not that a classifier guessed it. Everything here
 * only ever adds weight to a reading the numbers already support — a transcript
 * on its own never decides the day.
 */
const ELEVATED_PHRASES = [
  'racing',
  "can't stop",
  'cannot stop',
  "couldn't stop",
  'so much energy',
  'barely slept',
  "didn't sleep",
  'did not sleep',
  "don't need sleep",
  'no sleep',
  'wired',
  'on fire',
  'unstoppable',
  'a million ideas',
  'so many ideas',
  'best idea',
  'nonstop',
  'non-stop',
  'spending',
  'bought a',
  'everyone is slow',
  'keyed up',
];

const LOW_PHRASES = [
  'exhausted',
  "can't get out of bed",
  'cannot get out of bed',
  'pointless',
  'nothing matters',
  "what's the point",
  'whats the point',
  'heavy',
  'numb',
  'empty',
  'hopeless',
  'worthless',
  'burden',
  'no energy',
  "don't want to see anyone",
  'do not want to see anyone',
  'crying',
  'dragging',
  'slowed down',
];

/**
 * Said-out-loud crisis language. This is the one list that overrides the
 * numbers: a hit pins risk at the top and puts a human and 988 in front of
 * everything else the app would otherwise suggest.
 */
const URGENT_PHRASES = [
  'kill myself',
  'killing myself',
  'end my life',
  'end it all',
  'take my own life',
  'suicide',
  'suicidal',
  'hurt myself',
  'hurting myself',
  'harm myself',
  'not worth living',
  'better off dead',
  "don't want to be here anymore",
  'do not want to be here anymore',
];

export type TranscriptSignals = {
  /** Total words across everything they said and typed. */
  words: number;
  elevated: string[];
  low: string[];
  urgent: boolean;
};

const hits = (text: string, phrases: string[]) => phrases.filter((p) => text.includes(p));

/** Everything the person put into words today — spoken answers plus their note. */
export function spokenText(c: Pick<CheckIn, 'turns' | 'note'>): string {
  return [...c.turns.map((t) => t.transcript), c.note]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

export function transcriptSignals(text: string): TranscriptSignals {
  const lower = text.toLowerCase();
  return {
    words: lower.split(/\s+/).filter(Boolean).length,
    elevated: hits(lower, ELEVATED_PHRASES),
    low: hits(lower, LOW_PHRASES),
    urgent: hits(lower, URGENT_PHRASES).length > 0,
  };
}

export const CRISIS_RECOMMENDATION =
  'Please talk to a real person now — call or text 988 (US Suicide & Crisis Lifeline), or go to your nearest emergency room.';

// ---------------------------------------------------------------------------
// Local episode analysis (the no-API-key path)
// ---------------------------------------------------------------------------

export function localAnalysis(c: CheckIn, fp: FingerprintLike | null): Analysis {
  const state = classify(c);
  const v = c.voice;
  const reasons: string[] = [];
  let risk = 0;

  if (c.sleepHours < 5) {
    risk += 0.3;
    reasons.push(`${c.sleepHours}h of sleep`);
  } else if (c.sleepHours < 6) {
    risk += 0.15;
  }
  if (Math.abs(c.mood) >= 2) risk += 0.2;
  if (c.irritability >= 7) risk += 0.15;
  risk += Math.min(c.symptoms.length, 5) * 0.06;

  // What they said out loud, when speech-to-text produced anything.
  const said = transcriptSignals(spokenText(c));
  const leaning =
    said.elevated.length > said.low.length
      ? 'elevated'
      : said.low.length > said.elevated.length
        ? 'low'
        : null;
  if (said.elevated.length + said.low.length >= 2) {
    risk += Math.min(said.elevated.length + said.low.length, 4) * 0.05;
    reasons.push(`what you said out loud (${(leaning === 'low' ? said.low : said.elevated).slice(0, 2).join(', ')})`);
  }

  let discrepancy: string | null = null;
  if (v) {
    // The signal that matters most: a calm self-report over an activated or
    // flattened voice.
    const selfSteady = Math.abs(c.mood) <= 1;
    if (selfSteady && v.energy > 0.72 && v.speechRate > 0.68) {
      discrepancy =
        'You checked in as steady, but your voice came back faster and more activated than usual.';
      risk += 0.2;
    } else if (selfSteady && v.energy < 0.3 && v.valence < 0.4) {
      discrepancy =
        'You checked in as steady, but your voice came back flatter and lower-energy than usual.';
      risk += 0.15;
    }
  }

  // Said-versus-sounded, the other way around: the words lean hard one way
  // while the self-report sits in the middle.
  if (!discrepancy && Math.abs(c.mood) <= 1 && leaning && (leaning === 'low' ? said.low : said.elevated).length >= 2) {
    discrepancy =
      leaning === 'elevated'
        ? 'You rated today as steady, but the way you described it sounded faster and more wound up than that.'
        : 'You rated today as steady, but the way you described it sounded heavier than that.';
    risk += 0.1;
  }

  const matched = (fp?.maniaSymptoms ?? [])
    .concat(fp?.depressionSymptoms ?? [])
    .filter((s) => c.symptoms.includes(s));
  if (matched.length >= 3) {
    risk += 0.1;
    reasons.push(`${matched.length} of your own fingerprint signs`);
  }

  const tone: Analysis['tone'] =
    state === 'elevated' || state === 'mixed'
      ? 'grounding'
      : state === 'low'
        ? 'activating'
        : 'steady';

  const recommendations =
    state === 'elevated' || state === 'mixed'
      ? [
          'Protect sleep tonight — same bedtime, screens off an hour before.',
          'Hold off on any big decision or purchase for 48 hours.',
          'Tell one person you trust what today felt like.',
        ]
      : state === 'low'
        ? [
            'One small thing today: a shower, a walk outside, or a meal.',
            'Text one person — you do not have to explain anything.',
            'Keep your medication times steady even if the day slips.',
          ]
        : [
            'Keep the pattern you have — steady sleep and steady doses are doing work.',
            'Check in again tomorrow so the trend stays readable.',
          ];

  // Crisis language overrides every other reading. Nothing else the app could
  // suggest matters more than getting a real person in front of this.
  if (said.urgent) {
    return {
      state: state === 'stable' ? 'low' : state,
      risk: 1,
      discrepancy,
      summary:
        'You said something today that needs a real person, not an app. You are not a burden for saying it.',
      recommendations: [CRISIS_RECOMMENDATION, 'Tell someone you trust where you are right now.'],
      tone: 'grounding',
      source: 'local',
    };
  }

  return {
    state,
    risk: Math.max(0, Math.min(1, risk)),
    discrepancy,
    summary: reasons.length
      ? `Reading as ${state} today, mainly from ${reasons.join(' and ')}.`
      : `Reading as ${state} today.`,
    recommendations,
    tone,
    source: 'local',
  };
}

// ---------------------------------------------------------------------------
// Putting numbers into words
// ---------------------------------------------------------------------------

export type VoiceAxis = keyof VoiceScores;

const BANDS: Record<VoiceAxis, [number, string][]> = {
  // Each list is read top-down: the first threshold the value is under wins.
  speechRate: [
    [0.3, 'Slowed'],
    [0.55, 'Measured'],
    [0.75, 'Quick'],
    [1.01, 'Pressured'],
  ],
  pitchVariance: [
    [0.3, 'Flat'],
    [0.55, 'Muted'],
    [0.78, 'Expressive'],
    [1.01, 'Animated'],
  ],
  energy: [
    [0.3, 'Depleted'],
    [0.55, 'Steady'],
    [0.75, 'High'],
    [1.01, 'Activated'],
  ],
  valence: [
    [0.35, 'Negative'],
    [0.48, 'Flat'],
    [0.65, 'Neutral'],
    [1.01, 'Positive'],
  ],
};

/** The plain word for a measured axis — what the person reads, not the number. */
export function describeMeasure(axis: VoiceAxis, value: number): string {
  const v = Math.max(0, Math.min(1, value));
  for (const [ceiling, word] of BANDS[axis]) if (v < ceiling) return word;
  return BANDS[axis][BANDS[axis].length - 1][1];
}

export type RiskBand = 'low' | 'medium' | 'high';

export function riskBand(risk: number): RiskBand {
  if (risk >= 0.66) return 'high';
  if (risk >= 0.33) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Prodrome streak detection
// ---------------------------------------------------------------------------

export const STREAK_THRESHOLD = 3;

export type ProdromeDirection = 'elevated' | 'low' | 'mixed';

export type Streak = {
  direction: ProdromeDirection;
  days: CheckIn[];
};

const stateOf = (c: CheckIn): MoodState => c.analysis?.state ?? classify(c);

/**
 * The run of consecutive most-recent check-ins that lean the same non-stable
 * direction. Mixed days are absorbed into an adjacent elevated or low run,
 * since a mixed presentation is still the same episode building; a genuine
 * polarity flip (elevated straight to low) ends the run.
 */
export function detectStreak(history: CheckIn[]): Streak | null {
  if (history.length === 0) return null;
  const ordered = [...history].sort((a, b) => a.date.localeCompare(b.date));

  const run: CheckIn[] = [];
  let direction: ProdromeDirection | null = null;

  for (let i = ordered.length - 1; i >= 0; i--) {
    const c = ordered[i];
    const state = stateOf(c);
    if (state === 'stable') break;

    if (direction === null) {
      direction = state as ProdromeDirection;
    } else if (state !== direction && state !== 'mixed' && direction !== 'mixed') {
      break;
    } else if (direction === 'mixed' && state !== 'mixed') {
      direction = state as ProdromeDirection;
    }
    run.unshift(c);
  }

  if (!direction || run.length < STREAK_THRESHOLD) return null;
  return { direction, days: run };
}
