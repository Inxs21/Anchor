import { Audio } from 'expo-av';
import { doc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { ref, set, push, serverTimestamp as rtdbTimestamp } from 'firebase/database';
import { db, rtdb } from './firebase';
import type { EpisodeFingerprint } from './checkins';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let result = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    result += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as any);
  }
  return btoa(result);
}

// ─── ElevenLabs TTS ───────────────────────────────────────────────────────────

export async function speakText(text: string): Promise<void> {
  const apiKey  = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;
  const voiceId = process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID ?? 'EXAVITQu4vr4xnSDxMaL';

  if (!apiKey || apiKey === 'your_elevenlabs_key_here') {
    // No key — just wait 1s so the UI still transitions smoothly
    await new Promise((r) => setTimeout(r, 1000));
    return;
  }

  await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.55, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);

  const base64 = arrayBufferToBase64(await res.arrayBuffer());

  const { sound } = await Audio.Sound.createAsync(
    { uri: `data:audio/mpeg;base64,${base64}` },
    { shouldPlay: true }
  );

  await new Promise<void>((resolve) => {
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync();
        resolve();
      }
    });
  });
}

// ─── Recording ────────────────────────────────────────────────────────────────

export async function requestMicPermission(): Promise<boolean> {
  const { status } = await Audio.requestPermissionsAsync();
  return status === 'granted';
}

export async function startRecording(): Promise<Audio.Recording> {
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  const recording = new Audio.Recording();
  await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  await recording.startAsync();
  return recording;
}

export async function stopRecording(recording: Audio.Recording): Promise<string | null> {
  const status = await recording.getStatusAsync();
  if (status.canRecord) {
    await recording.stopAndUnloadAsync();
  }
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
  return recording.getURI() ?? null;
}

// ─── Hume Prosody Analysis ────────────────────────────────────────────────────

export type HumeScores = {
  energy:  number;  // 0–1
  valence: number;  // –1 to 1
  arousal: number;  // 0–1
};

// ─── Bipolar Speech Markers ──────────────────────────────────────────────────

export type SpeechRateMetrics = {
  wordsPerMinute:     number;   // avg wpm across all responses
  totalWordCount:     number;   // total words spoken
  avgResponseLength:  number;   // avg words per response
  avgResponseLatency: number;   // avg seconds per response (from durations)
  shortResponseRatio: number;   // 0–1, fraction of responses with < 5 words
};

export type ProsodyMetrics = {
  emotionalRange:          number;  // 0–1, max - min emotion score across segments
  emotionVariance:         number;  // std deviation of emotion scores across segments
  dominantValencePolarity: number;  // -1 to 1, positive vs negative emotion balance
};

export type SpeechOrganization = {
  topicCoherence:  number;  // 0–10, how well responses stay on-topic
  topicShiftCount: number;  // number of distinct topic jumps
  ruminationScore: number;  // 0–10, repetitive return to same negative theme
};

export type ContentThemes = {
  grandiosity:    number;   // 0–10
  hopelessness:   number;   // 0–10
  selfCriticism:  number;   // 0–10
  racingThoughts: boolean;
  anhedonia:      number;   // 0–10
};

export type BipolarIndices = {
  manicIndex:      number;  // 0–1, composite manic signal strength
  depressiveIndex: number;  // 0–1, composite depressive signal strength
  mixedStateFlag:  boolean; // depressive content + high agitation
};

export type HumeResult = {
  scores:            HumeScores;
  transcripts:       string[];
  topEmotions:       { name: string; score: number }[];
  speechRate:        SpeechRateMetrics;
  prosody:           ProsodyMetrics;
};

// ─── Speech Rate Computation ─────────────────────────────────────────────────

function computeSpeechRateMetrics(
  transcripts: string[],
  durations: number[],
): SpeechRateMetrics {
  const wordCounts = transcripts.map((t) => {
    const words = t.trim().split(/\s+/).filter(Boolean);
    return words.length;
  });
  const totalWordCount = wordCounts.reduce((s, c) => s + c, 0);
  const totalDuration = durations.reduce((s, d) => s + d, 0);
  const wordsPerMinute = totalDuration > 0 ? (totalWordCount / totalDuration) * 60 : 0;
  const avgResponseLength = transcripts.length > 0 ? totalWordCount / transcripts.length : 0;
  const avgResponseLatency = durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;
  const shortResponseRatio = wordCounts.length > 0
    ? wordCounts.filter((c) => c < 5).length / wordCounts.length
    : 0;

  return { wordsPerMinute, totalWordCount, avgResponseLength, avgResponseLatency, shortResponseRatio };
}

// ─── Prosody Metrics from Hume Emotion Buckets ──────────────────────────────

