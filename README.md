# Anchor

Early-warning and daily support for people living with bipolar disorder — built for DubHacks / Seattle Div Hackathon.

**The problem.** 1 in 200 people worldwide live with bipolar disorder (~37 million). Up to 40% are
misdiagnosed first. Specialists are scarce, waitlists are long, and the people least likely to reach
one — uninsured, low income, students in families where mental health carries stigma — are the ones
most likely to miss the early signs of an episode until it has already cost them something.

**The idea.** Episodes have a prodrome. It is visible days before the crisis, in sleep, in mood, and
measurably in the voice. Anchor watches for *your* prodrome — not a textbook one — and tells you
early enough to act.

## How it works

1. **Episode fingerprinting.** During onboarding you say what *your* mania and *your* depression
   actually look like. That fingerprint is injected into every single model call, so the AI reasons
   about your pattern rather than a generic patient.
2. **Conversational voice check-in.** The companion asks 4–5 questions out loud. You answer out
   loud. Each answer is transcribed and analysed for vocal prosody — speech rate, pitch variance,
   energy, emotional valence. If the words do not come through, you are offered a box to type
   roughly what you said rather than the app storing silence.
3. **Discrepancy detection.** The most useful signal in the app: you check in as "fine" while your
   voice reads activated or flattened — or while the words you used lean much further one way than
   the slider did. Anchor names that gap gently, and weights it heavily in risk.
   The reading itself is **deterministic heuristics**, not a model call: the same inputs give the
   same state, risk and wording every time, so the trend across days stays readable. Crisis language
   in a transcript overrides everything else and puts 988 and a real person first.
4. **Polarity-aware companion.** Tone is calibrated automatically — calm and grounding when signals
   point manic, warm and low-pressure when they point depressive.
5. **Prodrome alerts.** Three or more consecutive days leaning the same direction triggers a push
   notification written in your own terms. Deduplicated, so it never nags.
6. **Medication adherence.** One-tap logging. Missed doses are never a notification — the companion
   mentions them once, conversationally, and they land in the doctor's report.
7. **Psychiatrist report.** 30 days as a one-page PDF: mood, sleep consistency, adherence, voice
   trends, alerts fired — with a plain-language narrative on top a clinician can read in 30 seconds.

## Stack

| Layer | Choice |
|---|---|
| App | React Native · Expo Router (SDK 54) |
| Data | Firebase Auth + Firestore |
| Analysis | Heuristics in `lib/analysis.ts`, optionally layered with Gemini or Groq (`lib/llm.ts`) |
| Conversation | Claude (`claude-sonnet-5-5`) via `@anthropic-ai/sdk`, optional |
| Voice biomarkers | On-device prosody from `expo-av` metering + transcript word rate |
| Speech-to-text | ElevenLabs Scribe |
| Text-to-speech | ElevenLabs, falling back to on-device TTS |
| Report | `expo-print` → PDF, inline SVG charts |

## Running it

```bash
npm install
npx expo start
```

The voice check-in needs microphone access, so use a development build or a device rather than a
web preview.

### API keys are optional

Copy `.env.example` to `.env` and fill in whatever you have:

```
EXPO_PUBLIC_GEMINI_API_KEY=
EXPO_PUBLIC_GROQ_API_KEY=
EXPO_PUBLIC_ANTHROPIC_API_KEY=
EXPO_PUBLIC_HUME_API_KEY=
EXPO_PUBLIC_ELEVENLABS_API_KEY=
EXPO_PUBLIC_ELEVENLABS_VOICE_ID=
```

**Every provider is optional and degrades gracefully**, so the app is fully demoable with no
credentials at all:

- **No Gemini or Groq key** → the daily reading is decided entirely by the heuristics. With
  either key set (Gemini wins if both are), the model rewords the reading and may raise the risk,
  but never lowers it below what the numbers justify and never touches the crisis response.
  Both providers have a free tier: [Gemini](https://aistudio.google.com/apikey),
  [Groq](https://console.groq.com/keys).
- **No Anthropic key** → companion replies and the report narrative fall back to deterministic
  local copy. The daily reading does not depend on it either way.
- **No Hume key** → prosody is measured on-device from `expo-av` amplitude metering plus speech rate
  derived from the transcript. Coarser, but real measurement rather than a placebo.
  Note that Hume's Expression Measurement batch API now answers `403 ... discontinued`, so this
  on-device path is the one that actually runs. The Hume client in `lib/hume.ts` is kept behind the
  key check in case the endpoint returns.
- **No ElevenLabs key** → the companion speaks through the platform's own synthesizer, and spoken
  answers are not transcribed. The check-in still completes and still saves; you are offered a text
  box to type what you said, which restores the word count that speech rate is derived from.

A check-in never fails on a provider. Transcription, prosody and narrative are each allowed to
return nothing, and the day is still saved.

> ⚠️ The keys are `EXPO_PUBLIC_*`, which means they ship in the client bundle. That is fine for a
> hackathon build and **must** move behind a server before any real deployment.

## Checks

```bash
npm run check
```

Runs three things, none of which need a device, a network, or a key:

- `check:analysis` — 39 assertions over the pure analysis logic: classification, risk scoring,
  discrepancy detection, transcript phrase signals and crisis handling, measure-to-word banding,
  and prodrome streak edge cases (polarity flips, mixed days, stale runs).
- `check:report` — renders the psychiatrist report from synthetic data to `dist-report/report.html`
  and asserts its structure. Open that file to review the layout exactly as the PDF will render it.
- `tsc --noEmit`.

## Layout

```
app/
  (auth)/          sign in / sign up
  (onboarding)/    episode fingerprint → medications
  (tabs)/          Home · Talk · Meds · Report
  checkin.tsx      self-report → spoken questions → analysis
  report.tsx       psychiatrist report builder
lib/
  analysis.ts      pure logic — zero imports, fully testable
  claude.ts        prompts and companion conversation (analysis is heuristic)
  hume.ts          prosody via Hume, with on-device fallback
  llm.ts           optional Gemini / Groq reading, heuristics as the floor
  stt.ts           speech-to-text via ElevenLabs Scribe, optional
  voice.ts         recording + TTS
  prodrome.ts      streak detection and alert delivery
  reportHtml.ts    report document + inline SVG charts
  report.ts        PDF rendering and sharing
```

`lib/analysis.ts` imports nothing on purpose: it keeps the logic that decides what a day *means*
testable outside the app, and guarantees the no-key path works.

## Honest limits

- Vocal measures are normalised per-sample, not calibrated against a clinical baseline. They show
  change over time for one person; they are not a diagnostic.
- Alerts are pattern notifications, not diagnoses, and the app says so everywhere it can.
- The companion is instructed never to diagnose or give medication advice, and to route anything
  involving self-harm or psychosis to 988 and to a real human immediately.
