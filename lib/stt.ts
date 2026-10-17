import { Platform } from 'react-native';
import { ELEVENLABS_API_KEY, hasSpeechToText } from './env';

/**
 * Speech-to-text for the spoken check-in.
 *
 * Transcripts matter for two reasons: the heuristic analyser reads what the
 * person actually said, and speech rate — the clearest pressured-speech signal
 * we have — is words over seconds, so an empty transcript costs us the measure
 * entirely.
 *
 * The provider is ElevenLabs Scribe, reusing the key the companion voice
 * already needs. Like every other provider in the app it is optional: with no
 * key, or on any failure at all, this returns an empty string and the check-in
 * carries on. It never throws and never blocks a save.
 */

const STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
const MODEL_ID = 'scribe_v1';
const TIMEOUT_MS = 20000;

export type TranscriptionInput = {
  uri: string;
  /** Mime type of the recording; expo-av writes m4a on both platforms. */
  mimeType?: string;
};

export const canTranscribe = hasSpeechToText;

/**
 * The two platforms need different things in the multipart body, and getting
 * this wrong fails silently-ish: React Native's FormData understands a
 * `{ uri, name, type }` descriptor and streams the file itself, while a browser
 * stringifies that same object to "[object Object]" and the API rejects it with
 * 422 "Expected UploadFile". On web the recording URI is a blob: or data: URL,
 * so it has to be read into a real Blob first.
 */
async function buildFilePart(input: TranscriptionInput): Promise<Blob> {
  if (Platform.OS === 'web') {
    const res = await fetch(input.uri);
    return res.blob();
  }
  return {
    uri: input.uri,
    name: 'answer.m4a',
    type: input.mimeType ?? 'audio/m4a',
  } as unknown as Blob;
}

/** Returns the spoken text, or '' when transcription is unavailable or fails. */
export async function transcribe(input: TranscriptionInput): Promise<string> {
  if (!hasSpeechToText()) return '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append('model_id', MODEL_ID);
    // Diarization and event tagging would only add noise to a single-speaker
    // answer, and both cost latency the check-in flow cannot spare.
    form.append('diarize', 'false');
    form.append('tag_audio_events', 'false');

    const part = await buildFilePart(input);
    // The filename matters on web: without it the browser sends the part as a
    // plain field rather than a file upload.
    if (Platform.OS === 'web') form.append('file', part, 'answer.webm');
    else form.append('file', part);

    const res = await fetch(STT_URL, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) return '';
    const json = (await res.json()) as { text?: unknown };
    return typeof json.text === 'string' ? json.text.trim() : '';
  } catch {
    // Offline, aborted, rate limited — all the same to the caller.
    return '';
  } finally {
    clearTimeout(timer);
  }
}