function computeProsodyMetrics(
  buckets: Record<string, number[]>,
): ProsodyMetrics {
  // Collect all individual scores across all emotions and segments
  const allScores: number[] = [];
  Object.values(buckets).forEach((arr) => allScores.push(...arr));

  let emotionalRange = 0;
  let emotionVariance = 0;
  if (allScores.length > 0) {
    emotionalRange = Math.max(...allScores) - Math.min(...allScores);
    const mean = allScores.reduce((s, v) => s + v, 0) / allScores.length;
    emotionVariance = Math.sqrt(
      allScores.reduce((s, v) => s + (v - mean) ** 2, 0) / allScores.length,
    );
  }

  // Positive vs negative balance
  const avgOf = (names: string[]) => {
    let sum = 0; let count = 0;
    names.forEach((n) => {
      const arr = buckets[n] ?? [];
      arr.forEach((v) => { sum += v; count++; });
    });
    return count > 0 ? sum / count : 0;
  };
  const posAvg = avgOf(['Joy', 'Contentment', 'Excitement', 'Interest', 'Amusement']);
  const negAvg = avgOf(['Sadness', 'Anxiety', 'Anger', 'Fear', 'Disgust', 'Contempt']);
  const dominantValencePolarity = Math.max(-1, Math.min(1, posAvg - negAvg));

  return { emotionalRange, emotionVariance, dominantValencePolarity };
}

export async function analyzeWithHume(
  audioUris: string[],
  durations: number[] = [],
): Promise<HumeResult> {
  const fallbackScores: HumeScores = { energy: 0.5, valence: 0, arousal: 0.5 };
  const fallbackSpeechRate: SpeechRateMetrics = {
    wordsPerMinute: 0, totalWordCount: 0, avgResponseLength: 0,
    avgResponseLatency: 0, shortResponseRatio: 0,
  };
  const fallbackProsody: ProsodyMetrics = {
    emotionalRange: 0, emotionVariance: 0, dominantValencePolarity: 0,
  };
  const fallback: HumeResult = {
    scores: fallbackScores, transcripts: [], topEmotions: [],
    speechRate: fallbackSpeechRate, prosody: fallbackProsody,
  };

  const apiKey = process.env.EXPO_PUBLIC_HUME_API_KEY;
  if (!apiKey || apiKey === 'your_hume_key_here' || !audioUris.length) return fallback;

  try {
    const formData = new FormData();
    audioUris.forEach((uri, i) => {
      formData.append('file', { uri, name: `r${i}.m4a`, type: 'audio/m4a' } as any);
    });
    formData.append('json', JSON.stringify({ models: { prosody: {} } }));

    const submitRes = await fetch('https://api.hume.ai/v0/batch/jobs', {
      method: 'POST',
      headers: { 'X-Hume-Api-Key': apiKey },
      body: formData,
    });
    if (!submitRes.ok) {
      console.warn('Hume submit failed:', submitRes.status, await submitRes.text());
      return fallback;
    }

    const { job_id } = await submitRes.json();

    // Poll up to 20× at 2s intervals (~40s max)
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));

      const pollRes = await fetch(
        `https://api.hume.ai/v0/batch/jobs/${job_id}/predictions`,
        { headers: { 'X-Hume-Api-Key': apiKey } }
      );
      if (!pollRes.ok) continue;

      const data = await pollRes.json();
      if (!Array.isArray(data) || !data.length) continue;

      // Extract transcripts (one per file, concatenate all segments)
      const transcripts: string[] = data.map((file: any) => {
        const segments: string[] = [];
        file.results?.predictions?.forEach((pred: any) => {
          pred.models?.prosody?.grouped_predictions?.forEach((group: any) => {
            group.predictions?.forEach((p: any) => {
              if (p.text) segments.push(p.text.trim());
            });
          });
        });
        return segments.join(' ');
      });

      // Flatten all emotion scores
      const buckets: Record<string, number[]> = {};
      data.forEach((file: any) => {
        file.results?.predictions?.forEach((pred: any) => {
          pred.models?.prosody?.grouped_predictions?.forEach((group: any) => {
            group.predictions?.forEach((p: any) => {
              p.emotions?.forEach((e: any) => {
                if (!buckets[e.name]) buckets[e.name] = [];
                buckets[e.name].push(e.score);
              });
            });
          });
        });
      });

      const avg = (name: string) => {
        const arr = buckets[name] ?? [];
        return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
      };

      // Top 5 emotions by average score
      const topEmotions = Object.entries(buckets)
        .map(([name]) => ({ name, score: avg(name) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      // Compute new bipolar-relevant metrics
      const speechRate = computeSpeechRateMetrics(transcripts, durations);
      const prosody = computeProsodyMetrics(buckets);

      return {
        scores: {
          energy:  Math.min(1, avg('Energy') + avg('Excitement') * 0.5),
          valence: avg('Joy') + avg('Contentment') - avg('Sadness') - avg('Anxiety') - avg('Anger'),
          arousal: avg('Excitement') + avg('Anxiety') * 0.7 + avg('Anger') * 0.5,
        },
        transcripts,
        topEmotions,
        speechRate,
        prosody,
      };
    }
  } catch (e) {
    console.warn('Hume error:', e);
  }

  return fallback;
}

