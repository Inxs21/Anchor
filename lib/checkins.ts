import {
  doc, getDoc, setDoc, serverTimestamp,
  collection, getDocs, query, orderBy, limit,
} from 'firebase/firestore';
import { db } from './firebase';

// ─── Episode Fingerprint ──────────────────────────────────────────────────────

export type EpisodeFingerprint = {
  maniaSymptoms:      string[];
  depressionSymptoms: string[];
  completedAt?:       any;
};

export async function getEpisodeFingerprint(uid: string): Promise<EpisodeFingerprint | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'profile', 'episodeFingerprint'));
    return snap.exists() ? (snap.data() as EpisodeFingerprint) : null;
  } catch { return null; }
}

export async function saveEpisodeFingerprint(
  uid: string,
  fp: Omit<EpisodeFingerprint, 'completedAt'>,
): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'profile', 'episodeFingerprint'), {
    ...fp,
    completedAt: serverTimestamp(),
  });
}

// ─── Check-ins ────────────────────────────────────────────────────────────────

export type CheckinDoc = {
  date:        string;
  todayState:  'stable' | 'elevated' | 'low' | 'mixed';
  riskLevel:   'low' | 'medium' | 'high';
  insight:     string;
  flagged:     boolean;
  humeScores:  { energy: number; valence: number; arousal: number };
  topEmotions: { name: string; score: number }[];
  transcripts: string[];
  speechRate?: { wordsPerMinute: number; totalWordCount: number; avgResponseLength: number; avgResponseLatency: number; shortResponseRatio: number };
  prosody?:    { emotionalRange: number; emotionVariance: number; dominantValencePolarity: number };
  speechOrganization?: { topicCoherence: number; topicShiftCount: number; ruminationScore: number };
  contentThemes?:      { grandiosity: number; hopelessness: number; selfCriticism: number; racingThoughts: boolean; anhedonia: number };
  bipolarIndices?:     { manicIndex: number; depressiveIndex: number; mixedStateFlag: boolean };
  completedAt?: any;
};

export async function getTodayCheckin(uid: string, dateStr: string): Promise<CheckinDoc | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'checkins', dateStr));
    return snap.exists() ? (snap.data() as CheckinDoc) : null;
  } catch { return null; }
}

export async function getRecentCheckins(uid: string, count = 7): Promise<CheckinDoc[]> {
  try {
    const q = query(
      collection(db, 'users', uid, 'checkins'),
      orderBy('date', 'desc'),
      limit(count),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as CheckinDoc);
  } catch { return []; }
}

export async function getAllCheckins(uid: string): Promise<CheckinDoc[]> {
  try {
    const q = query(
      collection(db, 'users', uid, 'checkins'),
      orderBy('date', 'asc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as CheckinDoc);
  } catch { return []; }
}
