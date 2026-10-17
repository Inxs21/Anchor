import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export type EpisodeFingerprint = {
  maniaSymptoms: string[];
  depressionSymptoms: string[];
  completedAt?: unknown;
};

const fingerprintRef = (uid: string) => doc(db, 'users', uid, 'profile', 'episodeFingerprint');

export async function getFingerprint(uid: string): Promise<EpisodeFingerprint | null> {
  const snap = await getDoc(fingerprintRef(uid));
  return snap.exists() ? (snap.data() as EpisodeFingerprint) : null;
}

export async function saveFingerprint(
  uid: string,
  fp: { maniaSymptoms: string[]; depressionSymptoms: string[] },
): Promise<void> {
  await setDoc(
    fingerprintRef(uid),
    { maniaSymptoms: fp.maniaSymptoms, depressionSymptoms: fp.depressionSymptoms, completedAt: serverTimestamp() },
    { merge: true },
  );
}
