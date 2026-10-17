import Constants from 'expo-constants';

/**
 * Keys come from EXPO_PUBLIC_* env vars (inlined at build time). Every provider
 * is optional: when a key is absent the matching lib falls back to a local
 * heuristic so the app stays fully demoable with no credentials at all.
 */
function read(name: string): string {
  const fromProcess = process.env[name as keyof typeof process.env];
  if (typeof fromProcess === 'string' && fromProcess.length > 0) return fromProcess;
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const fromExtra = extra[name];
  return typeof fromExtra === 'string' ? fromExtra : '';
}

export const ANTHROPIC_API_KEY = read('EXPO_PUBLIC_ANTHROPIC_API_KEY');
export const HUME_API_KEY = read('EXPO_PUBLIC_HUME_API_KEY');
export const ELEVENLABS_API_KEY = read('EXPO_PUBLIC_ELEVENLABS_API_KEY');
// Default companion voice: ElevenLabs "Sarah" — softer and slower than the
// stock Rachel voice, which matters when the app is talking to someone who may
// be activated. Override with EXPO_PUBLIC_ELEVENLABS_VOICE_ID.
export const ELEVENLABS_VOICE_ID = read('EXPO_PUBLIC_ELEVENLABS_VOICE_ID') || 'EXAVITQu4vr4xnSDxMaL';

// Free-tier analysis providers. Either one turns the model-backed reading on;
// with neither, the deterministic heuristics decide every check-in.
export const GEMINI_API_KEY = read('EXPO_PUBLIC_GEMINI_API_KEY');
export const GEMINI_MODEL = read('EXPO_PUBLIC_GEMINI_MODEL') || 'gemini-2.0-flash';
export const GROQ_API_KEY = read('EXPO_PUBLIC_GROQ_API_KEY');
export const GROQ_MODEL = read('EXPO_PUBLIC_GROQ_MODEL') || 'llama-3.3-70b-versatile';

export const hasClaude = () => ANTHROPIC_API_KEY.length > 0;
export const hasGemini = () => GEMINI_API_KEY.length > 0;
export const hasGroq = () => GROQ_API_KEY.length > 0;
export const hasHume = () => HUME_API_KEY.length > 0;
export const hasElevenLabs = () => ELEVENLABS_API_KEY.length > 0;
// Scribe speech-to-text rides on the same ElevenLabs credential as the voice.
export const hasSpeechToText = () => ELEVENLABS_API_KEY.length > 0;
