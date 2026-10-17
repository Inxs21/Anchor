import { GEMINI_API_KEY, GEMINI_MODEL, GROQ_API_KEY, GROQ_MODEL, hasGemini, hasGroq } from './env';
import { localAnalysis } from './analysis';
import type { Analysis, CheckIn } from './analysis';
import { buildSystemPrompt, type CompanionContext } from './claude';

/**
 * Model-backed episode analysis, on whichever free-tier provider has a key:
 * Google AI Studio (Gemini) first, then Groq. Both are asked for strict JSON
 * and both are given the same prompt the companion uses, so the reading is
 * made against THIS person's fingerprint, history and voice measures.
 *
 * The heuristics in ./analysis remain the floor, not a legacy path: they run
 * first, they decide the answer whenever no key is set, and every failure here
 * — no key, bad JSON, rate limit, offline, crisis language — lands back on
 * them. A model is allowed to describe the day better; it is not allowed to
 * talk the app out of a reading the numbers support, and it never gets to
 * downgrade a crisis response.
 */

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const TIMEOUT_MS = 20000;

export type LLMProvider = 'gemini' | 'groq';

/** Which provider will be used, or null when the app is running on heuristics. */
export function activeProvider(): LLMProvider | null {
  if (hasGemini()) return 'gemini';
  if (hasGroq()) return 'groq';
  return null;
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(system: string, user: string): Promise<string> {
  return withTimeout(async (signal) => {
    const res = await fetch(
      `${GEMINI_URL}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini failed (${res.status})`);
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return (body.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim();
  });
}

async function callGroq(system: string, user: string): Promise<string> {
  return withTimeout(async (signal) => {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${GROQ_API_KEY}`,
      },
      signal,
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Groq failed (${res.status})`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return (body.choices?.[0]?.message?.content ?? '').trim();
  });
}

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

const ANALYSIS_INSTRUCTION = `Analyze today's check-in against this person's own fingerprint and their recent history.

Pay particular attention to any gap between what they SAID out loud and what their VOICE measured. That discrepancy is the single most useful signal you have.

Reply with JSON only, no prose around it:
{
  "state": "stable" | "elevated" | "low" | "mixed",
  "risk": 0.0-1.0,
  "discrepancy": string or null,
  "summary": "two sentences, second person, plain language, no diagnosis",
  "recommendations": ["2-3 concrete actions for the next 24 hours"],
  "tone": "grounding" | "activating" | "steady"
}`;

/**
 * The reading for one check-in. Heuristics when there is no key or the call
 * fails; otherwise the model's wording, with the heuristic result as the floor.
 */
export async function analyzeCheckIn(ctx: CompanionContext, c: CheckIn): Promise<Analysis> {
  const floor = localAnalysis(c, ctx.fingerprint);
  const provider = activeProvider();
  if (!provider) return floor;

  // Crisis language was detected locally. That response is not negotiable and
  // is not worth a round trip.
  if (floor.risk >= 1) return floor;

  try {
    const system = buildSystemPrompt(ctx);
    const raw =
      provider === 'gemini'
        ? await callGemini(system, ANALYSIS_INSTRUCTION)
        : await callGroq(system, ANALYSIS_INSTRUCTION);
    const json = parseJson(raw);
    if (!json) return floor;

    const states = ['stable', 'elevated', 'low', 'mixed'] as const;
    const tones = ['grounding', 'activating', 'steady'] as const;
    const modelRisk = typeof json.risk === 'number' ? Math.max(0, Math.min(1, json.risk)) : 0;
    const recs = Array.isArray(json.recommendations)
      ? json.recommendations.filter((r): r is string => typeof r === 'string')
      : [];

    return {
      state: states.find((s) => s === json.state) ?? floor.state,
      // The model may raise the reading but never lower it below what the
      // numbers already justify.
      risk: Math.max(floor.risk, modelRisk),
      discrepancy:
        typeof json.discrepancy === 'string' && json.discrepancy
          ? json.discrepancy
          : floor.discrepancy,
      summary: typeof json.summary === 'string' && json.summary ? json.summary : floor.summary,
      recommendations: recs.length > 0 ? recs : floor.recommendations,
      tone: tones.find((t) => t === json.tone) ?? floor.tone,
      source: provider,
    };
  } catch {
    return floor;
  }
}
