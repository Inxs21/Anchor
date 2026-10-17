/**
 * Medication data layer.
 *
 * All Firestore access is centralised here. The UI, AI companion, and report
 * features import these functions — they never touch Firestore directly.
 * If the data source changes, only this file needs to be updated.
 *
 * Firestore schema
 * ─────────────────
 * users/{uid}/medications/{medId}
 *   name:      string
 *   dosage:    string          e.g. "200 mg"
 *   schedule:  Schedule        e.g. "daily"
 *   times:     string[]        e.g. ["08:00","21:00"]  (24-hr HH:MM, empty for as_needed)
 *   weekDay:   number | null   0=Sun … 6=Sat, only used when schedule="weekly"
 *
 * users/{uid}/medicationLogs/{dateStr}   dateStr = "YYYY-MM-DD"
 *   doses: Record<doseKey, DoseLog>
 *     doseKey = "{medId}_{time}"   (for as_needed: "{medId}_manual_{timestamp}")
 */

import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  deleteField,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Schedule = "daily" | "twice_daily" | "weekly" | "as_needed" | "custom";

export type Medication = {
  id: string;
  name: string;
  dosage: string;
  schedule: Schedule;
  times: string[];      // HH:MM 24-hr; empty for as_needed
  weekDay: number | null; // 0–6; only set when schedule === "weekly"
};

export type DoseStatus = "pending" | "taken" | "missed";

export type DoseLog = {
  medId: string;
  medName: string;
  scheduledTime: string; // "08:00" or "manual" for as_needed
  status: DoseStatus;
  takenAt: Timestamp | null;
};

export type DailyLog = {
  date: string;
  doses: Record<string, DoseLog>;
};

