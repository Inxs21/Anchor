/**
 * Conversation data layer.
 *
 * Stores voice conversation transcripts, Hume emotion prosody data,
 * and Claude-generated clinical mood analyses in Firestore.
 *
 * Firestore schema
 * ─────────────────
 * users/{uid}/conversations/{convoId}
 *   startedAt:   Timestamp
 *   endedAt:     Timestamp
 *   messages:    ConvoMessage[]
 *   analysis:    MoodAnalysis | null
 */

import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  orderBy,
  limit,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmotionScores = {
  joy: number;
  sadness: number;
  anger: number;
  fear: number;
  disgust: number;
  contempt: number;
  surprise: number;
  confusion: number;
  interest: number;
  boredom: number;
  excitement: number;
  concentration: number;
  [key: string]: number;
};

export type ConvoMessage = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  emotions?: Partial<EmotionScores>;
};

export type MoodIndicator =
  | "manic"
  | "hypomanic"
  | "euthymic"
  | "mild_depression"
  | "moderate_depression"
  | "severe_depression";

export type SpeechPatterns = {
  pressuredSpeech: number;       // 0-10: rapid, hard-to-interrupt speech
  povertyOfSpeech: number;       // 0-10: reduced speech output
  flightOfIdeas: number;         // 0-10: rapid topic shifting
  tangentialThinking: number;    // 0-10: going off-topic
  circumstantiality: number;     // 0-10: excessive detail before reaching point
  wordSaladRisk: number;         // 0-10: disorganized speech
  wordsPerMinute: number;        // speech rate
  shortResponseRatio: number;    // 0-1: fraction of responses under 5 words
  topicCoherence: number;        // 0-10: how well responses stay on-topic
  ruminationScore: number;       // 0-10: repetitive negative themes
};

export type ContentAnalysis = {
  grandiosity: number;           // 0-10
  hopelessness: number;          // 0-10
  worthlessness: number;         // 0-10
  excessiveGuilt: number;        // 0-10
  suicidalIdeation: boolean;
  anhedonia: number;             // 0-10: loss of interest/pleasure
  irritability: number;          // 0-10
  anxietyLevel: number;          // 0-10
  selfCriticism: number;         // 0-10
  racingThoughts: boolean;
};

export type BehavioralIndicators = {
  sleepChanges: string | null;
  appetiteChanges: string | null;
  energyLevel: number;           // 0-10
  socialEngagement: number;      // 0-10
  psychomotorChanges: string | null;
  goalDirectedActivity: number;  // 0-10
};

export type BipolarIndices = {
  manicIndex: number;            // 0-1: composite manic signal strength
  depressiveIndex: number;       // 0-1: composite depressive signal strength
  mixedStateFlag: boolean;       // agitated depression or dysphoric mania
};

export type ProsodyMetrics = {
  emotionalRange: number;        // 0-1: max - min emotion score (flat vs animated)
  emotionVariance: number;       // std dev of emotion scores (blunted vs labile)
  dominantValencePolarity: number; // -1 to 1: positive vs negative emotion balance
};

export type MoodAnalysis = {
  overallMoodIndicator: MoodIndicator;
  confidenceScore: number;       // 0-1
  summary: string;
  clinicalNotes: string;
  speechPatterns: SpeechPatterns;
  contentAnalysis: ContentAnalysis;
  behavioralIndicators: BehavioralIndicators;
  bipolarIndices: BipolarIndices;
  prosodyMetrics: ProsodyMetrics;
  riskFlags: string[];
  recommendations: string[];
  topEmotions: { name: string; score: number }[];
};

export type ConversationRecord = {
  id: string;
  startedAt: Timestamp;
  endedAt: Timestamp;
  messages: ConvoMessage[];
  analysis: MoodAnalysis | null;
};

// ─── Firestore Operations ─────────────────────────────────────────────────────

export async function saveConversation(
  uid: string,
  messages: ConvoMessage[],
  startedAt: Date
): Promise<string> {
  const ref = await addDoc(collection(db, "users", uid, "conversations"), {
    startedAt: Timestamp.fromDate(startedAt),
    endedAt: Timestamp.now(),
    messages,
    analysis: null,
  });
  return ref.id;
}

export async function updateConversationAnalysis(
  uid: string,
  convoId: string,
  analysis: MoodAnalysis
): Promise<void> {
  const ref = doc(db, "users", uid, "conversations", convoId);
  await updateDoc(ref, { analysis });
}

export async function getConversation(
  uid: string,
  convoId: string
): Promise<ConversationRecord | null> {
  const snap = await getDoc(doc(db, "users", uid, "conversations", convoId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as ConversationRecord;
}

export async function getRecentConversations(
  uid: string,
  count: number = 10
): Promise<ConversationRecord[]> {
  const q = query(
    collection(db, "users", uid, "conversations"),
    orderBy("endedAt", "desc"),
    limit(count)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ConversationRecord));
}
