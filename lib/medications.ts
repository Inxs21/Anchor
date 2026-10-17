import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { dateKey, keyToDate, weekdayOf } from './dates';

export type Medication = {
  id: string;
  name: string;
  dosage: string;
  schedule: 'daily' | 'custom';
  days: number[]; // 0=Sun..6=Sat, used when schedule === 'custom'
  times: string[]; // 'HH:MM'; empty array = as-needed (PRN)
  createdAt?: unknown;
};

export type MedDraft = Omit<Medication, 'id' | 'createdAt'>;

export type DayDose = {
  id: string; // `${medId}_${time}` or `${medId}_prn_${ts}`
  medId: string;
  medName: string;
  dosage: string;
  time: string; // '' for PRN
  scheduled: boolean;
  status: 'pending' | 'taken' | 'missed';
  takenAt?: number;
};

type StoredDose = {
  key: string;
  medId: string;
  medName: string;
  time: string;
  status: 'taken' | 'missed';
  takenAt?: number;
};

export type DayLog = {
  date: string;
  doses: DayDose[];
};

const GRACE_MINUTES = 60;

const medsCol = (uid: string) => collection(db, 'users', uid, 'medications');
const medRef = (uid: string, id: string) => doc(db, 'users', uid, 'medications', id);
const logRef = (uid: string, key: string) => doc(db, 'users', uid, 'logs', key);

export async function getMedications(uid: string): Promise<Medication[]> {
  const snap = await getDocs(medsCol(uid));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Medication, 'id'>) }));
}

export async function addMedication(uid: string, draft: MedDraft): Promise<string> {
  const sorted = [...draft.times].sort();
  const ref = await addDoc(medsCol(uid), { ...draft, times: sorted, createdAt: serverTimestamp() });
  return ref.id;
}

export async function deleteMedication(uid: string, id: string): Promise<void> {
  await deleteDoc(medRef(uid, id));
}

async function getStoredDoses(uid: string, key: string): Promise<StoredDose[]> {
  const snap = await getDoc(logRef(uid, key));
  if (!snap.exists()) return [];
  const data = snap.data() as { doses?: StoredDose[] };
  return data.doses ?? [];
}

async function saveStoredDoses(uid: string, key: string, doses: StoredDose[]): Promise<void> {
  await setDoc(logRef(uid, key), { date: key, doses }, { merge: true });
}

function scheduledDosesFor(med: Medication, key: string): string[] {
  if (med.times.length === 0) return [];
  if (med.schedule === 'custom') {
    return med.days.includes(weekdayOf(key)) ? med.times : [];
  }
  return med.times;
}

function minutesSinceMidnight(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Builds the day's doses: scheduled expectations merged with stored take/missed
 * entries. Pending doses past their 60-minute grace window are marked missed and
 * persisted (best effort), so history stays accurate for reports.
 */
export async function getDayLog(uid: string, key: string = dateKey()): Promise<DayLog> {
  const [meds, stored] = await Promise.all([getMedications(uid), getStoredDoses(uid, key)]);
  const storedByKey = new Map(stored.map((s) => [s.key, s]));

  const doses: DayDose[] = [];
  const newMisses: StoredDose[] = [];

  const now = new Date();
  const isToday = key === dateKey();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const pastDay = key < dateKey(); // YYYY-MM-DD compares correctly as a string

  for (const med of meds) {
    for (const time of scheduledDosesFor(med, key)) {
      const doseId = `${med.id}_${time}`;
      const existing = storedByKey.get(doseId);
      if (existing) {
        doses.push({
          id: doseId,
          medId: med.id,
          medName: med.name,
          dosage: med.dosage,
          time,
          scheduled: true,
          status: existing.status,
          takenAt: existing.takenAt,
        });
        continue;
      }
      const missed = pastDay || (isToday && nowMinutes > minutesSinceMidnight(time) + GRACE_MINUTES);
      const status: DayDose['status'] = missed ? 'missed' : 'pending';
      if (missed) {
        newMisses.push({ key: doseId, medId: med.id, medName: med.name, time, status: 'missed' });
      }
      doses.push({
        id: doseId,
        medId: med.id,
        medName: med.name,
        dosage: med.dosage,
        time,
        scheduled: true,
        status,
      });
    }
  }

  // PRN (as-needed) doses and any stored entries for meds that were deleted later
  for (const s of stored) {
    if (doses.some((d) => d.id === s.key)) continue;
    doses.push({
      id: s.key,
      medId: s.medId,
      medName: s.medName,
      dosage: '',
      time: s.time,
      scheduled: false,
      status: s.status,
      takenAt: s.takenAt,
    });
  }

  doses.sort((a, b) => a.time.localeCompare(b.time) || a.medName.localeCompare(b.medName));

  if (newMisses.length > 0) {
    saveStoredDoses(uid, key, [...stored, ...newMisses]).catch(() => {});
  }

  return { date: key, doses };
}

export async function markDoseTaken(uid: string, dose: DayDose, when = new Date()): Promise<void> {
  const key = dateKey(when);
  const stored = await getStoredDoses(uid, key);
  const entry: StoredDose = {
    key: dose.id,
    medId: dose.medId,
    medName: dose.medName,
    time: dose.time,
    status: 'taken',
    takenAt: when.getTime(),
  };
  const next = stored.filter((s) => s.key !== dose.id);
  next.push(entry);
  await saveStoredDoses(uid, key, next);
}

export async function undoDose(uid: string, key: string, doseId: string): Promise<void> {
  const stored = await getStoredDoses(uid, key);
  const next = stored.filter((s) => s.key !== doseId);
  await saveStoredDoses(uid, key, next);
}

export type AdherenceDay = { date: string; taken: number; missed: number; pending: number };
export type AdherenceSummary = {
  days: AdherenceDay[];
  taken: number;
  missed: number;
  rate: number; // taken / (taken + missed), 0 when no data
};

export async function getAdherence(uid: string, dayKeys: string[]): Promise<AdherenceSummary> {
  const days: AdherenceDay[] = [];
  let taken = 0;
  let missed = 0;
  for (const key of dayKeys) {
    const log = await getDayLog(uid, key);
    const t = log.doses.filter((d) => d.status === 'taken').length;
    const m = log.doses.filter((d) => d.status === 'missed').length;
    const p = log.doses.filter((d) => d.status === 'pending').length;
    days.push({ date: key, taken: t, missed: m, pending: p });
    taken += t;
    missed += m;
  }
  const denom = taken + missed;
  return { days, taken, missed, rate: denom > 0 ? taken / denom : 0 };
}