// ─── Claude Check-in Analysis ─────────────────────────────────────────────────

export type CheckinResult = {
  todayState:        'stable' | 'elevated' | 'low' | 'mixed';
  riskLevel:         'low' | 'medium' | 'high';
  insight:           string;
  flagged:           boolean;
  speechOrganization: SpeechOrganization;
  contentThemes:      ContentThemes;
  bipolarIndices:     BipolarIndices;
};

export async function analyzeCheckin(
  questions: string[],
  responseDurations: number[],
  humeResult: HumeResult,
  fingerprint?: EpisodeFingerprint | null,
): Promise<CheckinResult> {
  const defaultOrg: SpeechOrganization = { topicCoherence: 5, topicShiftCount: 0, ruminationScore: 0 };
  const defaultContent: ContentThemes = { grandiosity: 0, hopelessness: 0, selfCriticism: 0, racingThoughts: false, anhedonia: 0 };
  const defaultIndices: BipolarIndices = { manicIndex: 0, depressiveIndex: 0, mixedStateFlag: false };
  const fallback: CheckinResult = {
    todayState: 'stable', riskLevel: 'low',
    insight: 'Check-in complete.', flagged: false,
    speechOrganization: defaultOrg,
    contentThemes: defaultContent,
    bipolarIndices: defaultIndices,
  };

  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_anthropic_key_here') return fallback;

  const { scores, transcripts, topEmotions, speechRate, prosody } = humeResult;

  const transcriptBlock = questions.map((q, i) => {
    const t = transcripts[i] ?? '(no transcript)';
    const d = responseDurations[i]?.toFixed(1) ?? '?';
    const wc = t.trim().split(/\s+/).filter(Boolean).length;
    return `Q${i + 1}: "${q}"\nResponse (${d}s, ${wc} words): "${t}"`;
  }).join('\n\n');

  const emotionBlock = topEmotions.map(e => `${e.name}: ${(e.score * 100).toFixed(1)}%`).join(', ');

  const fingerprintBlock = fingerprint
    ? `\nUSER'S PERSONAL EPISODE FINGERPRINT (use this to personalize — this is THEIR specific pattern):
- Their elevated/mania signs: ${fingerprint.maniaSymptoms.join(', ') || 'not specified'}
- Their low/depression signs:  ${fingerprint.depressionSymptoms.join(', ') || 'not specified'}
Cross-reference the voice data against these personal signals, not generic bipolar criteria.\n`
    : '';

  const prompt = `You are a clinical voice analysis system for bipolar disorder monitoring.
${fingerprintBlock}
TRANSCRIPTS:
${transcriptBlock}

HUME VOICE PROSODY:
- Energy:  ${scores.energy.toFixed(3)} (0=low, 1=high)
- Valence: ${scores.valence.toFixed(3)} (-1=negative, 1=positive)
- Arousal: ${scores.arousal.toFixed(3)} (0=calm, 1=agitated)
- Emotional range: ${prosody.emotionalRange.toFixed(3)} (0=flat/monotone, 1=highly variable)
- Emotion variance: ${prosody.emotionVariance.toFixed(3)} (low=blunted affect, high=labile)
- Valence polarity: ${prosody.dominantValencePolarity.toFixed(3)} (-1=negative, 1=positive)
- Top emotions: ${emotionBlock || 'none'}

SPEECH RATE METRICS:
- Words per minute: ${speechRate.wordsPerMinute.toFixed(1)} (normal=120-150, manic>180, depressive<80)
- Total word count: ${speechRate.totalWordCount}
- Avg response length: ${speechRate.avgResponseLength.toFixed(1)} words
- Avg response latency: ${speechRate.avgResponseLatency.toFixed(1)}s
- Short response ratio: ${(speechRate.shortResponseRatio * 100).toFixed(0)}% of responses under 5 words (high=poverty of speech)

BIPOLAR SPEECH MARKERS TO EVALUATE:

Manic indicators (pressured speech, flight of ideas, verbosity):
- Fast speech (>180 wpm), excessive words, very short response latency (impulsive)
- High emotional range and variance (animated, labile)
- Low topic coherence (flight of ideas, tangential, loose associations)
- Grandiose content (big plans, special abilities, invincibility)
- Racing thoughts (mentions or evidence of rapid thought)

Depressive indicators (poverty of speech, psychomotor slowing):
- Slow speech (<80 wpm), few words, long response latency
- Low emotional range and variance (flat prosody, monotone, blunted affect)
- High short-response ratio (brief answers, near-mutism)
- Hopelessness, self-criticism, worthlessness in content
- Rumination (repetitive return to same negative theme)
- Anhedonia (loss of interest/pleasure)

Mixed state indicators:
- Depressive content themes COMBINED WITH high arousal/agitation
- Irritability + hopelessness co-occurring

Respond ONLY with this JSON (no markdown, no extra text):
{
  "today_state": "stable|elevated|low|mixed",
  "risk_level": "low|medium|high",
  "insight": "A single warm sentence under 15 words",
  "flagged": false,
  "speech_organization": {
    "topic_coherence": 5,
    "topic_shift_count": 0,
    "rumination_score": 0
  },
  "content_themes": {
    "grandiosity": 0,
    "hopelessness": 0,
    "self_criticism": 0,
    "racing_thoughts": false,
    "anhedonia": 0
  },
  "bipolar_indices": {
    "manic_index": 0.0,
    "depressive_index": 0.0,
    "mixed_state_flag": false
  }
}

CLASSIFICATION RULES:
- elevated: manic_index > 0.6 (pressured speech + high energy + flight of ideas + grandiosity)
- low: depressive_index > 0.6 (poverty of speech + flat prosody + hopelessness + rumination)
- mixed: manic_index > 0.4 AND depressive_index > 0.4 (agitated depression or dysphoric mania)
- stable: both indices < 0.4
- flagged: elevated OR mixed OR (low AND arousal < 0.25)
- risk: low=stable, medium=single mild signal, high=multiple signals or strong signal`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data  = await res.json();
    const text  = data.content?.[0]?.text ?? '';
    const json  = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}');

    return {
      todayState: json.today_state ?? 'stable',
      riskLevel:  json.risk_level  ?? 'low',
      insight:    json.insight     ?? 'Check-in complete.',
      flagged:    json.flagged     ?? false,
      speechOrganization: {
        topicCoherence:  json.speech_organization?.topic_coherence  ?? 5,
        topicShiftCount: json.speech_organization?.topic_shift_count ?? 0,
        ruminationScore: json.speech_organization?.rumination_score ?? 0,
      },
      contentThemes: {
        grandiosity:    json.content_themes?.grandiosity     ?? 0,
        hopelessness:   json.content_themes?.hopelessness    ?? 0,
        selfCriticism:  json.content_themes?.self_criticism   ?? 0,
        racingThoughts: json.content_themes?.racing_thoughts ?? false,
        anhedonia:      json.content_themes?.anhedonia       ?? 0,
      },
      bipolarIndices: {
        manicIndex:      json.bipolar_indices?.manic_index       ?? 0,
        depressiveIndex: json.bipolar_indices?.depressive_index  ?? 0,
        mixedStateFlag:  json.bipolar_indices?.mixed_state_flag  ?? false,
      },
    };
  } catch (e) {
    console.warn('Claude error:', e);
    return fallback;
  }
}

