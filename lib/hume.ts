import { HUME_API_KEY, hasHume } from './env';
import { utteranceMsFromMeters } from './analysis';
import type { VoiceScores } from './checkins';

/**
 * Vocal prosody analysis.
 *
 * Preferred path is Hume AI's batch Expression Measurement API, which returns
 * 48 emotion scores per vocal utterance. Those are folded down to the four axes
 * that matter for bipolar monitoring. When no Hume key is configured — or the
 * job fails or times out — we fall back to on-device signal: amplitude metering
 * from the recording plus speech rate derived from the transcript. The fallback
 * is coarser but it is real measurement, not a placebo.
 *
 * As of October 2026 Hume answers this endpoint with 403 "The Expression
 * Measurement API has been discontinued", so in practice the on-device path is
 * the live one. The Hume code is kept because it costs nothing when no key is
 * set and the failure path was already the designed behaviour.
 */

const HUME_BASE = 'https://api.hume.ai/v0/batch/jobs';
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 45000;

export type ProsodyInput = {
  uri: string;
  durationMs: number;
  transcript: string;
  /** dBFS samples captured while recording (expo-av metering), newest last. */
  meterSamples?: number[];
  /** Gap between meter samples, for turning them into a duration. */
  meterIntervalMs?: number;
  /**
   * How long the person was actually speaking, when something better than the
   * recording length is known — Scribe's word timestamps, usually. Leading and
   * trailing silence are excluded.
   */
  spokenMs?: number;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/**
 * Words per second → 0..1, centred on conversational speech (~2.5 wps).
 *
 * `spokenMs` is the span the person was actually talking; it is what the rate
 * is measured against whenever it is known, because the recording length
 * includes however long they took to start and to stop. Falls back to the
 * recording length when nothing better is available.
 *
 * Exported because a transcript can arrive after prosody has been measured —
 * when the person types what they said — and speech rate is the one measure
 * that has to be recomputed when it does.
 */
export function speechRateScore(
  transcript: string,
  durationMs: number,
  spokenMs?: number,
): number {
  const words = transcript.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0.5;
  // Guard both ends: a span shorter than half a second is noise, and it can
  // never exceed the recording it came from.
  const usable =
    spokenMs !== undefined && spokenMs >= 500 ? Math.min(spokenMs, durationMs) : durationMs;
  const seconds = Math.max(usable / 1000, 1);
  const wps = words / seconds;
  // 1.0 wps → 0.1 (slowed), 2.5 wps → 0.5 (typical), 4.5 wps → 0.95 (pressured)
  return clamp01((wps - 1.0) / 3.5);
}

export function localProsody(input: ProsodyInput): VoiceScores {
  const samples = (input.meterSamples ?? []).filter((n) => Number.isFinite(n));
  // expo-av meters in dBFS (roughly -160 silent .. 0 peak); normalize the useful band.
  const normalized = samples.map((db) => clamp01((db + 50) / 50));
  const loud = normalized.filter((n) => n > 0.08);

  // Word timestamps are the best source; metering is the next best, and it is
  // all there is when transcription is off.
  // A metering span of 0 means nothing crossed the floor; speechRateScore
  // treats anything under half a second as unusable and falls back on its own.
  const spokenMs = input.spokenMs ?? utteranceMsFromMeters(samples, input.meterIntervalMs ?? 100);
  const speechRate = speechRateScore(input.transcript, input.durationMs, spokenMs);
  const energy = loud.length > 0 ? clamp01(mean(loud) * 1.15) : clamp01(0.35 + speechRate * 0.3);
  const pitchVariance = loud.length > 2 ? clamp01(stdev(loud) * 3.2) : clamp01(0.3 + speechRate * 0.4);
  // Without a model, valence is inferred from activation balance — deliberately
  // pulled toward neutral so a missing key never fabricates a strong reading.
  const valence = clamp01(0.5 + (energy - 0.5) * 0.4 - (speechRate > 0.85 ? 0.1 : 0));

  return { speechRate, pitchVariance, energy, valence };
}

type HumeEmotion = { name: string; score: number };

// Hume emotion names grouped onto the axes they load most heavily on.
const HIGH_AROUSAL = ['Excitement', 'Enthusiasm', 'Joy', 'Anger', 'Anxiety', 'Distress', 'Surprise (positive)', 'Triumph', 'Determination'];
const LOW_AROUSAL = ['Tiredness', 'Boredom', 'Calmness', 'Sadness', 'Disappointment', 'Contemplation'];
const POSITIVE = ['Joy', 'Contentment', 'Excitement', 'Amusement', 'Love', 'Satisfaction', 'Calmness', 'Relief', 'Pride'];
const NEGATIVE = ['Sadness', 'Anxiety', 'Distress', 'Anger', 'Fear', 'Shame', 'Guilt', 'Disappointment', 'Despair', 'Tiredness'];

function scoreOf(emotions: HumeEmotion[], names: string[]): number {
  const hits = emotions.filter((e) => names.includes(e.name)).map((e) => e.score);
  return hits.length === 0 ? 0 : mean(hits);
}

function foldEmotions(emotions: HumeEmotion[], fallback: VoiceScores): VoiceScores {
  if (emotions.length === 0) return fallback;
  const high = scoreOf(emotions, HIGH_AROUSAL);
  const low = scoreOf(emotions, LOW_AROUSAL);
  const pos = scoreOf(emotions, POSITIVE);
  const neg = scoreOf(emotions, NEGATIVE);

  const arousal = clamp01(0.5 + (high - low) * 2.5);
  return {
    // Hume gives no words-per-second, so transcript-derived rate stays authoritative.
    speechRate: fallback.speechRate,
    pitchVariance: clamp01(0.5 + (high - low) * 2.0),
    energy: arousal,
    valence: clamp01(0.5 + (pos - neg) * 2.5),
  };
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function submitJob(uri: string): Promise<string> {
  const form = new FormData();
  form.append('json', JSON.stringify({ models: { prosody: { granularity: 'utterance' } } }));
  form.append('file', {
    uri,
    name: 'checkin.m4a',
    type: 'audio/m4a',
  } as unknown as Blob);

  const res = await fetch(HUME_BASE, {
    method: 'POST',
    headers: { 'X-Hume-Api-Key': HUME_API_KEY },
    body: form,
  });
  if (!res.ok) throw new Error(`Hume job submit failed (${res.status})`);
  const json = (await res.json()) as { job_id?: string };
  if (!json.job_id) throw new Error('Hume job submit returned no job_id');
  return json.job_id;
}

async function awaitPredictions(
  jobId: string,
): Promise<{ emotions: HumeEmotion[]; transcript: string }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(`${HUME_BASE}/${jobId}`, {
      headers: { 'X-Hume-Api-Key': HUME_API_KEY },
    });
    if (!res.ok) continue;
    const body = (await res.json()) as { state?: { status?: string } };
    const status = body.state?.status;
    if (status === 'FAILED') throw new Error('Hume job failed');
    if (status !== 'COMPLETED') continue;

    const predRes = await fetch(`${HUME_BASE}/${jobId}/predictions`, {
      headers: { 'X-Hume-Api-Key': HUME_API_KEY },
    });
    if (!predRes.ok) throw new Error(`Hume predictions failed (${predRes.status})`);
    return extractPredictions(await predRes.json());
  }
  throw new Error('Hume job timed out');
}

