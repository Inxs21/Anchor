import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { dateKey, lastNDays } from './dates';

export type {
  Analysis,
  CheckIn,
  CheckInDraft,
  VoiceScores,
  VoiceTurn,
} from './analysis';
export { averageVoice, classify, describeMeasure, riskBand } from './analysis';

import type { CheckIn, CheckInDraft } from './analysis';

type DayDoc = { date?: string; checkin?: CheckIn };

const logRef = (uid: string, key: string) => doc(db, 'users', uid, 'logs', key);

export async function getCheckIn(uid: string, key: string = dateKey()): Promise<CheckIn | null> {
  const snap = await getDoc(logRef(uid, key));
  if (!snap.exists()) return null;
  return (snap.data() as DayDoc).checkin ?? null;
}

export async function saveCheckIn(
  uid: string,
  draft: CheckInDraft,
  key: string = dateKey(),
): Promise<CheckIn> {
  const checkin: CheckIn = { ...draft, date: key, createdAt: Date.now() };
  // Merge so the medication doses already stored on this day's doc survive.
  await setDoc(logRef(uid, key), { date: key, checkin }, { merge: true });
  return checkin;
}

/** Oldest → newest. Days without a check-in are simply absent. */
export async function getRecentCheckIns(uid: string, days = 30): Promise<CheckIn[]> {
  const keys = lastNDays(days);
  const col = collection(db, 'users', uid, 'logs');
  try {
    const snap = await getDocs(query(col, where('date', '>=', keys[0])));
    const found = snap.docs
      .map((d) => (d.data() as DayDoc).checkin)
      .filter((c): c is CheckIn => !!c && keys.includes(c.date));
    found.sort((a, b) => a.date.localeCompare(b.date));
    return found;
  } catch {
    // Range query can fail offline or before the index warms — fall back to point reads.
    const results = await Promise.all(keys.map((k) => getCheckIn(uid, k).catch(() => null)));
    return results.filter((c): c is CheckIn => !!c);
  }
}

