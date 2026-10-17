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
import { keyToDate, weekdayOf } from './dates';

export type Medication = {
  id: string;
  name: string;
  dosage: string;
  schedule: 'daily' | 'custom';
  days: number[]; // 0=Sun..6=Sat, ignored when schedule === 'daily'
  times: string[]; // "HH:MM"; empty = as-needed (PRN)
};

export type MedicationDraft = Omit<Medication, 'id'>;

export type DoseEntry = {
  key: string;
  medId: string;
  medName: string;
  time: string | null; // null = as-needed
  takenAt: number;
};

export type DoseSlot = {
  key: string;
  medId: string;
  medName: string;
  dosage: string;
  time: string;
  status: 'pending' | 'taken' | 'missed';
  takenAt?: number;
};

export type DayLog = { date: string; doses: DoseEntry[] };

const GRACE_MINUTES = 60;

const medsCol = (uid: string) => collection(db, 'users', uid, 'medications');
const medRef = (uid: string, id: string) => doc(db, 'users', uid, 'medications', id);
const logRef = (uid: string, key: string) => doc(db, 'users', uid, 'logs', key);

export function doseSlotKey(medId: string, time: string): string {
  return `${medId}_${time}`;
}

export function scheduledMedsForDay(meds: Medication[], key: string): Medication[] {
  const weekday = weekdayOf(key);
  return meds.filter((m) => m.schedule === 'daily' || m.days.includes(weekday));
}

// Pure: derives today's (or any day's) dose slots from meds + stored log.
// Missed is derived from the absence of a "taken" entry past the grace window.
export function buildSlots(
  meds: Medication[],
  key: string,
  log: DayLog,
  now: Date,
): DoseSlot[] {
  const takenByKey = new Map(log.doses.filter((d) => d.time !== null).map((d) => [d.key, d]));
  const slots: DoseSlot[] = [];
  const isPast = key < `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
  const isToday = key === dateKeyOf(now);

  for (const med of scheduledMedsForDay(meds, key)) {
    for (const time of med.times) {
      const k = doseSlotKey(med.id, time);
      const entry = takenByKey.get(k);
      if (entry) {
        slots.push({ key: k, medId: med.id, medName: med.name, dosage: med.dosage, time, status: 'taken', takenAt: entry.takenAt });
        continue;
      }
      const due = keyToDate(key);
      const [h, m] = time.split(':').map(Number);
      due.setHours(h, m, 0, 0);
      const overdue = now.getTime() - due.getTime() > GRACE_MINUTES * 60_000;
      const status: DoseSlot['status'] = (isPast || (isToday && overdue)) ? 'missed' : 'pending';
      slots.push({ key: k, medId: med.id, medName: med.name, dosage: med.dosage, time, status });
    }
  }
  return slots.sort((a, b) => a.time.localeCompare(b.time));
}

function dateKeyOf(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export async function getMedications(uid: string): Promise<Medication[]> {
  const snap = await getDocs(medsCol(uid));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Medication, 'id'>) }));
}

export async function addMedication(uid: string, draft: MedicationDraft): Promise<string> {
  const times = [...draft.times].sort();
  const ref = await addDoc(medsCol(uid), { ...draft, times, createdAt: serverTimestamp() });
  return ref.id;
}

export async function deleteMedication(uid: string, id: string): Promise<void> {
  await deleteDoc(medRef(uid, id));
}

export async function getDayLog(uid: string, key: string): Promise<DayLog> {
  const snap = await getDoc(logRef(uid, key));
  if (!snap.exists()) return { date: key, doses: [] };
  const data = snap.data() as { date: string; doses?: DoseEntry[] };
  return { date: data.date ?? key, doses: data.doses ?? [] };
}

async function writeLog(uid: string, key: string, log: DayLog): Promise<void> {
  await setDoc(logRef(uid, key), { date: key, doses: log.doses });
}

export async function takeDose(uid: string, key: string, slot: Omit<DoseSlot, 'status' | 'key'>): Promise<void> {
  const log = await getDayLog(uid, key);
  const k = doseSlotKey(slot.medId, slot.time);
  const entry: DoseEntry = {
    key: k,
    medId: slot.medId,
    medName: slot.medName,
    time: slot.time,
    takenAt: Date.now(),
  };
  const doses = log.doses.filter((d) => d.key !== k);
  doses.push(entry);
  await writeLog(uid, key, { ...log, doses });
}

export async function undoDose(uid: string, key: string, doseKey: string): Promise<void> {
  const log = await getDayLog(uid, key);
  const doses = log.doses.filter((d) => d.key !== doseKey);
  await writeLog(uid, key, { ...log, doses });
}

export async function logPrnDose(uid: string, key: string, med: Medication): Promise<void> {
  const log = await getDayLog(uid, key);
  const entry: DoseEntry = {
    key: `${med.id}_prn_${Date.now()}`,
    medId: med.id,
    medName: med.name,
    time: null,
    takenAt: Date.now(),
  };
  await writeLog(uid, key, { ...log, doses: [...log.doses, entry] });
}

export function prnDosesForDay(meds: Medication[], log: DayLog): DoseEntry[] {
  const prnIds = new Set(meds.filter((m) => m.times.length === 0).map((m) => m.id));
  return log.doses.filter((d) => d.time === null && prnIds.has(d.medId));
}

export type Adherence = { taken: number; missed: number; rate: number };

// Single source of truth for adherence (shared by Home, Meds and Report).
export async function getAdherence(uid: string, dayKeys: string[]): Promise<Adherence> {
  const [meds, logs] = await Promise.all([
    getMedications(uid),
    Promise.all(dayKeys.map((k) => getDayLog(uid, k))),
  ]);
  const now = new Date();
  let taken = 0;
  let missed = 0;
  dayKeys.forEach((key, i) => {
    for (const slot of buildSlots(meds, key, logs[i], now)) {
      if (slot.status === 'taken') taken++;
      else if (slot.status === 'missed') missed++;
    }
  });
  const total = taken + missed;
  return { taken, missed, rate: total === 0 ? 1 : taken / total };
}