// ─── Firebase Save ────────────────────────────────────────────────────────────

export async function saveCheckin(
  uid: string,
  dateStr: string,
  humeResult: HumeResult,
  result: CheckinResult,
  questions: string[],
  responseDurations: number[],
): Promise<void> {
  const checkinData = {
    date:        dateStr,
    humeScores:  humeResult.scores,
    topEmotions: humeResult.topEmotions,
    transcripts: humeResult.transcripts,
    speechRate:  humeResult.speechRate,
    prosody:     humeResult.prosody,
    todayState:  result.todayState,
    riskLevel:   result.riskLevel,
    insight:     result.insight,
    flagged:     result.flagged,
    speechOrganization: result.speechOrganization,
    contentThemes:      result.contentThemes,
    bipolarIndices:     result.bipolarIndices,
  };

  // Update the per-day "latest" doc for the home screen
  const fsRef = doc(db, 'users', uid, 'checkins', dateStr);
  await setDoc(fsRef, { ...checkinData, completedAt: serverTimestamp() }, { merge: true });

  // Also store every check-in individually so none are lost
  await addDoc(collection(db, 'users', uid, 'checkinLogs'), {
    ...checkinData,
    completedAt: serverTimestamp(),
  });

  // Save full conversation to Realtime Database
  const convoRef = push(ref(rtdb, `users/${uid}/conversations`));
  await set(convoRef, {
    ...checkinData,
    questions,
    responseDurations,
    exchanges: questions.map((q, i) => ({
      question: q,
      transcript: humeResult.transcripts[i] ?? '',
      durationSec: responseDurations[i] ?? 0,
      wordCount: (humeResult.transcripts[i] ?? '').trim().split(/\s+/).filter(Boolean).length,
    })),
    completedAt: rtdbTimestamp(),
  });
}
