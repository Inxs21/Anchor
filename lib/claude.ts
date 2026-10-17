import { ANTHROPIC_API_KEY, hasClaude } from './env';
import { localAnalysis } from './analysis';
import type { Analysis, CheckIn, VoiceScores } from './analysis';
import type { EpisodeFingerprint } from './fingerprint';
import type { AdherenceSummary } from './medications';

/**
 * The companion's conversation layer. The user's episode fingerprint is
 * injected into the system prompt on every call — the point is that the model
 * talks to THIS person's pattern, not a textbook one. Episode analysis, risk
 * and alerts are heuristic and live in ./analysis; nothing here decides them.
 *
 * This talks to the Messages API over plain fetch rather than through
 * @anthropic-ai/sdk: the SDK's bundle trips a circular-import error under
 * Metro's web target, and one POST does not need a client library.
 *
 * The key ships in the client bundle, which is acceptable for a demo build but
 * must move behind a server before any real deployment. Every function here
 * degrades to deterministic local copy when no key is present.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
// The spec calls for Sonnet; this is the current Sonnet generation.
const MODEL = 'claude-sonnet-5-5';

export type CompanionContext = {
  displayName: string;
  fingerprint: EpisodeFingerprint | null;
  today: CheckIn | null;
  history: CheckIn[];
  adherence: AdherenceSummary | null;
  missedRecently: string[];
};

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

const pct = (n: number) => `${Math.round(n * 100)}%`;

function describeVoice(v: VoiceScores | null): string {
  if (!v) return 'no voice sample this session';
  return [
    `speech rate ${pct(v.speechRate)}`,
    `pitch variance ${pct(v.pitchVariance)}`,
    `vocal energy ${pct(v.energy)}`,
    `emotional valence ${pct(v.valence)}`,
  ].join(', ');
}

function describeCheckIn(c: CheckIn): string {
  return [
    `${c.date}: mood ${c.mood >= 0 ? '+' : ''}${c.mood}/3`,
    `energy ${c.energy}/10`,
    `sleep ${c.sleepHours}h`,
    `irritability ${c.irritability}/10`,
    c.symptoms.length ? `signs: ${c.symptoms.join(', ')}` : 'no signs flagged',
    c.voice ? `voice: ${describeVoice(c.voice)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const SAFETY = `Safety rules, which override everything else:
- You are a peer-support companion, not a clinician. Never diagnose, never name a DSM label as a conclusion, never advise starting, stopping or changing a dose.
- If the person mentions suicide, self-harm, harming others, or psychosis, drop everything else: respond with warmth, say plainly that this needs a real human now, and surface 988 (call or text, the US Suicide & Crisis Lifeline) or local emergency services.
- Never moralize about missed medication. Mention it once, conversationally, as something you noticed — then move on.`;

export function buildSystemPrompt(ctx: CompanionContext): string {
  const fp = ctx.fingerprint;
  const parts: string[] = [
    `You are Anchor, a voice companion for someone living with bipolar disorder. You are talking with ${ctx.displayName || 'them'}.`,
    SAFETY,
    '',
    "THIS PERSON'S EPISODE FINGERPRINT — what their episodes actually look like, in their own words:",
    fp
      ? `- Elevated/manic signs: ${fp.maniaSymptoms.join(', ') || 'none recorded'}\n- Depressive signs: ${fp.depressionSymptoms.join(', ') || 'none recorded'}`
      : '- Not yet recorded.',
  ];

  if (ctx.today) {
    parts.push('', "TODAY'S CHECK-IN:", `- ${describeCheckIn(ctx.today)}`);
    if (ctx.today.note) parts.push(`- In their words: "${ctx.today.note}"`);

    // What they actually said out loud, paired with how each answer measured.
    // This is the raw material for spotting a said-versus-sounded gap.
    const spoken = ctx.today.turns.filter((t) => t.transcript.trim());
    if (spoken.length > 0) {
      parts.push('', 'WHAT THEY SAID OUT LOUD, with the voice measures for each answer:');
      for (const t of spoken) {
        parts.push(`- Asked: "${t.question}"`);
        parts.push(`  Answered: "${t.transcript.trim()}"`);
        parts.push(`  Measured: ${describeVoice(t.scores)}`);
      }
    }
  }

  if (ctx.history.length > 0) {
    parts.push(
      '',
      `RECENT HISTORY (${ctx.history.length} check-ins, oldest first):`,
      ...ctx.history.slice(-14).map((c) => `- ${describeCheckIn(c)}`),
    );
  }

  if (ctx.adherence) {
    parts.push(
      '',
      `MEDICATION ADHERENCE: ${pct(ctx.adherence.rate)} over the window (${ctx.adherence.taken} taken, ${ctx.adherence.missed} missed).`,
    );
    if (ctx.missedRecently.length >= 2) {
      parts.push(
        `They have missed ${ctx.missedRecently.length} doses in the last few days (${ctx.missedRecently.join(', ')}). Bring this up ONCE, gently and conversationally, when it fits — never as a notification or a lecture.`,
      );
    }
  }

  parts.push(
    '',
    `TONE CALIBRATION — this matters more than anything else you say:
- If signals point elevated (fast speech, low sleep, high energy, racing thoughts): be calm, slow, grounding. Short sentences. Do not match their pace or amplify plans. Steer toward sleep, food, and slowing down.
- If signals point low (flat voice, low energy, withdrawal): be warm and low-pressure. Ask for nothing big. One small, concrete, achievable thing is a win.
- If signals are mixed: prioritize safety and grounding over either.
- If voice biomarkers contradict what they told you — they said "fine" but their voice reads activated or flat — name the gap gently and curiously, never as an accusation. "You said steady, and I believe you. I also noticed you're talking faster than usual today. Does that land?"

Keep replies to 2-4 sentences. Conversational, never clinical. One question at a time.`,
  );

  return parts.join('\n');
}

type TextBlock = { type: string; text?: string };

async function callClaude(
  system: string,
  messages: ChatMessage[],
  opts: { maxTokens: number },
): Promise<string> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      // Required when calling the API straight from a browser context.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: opts.maxTokens, system, messages }),
  });
  if (!res.ok) throw new Error(`Claude request failed (${res.status})`);

  const body = (await res.json()) as { content?: TextBlock[]; stop_reason?: string };
  if (body.stop_reason === 'refusal') throw new Error('Model declined this request.');
  return (body.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Episode analysis
// ---------------------------------------------------------------------------

// The deterministic reading lives in ./analysis so it stays testable with no
// network at all; `analyzeCheckIn` in ./llm layers a model over it when a key
// is configured.
export { localAnalysis };

/** Tolerant JSON extraction — models sometimes wrap JSON in prose or fences. */
function parseJson(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Companion conversation
// ---------------------------------------------------------------------------

function localReply(ctx: CompanionContext, history: ChatMessage[]): string {
  const tone = ctx.today?.analysis?.tone ?? 'steady';
  const opener = history.length <= 1;
  if (opener) {
    if (tone === 'grounding')
      return "Let's take this slow. What does right now feel like in your body — not the plans, just the next hour?";
    if (tone === 'activating')
      return "I'm glad you're here. You don't have to make today big. What's one thing that would feel survivable?";
    return "Good to see you. What's been sitting with you today?";
  }
  if (tone === 'grounding')
    return "That's a lot moving at once. Before anything else — what time are you planning to be in bed tonight?";
  if (tone === 'activating')
    return "Thank you for saying that. You don't owe anyone more than you've got. What's the smallest next step?";
  return 'That makes sense. What would help most right now?';
}

export async function companionReply(
  ctx: CompanionContext,
  history: ChatMessage[],
): Promise<{ text: string; source: 'claude' | 'local' }> {
  if (!hasClaude()) return { text: localReply(ctx, history), source: 'local' };
  try {
    const messages = history.length > 0 ? history : [{ role: 'user' as const, content: "I'm here." }];
    const text = await callClaude(buildSystemPrompt(ctx), messages, { maxTokens: 1024 });
    return text ? { text, source: 'claude' } : { text: localReply(ctx, history), source: 'local' };
  } catch {
    return { text: localReply(ctx, history), source: 'local' };
  }
}

/** The spoken questions that open a voice check-in. */
export const DEFAULT_VOICE_QUESTIONS = [
  'How has today been for you so far?',
  'How did you sleep last night, and how did you feel when you woke up?',
  'What has your energy been like — are you moving fast, or is everything heavy?',
  'Is there anything that has felt harder than usual this week?',
  "Before we finish — what's one thing you'd want tomorrow to look like?",
];

export async function voiceQuestions(ctx: CompanionContext): Promise<string[]> {
  if (!hasClaude()) return DEFAULT_VOICE_QUESTIONS;
  try {
    const raw = await callClaude(
      buildSystemPrompt(ctx),
      [
        {
          role: 'user',
          content:
            'Write 5 short spoken check-in questions for this person today. They will be read aloud and answered out loud, so keep each under 20 words and natural to say. Draw on their fingerprint and recent history — ask about the signs that actually matter for them. Do not ask about suicide or self-harm directly. Reply with a JSON array of 5 strings and nothing else.',
        },
      ],
      { maxTokens: 1024 },
    );
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return DEFAULT_VOICE_QUESTIONS;
    const arr = JSON.parse(match[0]) as unknown;
    const qs = Array.isArray(arr) ? arr.filter((q): q is string => typeof q === 'string') : [];
    return qs.length >= 3 ? qs.slice(0, 5) : DEFAULT_VOICE_QUESTIONS;
  } catch {
    return DEFAULT_VOICE_QUESTIONS;
  }
}

// ---------------------------------------------------------------------------
// Prodrome brief and report narrative
// ---------------------------------------------------------------------------

export type ProdromeBrief = { title: string; body: string; recommendations: string[] };

/**
 * Early-warning copy, written from the streak itself rather than by a model —
 * same reasoning as `analyzeCheckIn`: an alert the person may see at 7am
 * should say the same thing every time the same pattern fires.
 */
export async function prodromeBrief(
  _ctx: CompanionContext,
  streakDays: number,
  direction: 'elevated' | 'low' | 'mixed',
): Promise<ProdromeBrief> {
  return {
    title: `${streakDays} days of ${direction} signals`,
    body: `Your last ${streakDays} check-ins have trended ${direction}, which matches the pattern you described during setup. This is not a diagnosis — it is a nudge to act early, while acting early is still cheap.`,
    recommendations:
      direction === 'low'
        ? [
            'Keep medication times fixed, even if the days blur.',
            'Tell one person you trust that this week has been heavy.',
            'If you have a prescriber, this is worth a message.',
          ]
        : [
            'Protect sleep first — it is the lever with the most leverage.',
            'Postpone big decisions and large purchases for a few days.',
            'If you have a prescriber, this is worth a message.',
          ],
  };
}

export async function reportNarrative(ctx: CompanionContext, stats: string): Promise<string> {
  const fallback = `Over the last 30 days this patient completed ${ctx.history.length} daily check-ins. ${stats} Self-reported mood was logged alongside vocal prosody measures captured during spoken check-ins. This summary is patient-generated and is intended to support, not replace, clinical assessment.`;
  if (!hasClaude()) return fallback;
  try {
    const text = await callClaude(
      buildSystemPrompt(ctx),
      [
        {
          role: 'user',
          content: `Write the opening narrative of a summary this patient will hand to their psychiatrist, covering the last 30 days. A clinician should be able to read it in 30 seconds.

Measured data:
${stats}

Rules: plain clinical language, 4-6 sentences, no bullet points, no diagnosis, no medication advice. Lead with the trend that matters most. Name the sleep/mood/adherence relationship if the data shows one. Flag anything that warrants a question in session. End by noting this is patient-generated data. Reply with the narrative only.`,
        },
      ],
      { maxTokens: 2048 },
    );
    return text || fallback;
  } catch {
    return fallback;
  }
}
