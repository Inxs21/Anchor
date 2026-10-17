import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import { File, Paths } from 'expo-file-system';
import { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, hasElevenLabs } from './env';

/**
 * Microphone capture and companion speech.
 *
 * Recording collects dBFS metering alongside the audio file — those samples are
 * what the on-device prosody fallback measures when Hume is not configured.
 * Speech prefers ElevenLabs and falls back to the platform's own synthesizer,
 * so the companion always has a voice.
 */

export type RecordingResult = {
  uri: string;
  durationMs: number;
  meterSamples: number[];
};

const METER_INTERVAL_MS = 100;

export async function requestMicPermission(): Promise<boolean> {
  try {
    const { granted } = await Audio.requestPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

export class VoiceRecorder {
  private recording: Audio.Recording | null = null;
  private samples: number[] = [];
  private durationMs = 0;

  get isRecording(): boolean {
    return this.recording !== null;
  }

  /** Live 0..1 level, for driving the waveform. */
  get level(): number {
    const last = this.samples[this.samples.length - 1];
    if (last === undefined) return 0;
    return Math.max(0, Math.min(1, (last + 50) / 50));
  }

  async start(): Promise<void> {
    if (this.recording) return;
    this.samples = [];
    this.durationMs = 0;

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const { recording } = await Audio.Recording.createAsync(
      { ...Audio.RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true },
      (status) => {
        if (!status.isRecording) return;
        this.durationMs = status.durationMillis ?? this.durationMs;
        if (typeof status.metering === 'number' && Number.isFinite(status.metering)) {
          this.samples.push(status.metering);
        }
      },
      METER_INTERVAL_MS,
    );
    this.recording = recording;
  }

  async stop(): Promise<RecordingResult | null> {
    const recording = this.recording;
    if (!recording) return null;
    this.recording = null;
    try {
      await recording.stopAndUnloadAsync();
    } catch {
      // Already unloaded — the URI below is still valid.
    }
    // Hand the output route back to the speaker so TTS is audible afterwards.
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }).catch(
      () => {},
    );

    const uri = recording.getURI();
    if (!uri) return null;
    return { uri, durationMs: this.durationMs, meterSamples: [...this.samples] };
  }

  /** Abandons the take without returning it (used when a screen unmounts). */
  async cancel(): Promise<void> {
    const recording = this.recording;
    this.recording = null;
    if (recording) await recording.stopAndUnloadAsync().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Speech
// ---------------------------------------------------------------------------

export type SpeechTone = 'grounding' | 'activating' | 'steady';

let activeSound: Audio.Sound | null = null;

async function speakWithElevenLabs(text: string, tone: SpeechTone): Promise<void> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: tone === 'grounding' ? 0.75 : 0.5,
          similarity_boost: 0.75,
          // A slower, steadier delivery when the goal is to bring someone down.
          speed: tone === 'grounding' ? 0.9 : 1.0,
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs failed (${res.status})`);

  const bytes = new Uint8Array(await res.arrayBuffer());
  const file = new File(Paths.cache, `anchor-tts-${Date.now()}.mp3`);
  file.create({ overwrite: true });
  file.write(bytes);

  const { sound } = await Audio.Sound.createAsync({ uri: file.uri }, { shouldPlay: true });
  activeSound = sound;
  await new Promise<void>((resolve) => {
    sound.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded || status.didJustFinish) resolve();
    });
  });
  await sound.unloadAsync().catch(() => {});
  if (activeSound === sound) activeSound = null;
  try {
    file.delete();
  } catch {
    // Cache file; the OS will reclaim it.
  }
}

function speakWithDevice(text: string, tone: SpeechTone): Promise<void> {
  return new Promise((resolve) => {
    Speech.speak(text, {
      rate: tone === 'grounding' ? 0.88 : tone === 'activating' ? 0.95 : 1.0,
      pitch: 1.0,
      onDone: () => resolve(),
      onStopped: () => resolve(),
      onError: () => resolve(),
    });
  });
}

/** Resolves once the line has finished playing. Never throws. */
export async function speak(text: string, tone: SpeechTone = 'steady'): Promise<void> {
  if (!text.trim()) return;
  if (hasElevenLabs()) {
    try {
      await speakWithElevenLabs(text, tone);
      return;
    } catch {
      // Fall through to the on-device voice.
    }
  }
  await speakWithDevice(text, tone);
}

export async function stopSpeaking(): Promise<void> {
  Speech.stop();
  const sound = activeSound;
  activeSound = null;
  if (sound) await sound.stopAsync().catch(() => {});
}