/**
 * Walks the prediction payload for prosody utterances, averaging emotion scores
 * and stitching together whatever transcript Hume returned.
 */
function extractPredictions(payload: unknown): { emotions: HumeEmotion[]; transcript: string } {
  const groups: HumeEmotion[][] = [];
  const texts: string[] = [];

  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;

    const emotions = obj.emotions;
    if (
      Array.isArray(emotions) &&
      emotions.every((e) => e && typeof e === 'object' && 'name' in e && 'score' in e)
    ) {
      groups.push(emotions as HumeEmotion[]);
      if (typeof obj.text === 'string' && obj.text.trim()) texts.push(obj.text.trim());
    }
    Object.values(obj).forEach(walk);
  };
  walk(payload);

  const totals = new Map<string, number[]>();
  for (const group of groups) {
    for (const e of group) {
      const list = totals.get(e.name) ?? [];
      list.push(e.score);
      totals.set(e.name, list);
    }
  }
  return {
    emotions: [...totals.entries()].map(([name, scores]) => ({ name, score: mean(scores) })),
    transcript: texts.join(' '),
  };
}

export type ProsodyResult = { scores: VoiceScores; transcript: string };

export async function analyzeProsody(input: ProsodyInput): Promise<ProsodyResult> {
  const fallback = localProsody(input);
  if (!hasHume()) return { scores: fallback, transcript: input.transcript };
  try {
    const jobId = await submitJob(input.uri);
    const { emotions, transcript } = await awaitPredictions(jobId);
    // Hume's own transcript is authoritative when it produced one; otherwise
    // keep whatever the caller already had (typed by the user, or empty).
    const text = transcript || input.transcript;
    return {
      scores: foldEmotions(emotions, localProsody({ ...input, transcript: text })),
      transcript: text,
    };
  } catch {
    // Never block a check-in on the biomarker provider.
    return { scores: fallback, transcript: input.transcript };
  }
}