export type AdherenceData = {
  totalDoses: number;
  takenDoses: number;
  missedDoses: number;
  adherenceRate: number; // 0–1
  missedDoseDetails: (DoseLog & { date: string })[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

export function doseKey(medId: string, time: string): string {
  return `${medId}_${time}`;
}

export function formatTime(time24: string): string {
  if (time24 === "manual") return "As needed";
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${period}`;
}

export function scheduleLabel(s: Schedule): string {
  switch (s) {
    case "daily":       return "Daily";
    case "twice_daily": return "Twice Daily";
    case "weekly":      return "Weekly";
    case "as_needed":   return "As Needed";
    case "custom":      return "Custom";
  }
}

/** True if the scheduled HH:MM is more than `graceMinutes` in the past today */
function isPast(scheduledTime: string, graceMinutes = 60): boolean {
  if (scheduledTime === "manual") return false;
  const [h, m] = scheduledTime.split(":").map(Number);
  const now = new Date();
  const scheduled = new Date();
  scheduled.setHours(h, m, 0, 0);
  return now.getTime() - scheduled.getTime() > graceMinutes * 60 * 1000;
}

/** True if a medication should generate doses on the given date */
function isScheduledForDate(med: Medication, dateStr: string): boolean {
  if (med.schedule === "as_needed") return false; // never auto-generates
  if (med.schedule === "weekly") {
    const dayOfWeek = new Date(dateStr + "T12:00:00").getDay(); // avoid TZ edge
    return med.weekDay === dayOfWeek;
  }
  return true; // daily + twice_daily always generate
}

// ─── Medication CRUD ──────────────────────────────────────────────────────────

export async function getMedications(uid: string): Promise<Medication[]> {
  const snap = await getDocs(collection(db, "users", uid, "medications"));
  return snap.docs.map((d) => ({
    schedule: "daily" as Schedule, // default for legacy docs
    weekDay: null,
    ...(d.data() as any),
    id: d.id,
  } as Medication));
}

export async function addMedication(
  uid: string,
  med: Omit<Medication, "id">
): Promise<Medication> {
  const ref = await addDoc(collection(db, "users", uid, "medications"), med);
  return { id: ref.id, ...med };
}

export async function deleteMedication(uid: string, medId: string): Promise<void> {
  await deleteDoc(doc(db, "users", uid, "medications", medId));
}

/** Remove all doses for a medication from a specific day's log */
export async function removeMedDosesFromLog(
  uid: string,
  dateStr: string,
  medId: string
): Promise<void> {
  const logRef = doc(db, "users", uid, "medicationLogs", dateStr);
  const snap = await getDoc(logRef);
  if (!snap.exists()) return;

  const log = snap.data() as DailyLog;
  const patch: Record<string, ReturnType<typeof deleteField>> = {};
  for (const key of Object.keys(log.doses)) {
    if (key.startsWith(`${medId}_`)) {
      patch[`doses.${key}`] = deleteField();
    }
  }
  if (Object.keys(patch).length > 0) await updateDoc(logRef, patch);
}

// ─── Daily Log ────────────────────────────────────────────────────────────────

/**
 * Load (or create) today's dose log.
 *
 * Key fix: if the log already exists, we still check for any medications
 * that don't have entries yet (e.g. just added) and merge them in.
 * Also auto-marks overdue pending doses as missed.
 */
export async function getDailyLog(uid: string, dateStr: string): Promise<DailyLog> {
  const logRef = doc(db, "users", uid, "medicationLogs", dateStr);
  const [logSnap, medications] = await Promise.all([
    getDoc(logRef),
    getMedications(uid),
  ]);

  // Build the full set of expected dose keys for this date
  const expectedDoses: Record<string, DoseLog> = {};
  for (const med of medications) {
    if (!isScheduledForDate(med, dateStr)) continue;
    for (const time of med.times) {
      const key = doseKey(med.id, time);
      expectedDoses[key] = {
        medId: med.id,
        medName: med.name,
        scheduledTime: time,
        status: isPast(time) ? "missed" : "pending",
        takenAt: null,
      };
    }
  }

  if (!logSnap.exists()) {
    const log: DailyLog = { date: dateStr, doses: expectedDoses };
    if (Object.keys(expectedDoses).length > 0) await setDoc(logRef, log);
    return log;
  }

  const log = logSnap.data() as DailyLog;

  const activeMedIds = new Set(medications.map((m) => m.id));

  // ── Remove doses for medications that no longer exist ──
  const stalePatch: Record<string, ReturnType<typeof deleteField>> = {};
  for (const key of Object.keys(log.doses)) {
    const medId = key.split("_")[0];
    if (!activeMedIds.has(medId)) {
      stalePatch[`doses.${key}`] = deleteField();
      delete log.doses[key];
    }
  }

  // ── Merge in any new medications added after the log was first created ──
  const newDosesPatch: Record<string, unknown> = {};
  for (const [key, dose] of Object.entries(expectedDoses)) {
    if (!log.doses[key]) {
      log.doses[key] = dose;
      newDosesPatch[`doses.${key}`] = dose;
    }
  }

  // ── Auto-mark overdue pending doses as missed ──
  const missedPatch: Record<string, DoseStatus> = {};
  for (const [key, dose] of Object.entries(log.doses)) {
    if (dose.status === "pending" && isPast(dose.scheduledTime)) {
      missedPatch[`doses.${key}.status`] = "missed";
      log.doses[key].status = "missed";
    }
  }

  const combined = { ...stalePatch, ...newDosesPatch, ...missedPatch };
  if (Object.keys(combined).length > 0) await updateDoc(logRef, combined);

  return log;
}

/** Mark a single dose as taken */
export async function markDoseTaken(
  uid: string,
  dateStr: string,
  key: string
): Promise<void> {
  const logRef = doc(db, "users", uid, "medicationLogs", dateStr);
  await updateDoc(logRef, {
    [`doses.${key}.status`]: "taken",
    [`doses.${key}.takenAt`]: Timestamp.now(),
  });
}

/** Log an as-needed dose taken right now */
export async function logAsNeededDose(
  uid: string,
  dateStr: string,
  med: Medication
): Promise<string> {
  const key = doseKey(med.id, `manual_${Date.now()}`);
  const logRef = doc(db, "users", uid, "medicationLogs", dateStr);
  const dose: DoseLog = {
    medId: med.id,
    medName: med.name,
    scheduledTime: "manual",
    status: "taken",
    takenAt: Timestamp.now(),
  };

  const snap = await getDoc(logRef);
  if (snap.exists()) {
    await updateDoc(logRef, { [`doses.${key}`]: dose });
  } else {
    await setDoc(logRef, { date: dateStr, doses: { [key]: dose } });
  }
  return key;
}

// ─── Adherence (for AI companion + report) ───────────────────────────────────

export async function getAdherenceData(
  uid: string,
  days: number = 30
): Promise<AdherenceData> {
  let totalDoses = 0;
  let takenDoses = 0;
  let missedDoses = 0;
  const missedDoseDetails: (DoseLog & { date: string })[] = [];

  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];

    const snap = await getDoc(doc(db, "users", uid, "medicationLogs", dateStr));
    if (!snap.exists()) continue;

    const log = snap.data() as DailyLog;
    for (const dose of Object.values(log.doses)) {
      if (dose.status === "pending") continue;
      totalDoses++;
      if (dose.status === "taken") takenDoses++;
      if (dose.status === "missed") {
        missedDoses++;
        missedDoseDetails.push({ ...dose, date: dateStr });
      }
    }
  }

  return {
    totalDoses,
    takenDoses,
    missedDoses,
    adherenceRate: totalDoses > 0 ? takenDoses / totalDoses : 1,
    missedDoseDetails,
  };
}

export async function getRecentMissedCount(
  uid: string,
  days: number = 7
): Promise<number> {
  const data = await getAdherenceData(uid, days);
  return data.missedDoses;
}
