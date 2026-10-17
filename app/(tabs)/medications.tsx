import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Alert,
  Animated,
  PanResponder,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { Ocean } from "@/constants/theme";
import {
  getMedications,
  addMedication,
  deleteMedication,
  removeMedDosesFromLog,
  getDailyLog,
  markDoseTaken,
  logAsNeededDose,
  formatTime,
  scheduleLabel,
  todayStr,
  type Medication,
  type DailyLog,
  type DoseLog,
  type Schedule,
} from "@/lib/medications";

// ─── Constants ────────────────────────────────────────────────────────────────

const DOSE_UNITS: string[] = ["mg", "mcg", "g", "ml", "IU", "tablet(s)", "capsule(s)"];
const SCHEDULES: Schedule[] = ["daily", "twice_daily", "weekly", "custom", "as_needed"];
const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type NewMed = {
  name: string;
  doseAmount: string;
  doseUnit: string;
  schedule: Schedule;
  times: string[];
  weekDay: number;
};

const EMPTY_MED: NewMed = {
  name: "",
  doseAmount: "",
  doseUnit: "mg",
  schedule: "daily",
  times: ["08:00"],
  weekDay: new Date().getDay(),
};

// ─── Time helpers ─────────────────────────────────────────────────────────────

function parse24(t: string) {
  const [h, m] = t.split(":").map(Number);
  return { hour12: h % 12 || 12, minute: Math.round(m / 5) * 5, isPM: h >= 12 };
}
function to24(hour12: number, minute: number, isPM: boolean) {
  let h = hour12 % 12;
  if (isPM) h += 12;
  return `${h.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function getNextDoseText(doses: Record<string, DoseLog>): string | null {
  const now = new Date();
  const upcoming = Object.values(doses)
    .filter((d) => d.status === "pending" && d.scheduledTime !== "manual")
    .map((d) => {
      const [h, m] = d.scheduledTime.split(":").map(Number);
      const t = new Date();
      t.setHours(h, m, 0, 0);
      return t;
    })
    .filter((t) => t > now)
    .sort((a, b) => a.getTime() - b.getTime());

  if (!upcoming.length) return null;
  const diffMin = Math.round((upcoming[0].getTime() - now.getTime()) / 60000);
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  if (h === 0) return `Next dose in ${m}m`;
  if (m === 0) return `Next dose in ${h}h`;
  return `Next dose in ${h}h ${m}m`;
}

// ─── Circular Progress ────────────────────────────────────────────────────────

function CircularProgress({
  progress, size = 64, stroke = 6, color, bg, children,
}: {
  progress: number; size?: number; stroke?: number; color: string; bg: string; children?: React.ReactNode;
}) {
  const p = Math.min(1, Math.max(0, progress));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          position: "absolute", width: size, height: size, borderRadius: size / 2,
          borderWidth: stroke,
          borderTopColor:    p > 0    ? color : bg,
          borderRightColor:  p > 0.25 ? color : bg,
          borderBottomColor: p > 0.5  ? color : bg,
          borderLeftColor:   p > 0.75 ? color : bg,
          transform: [{ rotate: "-45deg" }],
        }}
      />
      {children}
    </View>
  );
}

// ─── Time Picker ──────────────────────────────────────────────────────────────

function SpinnerCol({ value, onInc, onDec }: { value: string; onInc: () => void; onDec: () => void }) {
  return (
    <View style={sp.col}>
      <TouchableOpacity onPress={onInc} hitSlop={10} style={sp.arrowBtn}><Text style={sp.arrow}>▲</Text></TouchableOpacity>
      <View style={sp.valueBox}><Text style={sp.valueText}>{value}</Text></View>
      <TouchableOpacity onPress={onDec} hitSlop={10} style={sp.arrowBtn}><Text style={sp.arrow}>▼</Text></TouchableOpacity>
    </View>
  );
}

function TimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { hour12, minute, isPM } = parse24(value);
  return (
    <View style={sp.container}>
      <SpinnerCol value={hour12.toString()} onInc={() => onChange(to24((hour12 % 12) + 1, minute, isPM))} onDec={() => onChange(to24(hour12 === 1 ? 12 : hour12 - 1, minute, isPM))} />
      <Text style={sp.colon}>:</Text>
      <SpinnerCol value={minute.toString().padStart(2, "0")} onInc={() => onChange(to24(hour12, (minute + 5) % 60, isPM))} onDec={() => onChange(to24(hour12, minute === 0 ? 55 : minute - 5, isPM))} />
      <TouchableOpacity style={[sp.periodBtn, !isPM && sp.periodBtnActive]} onPress={() => onChange(to24(hour12, minute, false))}>
        <Text style={[sp.periodText, !isPM && sp.periodTextActive]}>AM</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[sp.periodBtn, isPM && sp.periodBtnActive]} onPress={() => onChange(to24(hour12, minute, true))}>
        <Text style={[sp.periodText, isPM && sp.periodTextActive]}>PM</Text>
      </TouchableOpacity>
    </View>
  );
}

const sp = StyleSheet.create({
  container: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: Ocean.surface, borderRadius: 14, borderWidth: 1, borderColor: Ocean.cardBorder, padding: 12, gap: 6 },
  col: { alignItems: "center", gap: 4 },
  arrowBtn: { padding: 4 },
  arrow: { fontSize: 13, color: Ocean.textSecondary },
  valueBox: { width: 48, height: 44, alignItems: "center", justifyContent: "center", backgroundColor: Ocean.card, borderRadius: 10, borderWidth: 1, borderColor: Ocean.cardBorder },
  valueText: { fontSize: 22, fontWeight: "700", color: Ocean.textPrimary },
  colon: { fontSize: 22, fontWeight: "700", color: Ocean.textSecondary, marginBottom: 2, paddingHorizontal: 2 },
  periodBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: Ocean.cardBorder, backgroundColor: Ocean.card, marginLeft: 4 },
  periodBtnActive: { backgroundColor: Ocean.accent, borderColor: Ocean.accent },
  periodText: { fontSize: 14, fontWeight: "600", color: Ocean.textSecondary },
  periodTextActive: { color: "#fff" },
});

// ─── Swipeable Row ────────────────────────────────────────────────────────────

const DELETE_WIDTH = 80;

function SwipeableRow({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dx, dy }) => Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8,
      onPanResponderMove: (_, { dx }) => {
        if (dx < 0) translateX.setValue(Math.max(dx, -DELETE_WIDTH));
        else if (isOpen.current) translateX.setValue(Math.min(0, -DELETE_WIDTH + dx));
      },
      onPanResponderRelease: (_, { dx }) => {
        const shouldOpen = isOpen.current ? dx > -20 === false : dx < -56;
        isOpen.current = shouldOpen;
        Animated.spring(translateX, { toValue: shouldOpen ? -DELETE_WIDTH : 0, useNativeDriver: true, bounciness: 4 }).start();
      },
    })
  ).current;

  return (
    <View style={sw.wrapper}>
      <View style={sw.deleteZone}>
        <TouchableOpacity
          style={sw.deleteBtn}
          onPress={() => {
            Animated.timing(translateX, { toValue: 0, duration: 200, useNativeDriver: true }).start();
            isOpen.current = false;
            onDelete();
          }}
        >
          <Text style={sw.deleteBtnText}>Delete</Text>
        </TouchableOpacity>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const sw = StyleSheet.create({
  wrapper: { position: "relative", marginBottom: 10 },
  deleteZone: { position: "absolute", right: 0, top: 0, bottom: 0, width: DELETE_WIDTH, alignItems: "center", justifyContent: "center", backgroundColor: Ocean.danger, borderRadius: 20 },
  deleteBtn: { flex: 1, width: "100%", alignItems: "center", justifyContent: "center" },
  deleteBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MedicationsScreen() {
  const { user } = useAuth();
  const uid = user!.uid;
  const today = todayStr();

  const [medications, setMedications] = useState<Medication[]>([]);
  const [dailyLog, setDailyLog] = useState<DailyLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [newMed, setNewMed] = useState<NewMed>(EMPTY_MED);

  // Animated progress value for smooth ring transition
  const progressAnim = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meds, log] = await Promise.all([getMedications(uid), getDailyLog(uid, today)]);
      setMedications(meds);
      setDailyLog(log);
    } finally {
      setLoading(false);
    }
  }, [uid, today]);

  useEffect(() => { load(); }, [load]);

  async function handleMarkTaken(key: string) {
    if (!dailyLog) return;
    setDailyLog((prev) =>
      prev ? { ...prev, doses: { ...prev.doses, [key]: { ...prev.doses[key], status: "taken" } } } : prev
    );
    await markDoseTaken(uid, today, key);
  }

  function handleUndo(key: string) {
    setDailyLog((prev) =>
      prev ? { ...prev, doses: { ...prev.doses, [key]: { ...prev.doses[key], status: "pending" } } } : prev
    );
    // Optimistic only — no Firebase undo for hackathon
  }

  async function handleLogAsNeeded(med: Medication) {
    const key = await logAsNeededDose(uid, today, med);
    setDailyLog((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        doses: {
          ...prev.doses,
          [key]: { medId: med.id, medName: med.name, scheduledTime: "manual", status: "taken", takenAt: null },
        },
      };
    });
  }

  function setSchedule(s: Schedule) {
    let times: string[];
    if (s === "twice_daily")  times = ["08:00", "20:00"];
    else if (s === "as_needed") times = [];
    else times = ["08:00"];
    setNewMed((m) => ({ ...m, schedule: s, times }));
  }

  function addTime() {
    setNewMed((m) => ({ ...m, times: [...m.times, "12:00"] }));
  }
  function removeTime(i: number) { setNewMed((m) => ({ ...m, times: m.times.filter((_, idx) => idx !== i) })); }
  function setTime(i: number, val: string) { setNewMed((m) => { const times = [...m.times]; times[i] = val; return { ...m, times }; }); }

  async function handleSaveMed() {
    if (!newMed.name.trim() || !newMed.doseAmount.trim()) {
      Alert.alert("Missing fields", "Please enter a medication name and amount.");
      return;
    }
    if (newMed.schedule !== "as_needed" && !newMed.times.length) {
      Alert.alert("Missing time", "Add at least one scheduled time.");
      return;
    }
    setSaving(true);
    try {
      const created = await addMedication(uid, {
        name: newMed.name.trim(),
        dosage: `${newMed.doseAmount.trim()} ${newMed.doseUnit}`,
        schedule: newMed.schedule,
        times: newMed.times,
        weekDay: newMed.schedule === "weekly" ? newMed.weekDay : null,
      });
      setMedications((prev) => [...prev, created]);
      setShowModal(false);
      setNewMed(EMPTY_MED);
      const log = await getDailyLog(uid, today);
      setDailyLog(log);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(medId: string) {
    setMedications((prev) => prev.filter((m) => m.id !== medId));
    setDailyLog((prev) => {
      if (!prev) return prev;
      const doses = Object.fromEntries(
        Object.entries(prev.doses).filter(([key]) => !key.startsWith(`${medId}_`))
      );
      return { ...prev, doses };
    });
    deleteMedication(uid, medId).catch(console.error);
    removeMedDosesFromLog(uid, today, medId).catch(console.error);
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const todayDoses = dailyLog
    ? Object.entries(dailyLog.doses).sort(([, a], [, b]) => a.scheduledTime.localeCompare(b.scheduledTime))
    : [];

  const groupedDoses = todayDoses.reduce<Record<string, { medName: string; slots: { key: string; dose: DoseLog }[] }>>(
    (acc, [key, dose]) => {
      if (!acc[dose.medId]) acc[dose.medId] = { medName: dose.medName, slots: [] };
      acc[dose.medId].slots.push({ key, dose });
      return acc;
    },
    {}
  );
  const groupedList = Object.entries(groupedDoses);

  const takenToday = todayDoses.filter(([, d]) => d.status === "taken").length;
  const totalToday = todayDoses.length;
  const progress = totalToday > 0 ? takenToday / totalToday : 0;
  const pct = Math.round(progress * 100);
  const nextDoseText = dailyLog ? getNextDoseText(dailyLog.doses) : null;

  const asNeededMeds = medications.filter((m) => m.schedule === "as_needed");

  // Animate progress ring smoothly on change
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 600,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={Ocean.bg} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Medications</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowModal(true)}>
          <Text style={styles.addBtnText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={Ocean.accent} /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

          {/* ── Progress card ── */}
          <View style={[styles.card, styles.progressCard]}>
            <View style={styles.progressLeft}>
              <Text style={styles.progressLabel}>Today's Progress</Text>
              <Text style={styles.progressBig}>{takenToday} of {Math.max(totalToday, medications.length)} taken</Text>
              {nextDoseText
                ? <Text style={styles.progressSub}>{nextDoseText}</Text>
                : totalToday > 0 && takenToday < totalToday
                ? <Text style={styles.progressSub}>No upcoming doses today</Text>
                : totalToday > 0 && takenToday === totalToday
                ? <Text style={styles.progressSub}>All done today 🎉</Text>
                : null}
            </View>
            <CircularProgress progress={progress} size={72} stroke={6} color={Ocean.accent} bg={Ocean.cardBorder}>
              <Text style={styles.progressPct}>{pct}%</Text>
            </CircularProgress>
          </View>

          {/* ── Today's Doses ── */}
          <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Today's Doses</Text>

          {medications.length === 0 ? (
            <View style={[styles.card, styles.dosesEmpty]}>
              <Text style={styles.emptyIcon}>💊</Text>
              <Text style={styles.emptyTitle}>No medications yet</Text>
              <Text style={styles.emptySubtitle}>Tap "+ Add" to get started</Text>
            </View>
          ) : totalToday === 0 ? (
            <View style={[styles.card, styles.dosesEmpty]}>
              <Text style={styles.emptySubtitle}>No doses scheduled today</Text>
            </View>
          ) : (
            groupedList.map(([medId, group], i) => (
              <GroupedDoseRow
                key={medId}
                medName={group.medName}
                slots={group.slots}
                isLast={i === groupedList.length - 1}
                onMarkTaken={handleMarkTaken}
                onUndo={handleUndo}
              />
            ))
          )}

          {/* ── As-Needed ── */}
          {asNeededMeds.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 28 }]}>As Needed</Text>
              <View style={styles.doseList}>
                {asNeededMeds.map((med) => (
                  <AsNeededCard key={med.id} med={med} onLog={() => handleLogAsNeeded(med)} />
                ))}
              </View>
            </>
          )}

          {/* ── My Medications ── */}
          {medications.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 28 }]}>My Medications</Text>
              {medications.map((med) => (
                <SwipeableRow key={med.id} onDelete={() => handleDelete(med.id)}>
                  <MedRow med={med} />
                </SwipeableRow>
              ))}
            </>
          )}

          {/* ── Add Medication bottom button ── */}
          <TouchableOpacity style={styles.addDashedBtn} onPress={() => setShowModal(true)}>
            <Text style={styles.addDashedBtnText}>+ Add Medication</Text>
          </TouchableOpacity>

        </ScrollView>
      )}

      {/* ── Add Medication Modal ── */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowModal(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Medication</Text>
            <TouchableOpacity onPress={() => { setShowModal(false); setNewMed(EMPTY_MED); }}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">

            {/* Name */}
            <Text style={styles.fieldLabel}>Medication name</Text>
            <TextInput style={styles.input} value={newMed.name} onChangeText={(v) => setNewMed((m) => ({ ...m, name: v }))} placeholder="e.g. Lamotrigine" placeholderTextColor={Ocean.textMuted} />

            {/* Dosage */}
            <Text style={styles.fieldLabel}>Dosage</Text>
            <View style={styles.dosageRow}>
              <TextInput style={[styles.input, styles.dosageAmount]} value={newMed.doseAmount} onChangeText={(v) => setNewMed((m) => ({ ...m, doseAmount: v.replace(/[^0-9.]/g, "") }))} placeholder="Amount" placeholderTextColor={Ocean.textMuted} keyboardType="decimal-pad" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.unitScroll} contentContainerStyle={styles.unitScrollContent}>
                {DOSE_UNITS.map((unit) => (
                  <TouchableOpacity key={unit} style={[styles.chip, newMed.doseUnit === unit && styles.chipActive]} onPress={() => setNewMed((m) => ({ ...m, doseUnit: unit }))}>
                    <Text style={[styles.chipText, newMed.doseUnit === unit && styles.chipTextActive]}>{unit}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Schedule */}
            <Text style={styles.fieldLabel}>Schedule</Text>
            <View style={styles.scheduleGrid}>
              {SCHEDULES.map((s) => (
                <TouchableOpacity key={s} style={[styles.scheduleChip, newMed.schedule === s && styles.scheduleChipActive]} onPress={() => setSchedule(s)}>
                  <Text style={[styles.scheduleChipText, newMed.schedule === s && styles.scheduleChipTextActive]}>{scheduleLabel(s)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Day of week (weekly only) */}
            {newMed.schedule === "weekly" && (
              <>
                <Text style={styles.fieldLabel}>Day of week</Text>
                <View style={styles.dayRow}>
                  {WEEK_DAYS.map((day, i) => (
                    <TouchableOpacity key={day} style={[styles.dayChip, newMed.weekDay === i && styles.dayChipActive]} onPress={() => setNewMed((m) => ({ ...m, weekDay: i }))}>
                      <Text style={[styles.dayChipText, newMed.weekDay === i && styles.dayChipTextActive]}>{day}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Times */}
            {newMed.schedule !== "as_needed" && (
              <>
                <View style={styles.timesHeader}>
                  <Text style={styles.fieldLabel}>
                    {newMed.schedule === "custom" ? "Times" : "Time"}
                  </Text>
                  {newMed.schedule === "custom" && (
                    <TouchableOpacity onPress={addTime}><Text style={styles.addTimeBtn}>+ Add time</Text></TouchableOpacity>
                  )}
                </View>
                {newMed.times.map((time, i) => (
                  <View key={i} style={styles.timeSlot}>
                    <View style={styles.timeSlotHeader}>
                      <Text style={styles.timeSlotLabel}>Dose {i + 1}</Text>
                      {newMed.schedule === "custom" && newMed.times.length > 1 && (
                        <TouchableOpacity onPress={() => removeTime(i)}><Text style={styles.removeTimeText}>Remove</Text></TouchableOpacity>
                      )}
                    </View>
                    <TimePicker value={time} onChange={(v) => setTime(i, v)} />
                  </View>
                ))}
              </>
            )}

            {newMed.schedule === "as_needed" && (
              <View style={styles.asNeededNote}>
                <Text style={styles.asNeededNoteText}>You'll log doses manually whenever you take this medication.</Text>
              </View>
            )}

            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSaveMed} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Medication</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function GroupedDoseRow({
  medName, slots, isLast, onMarkTaken, onUndo,
}: {
  medName: string;
  slots: { key: string; dose: DoseLog }[];
  isLast: boolean;
  onMarkTaken: (key: string) => void;
  onUndo: (key: string) => void;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const allTaken  = slots.every((s) => s.dose.status === "taken");
  const anyMissed = slots.some((s) => s.dose.status === "missed");
  const nextPending = slots.find((s) => s.dose.status === "pending");
  // Find the most recently "taken" slot for undo
  const lastTakenKey = allTaken ? slots[slots.length - 1]?.key : null;

  function handlePress() {
    if (!nextPending) return;
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.97, duration: 70, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, bounciness: 10, useNativeDriver: true }),
    ]).start();
    onMarkTaken(nextPending.key);
  }

  function handleUndo() {
    if (!lastTakenKey) return;
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.97, duration: 70, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, bounciness: 8, useNativeDriver: true }),
    ]).start();
    onUndo(lastTakenKey);
  }

  return (
    <Animated.View style={[styles.doseCard, { transform: [{ scale: scaleAnim }] }]}>
      <View style={styles.doseCardInner}>
        {/* Name + dosage */}
        <View style={{ flex: 1 }}>
          <Text style={[styles.doseName, allTaken && styles.doseNameTaken]}>{medName}</Text>
          {/* Time chips row */}
          <View style={styles.timeSlots}>
            {slots.map(({ key, dose }) => (
              <View key={key} style={[
                styles.timeChip,
                dose.status === "taken"  && styles.timeChipTaken,
                dose.status === "missed" && styles.timeChipMissed,
              ]}>
                <Text style={[
                  styles.timeChipText,
                  dose.status === "taken"  && { color: Ocean.success },
                  dose.status === "missed" && { color: Ocean.danger },
                ]}>
                  🕐 {formatTime(dose.scheduledTime)}{dose.status === "taken" ? " ✓" : dose.status === "missed" ? " ✗" : ""}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Action button */}
        {nextPending && !allTaken && (
          <TouchableOpacity style={styles.markTakenBtn} onPress={handlePress}>
            <Text style={styles.markTakenText}>
              {slots.length > 1 ? `Take ${formatTime(nextPending.dose.scheduledTime)}` : "Taken"}
            </Text>
          </TouchableOpacity>
        )}
        {allTaken && (
          <TouchableOpacity style={styles.undoBtn} onPress={handleUndo}>
            <Text style={styles.undoBtnText}>Undo</Text>
          </TouchableOpacity>
        )}
        {anyMissed && !allTaken && !nextPending && (
          <Text style={styles.missedLabel}>Missed</Text>
        )}
      </View>
    </Animated.View>
  );
}

function AsNeededCard({ med, onLog }: { med: Medication; onLog: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  function handlePress() {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.97, duration: 80, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, bounciness: 8, useNativeDriver: true }),
    ]).start();
    onLog();
  }
  return (
    <Animated.View style={[styles.card, styles.asNeededCard, { transform: [{ scale: scaleAnim }] }]}>
      <View style={styles.doseCardInner}>
        <View style={{ flex: 1 }}>
          <Text style={styles.doseName}>{med.name}</Text>
          <Text style={styles.doseDetail}>{med.dosage} · as needed</Text>
        </View>
        <TouchableOpacity style={styles.markTakenBtn} onPress={handlePress}>
          <Text style={styles.markTakenText}>Log dose</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

function MedRow({ med }: { med: Medication }) {
  return (
    <View style={[styles.card, styles.medRow]}>
      <View style={styles.medRowLeft}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={styles.medRowName}>{med.name}</Text>
          <View style={styles.scheduleBadge}>
            <Text style={styles.scheduleBadgeText}>{scheduleLabel(med.schedule)}</Text>
          </View>
        </View>
        <Text style={styles.medRowDetail}>
          {med.dosage}
          {med.schedule !== "as_needed" && med.times.length > 0 && ` · ${med.times.map(formatTime).join(", ")}`}
          {med.schedule === "weekly" && med.weekDay != null && ` · ${WEEK_DAYS[med.weekDay]}s`}
        </Text>
      </View>
      <Text style={styles.swipeHint}>← swipe</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: Ocean.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  header:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  headerTitle: { fontSize: 28, fontWeight: "700", color: Ocean.textPrimary },
  addBtn:      { backgroundColor: Ocean.accentBtn, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  addBtnText:  { color: "#fff", fontWeight: "700", fontSize: 14 },

  scroll:       { paddingHorizontal: 20, paddingBottom: 40 },
  sectionLabel: { fontSize: 12, fontWeight: "600", color: Ocean.textMuted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 },

  card: { backgroundColor: Ocean.card, borderRadius: 20, borderWidth: 1, borderColor: Ocean.cardBorder },

  // Progress card
  progressCard: { flexDirection: "row", alignItems: "center", padding: 20, gap: 16, marginBottom: 0 },
  progressLeft: { flex: 1 },
  progressLabel: { fontSize: 12, fontWeight: "600", color: Ocean.textMuted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 },
  progressBig:   { fontSize: 22, fontWeight: "700", color: Ocean.textPrimary },
  progressSub:   { fontSize: 12, color: Ocean.textSecondary, marginTop: 4 },
  progressPct:   { fontSize: 13, fontWeight: "700", color: Ocean.textPrimary },

  // Empty state
  dosesEmpty:    { alignItems: "center", padding: 32, gap: 8, marginBottom: 0 },
  emptyIcon:     { fontSize: 36, marginBottom: 4 },
  emptyTitle:    { fontSize: 16, fontWeight: "600", color: Ocean.textPrimary },
  emptySubtitle: { fontSize: 13, color: Ocean.textSecondary, textAlign: "center" },

  // Dose card (grouped row)
  doseCard: {
    backgroundColor: Ocean.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    marginBottom: 10,
  },
  doseCardInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  doseName:      { fontSize: 15, fontWeight: "700", color: Ocean.textPrimary },
  doseNameTaken: { textDecorationLine: "line-through", opacity: 0.5 },
  doseDetail:    { fontSize: 12, color: Ocean.textSecondary, marginTop: 2 },

  // Time chips
  timeSlots: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  timeChip: {
    backgroundColor: Ocean.surface,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Ocean.accent,
  },
  timeChipTaken:  { borderColor: Ocean.success },
  timeChipMissed: { borderColor: Ocean.danger },
  timeChipText:   { fontSize: 11, fontWeight: "600", color: Ocean.textSecondary },

  // Action buttons
  markTakenBtn: { backgroundColor: Ocean.accentBtn, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 14 },
  markTakenText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  undoBtn:  { backgroundColor: Ocean.surface, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 14, borderWidth: 1, borderColor: Ocean.cardBorder },
  undoBtnText: { color: Ocean.textSecondary, fontWeight: "600", fontSize: 13 },
  missedLabel: { fontSize: 13, fontWeight: "600", color: Ocean.danger },

  // As-needed card
  asNeededCard: { marginBottom: 10 },

  // My Medications rows
  medRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  medRowLeft: { flex: 1 },
  medRowName: { fontSize: 15, fontWeight: "600", color: Ocean.textPrimary },
  medRowDetail: { fontSize: 12, color: Ocean.textSecondary, marginTop: 3 },
  swipeHint: { fontSize: 11, color: Ocean.textMuted },
  scheduleBadge: { backgroundColor: Ocean.surface, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: Ocean.cardBorder },
  scheduleBadgeText: { fontSize: 10, color: Ocean.textSecondary, fontWeight: "600" },

  doseList: { gap: 0 },

  // Add dashed button
  addDashedBtn: {
    marginTop: 20,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: Ocean.accent,
    borderStyle: "dashed",
    borderRadius: 20,
    paddingVertical: 16,
    alignItems: "center",
  },
  addDashedBtnText: { fontSize: 15, fontWeight: "700", color: Ocean.accent },

  // Modal
  modal:        { flex: 1, backgroundColor: Ocean.bg },
  modalHeader:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, paddingTop: 24, borderBottomWidth: 1, borderBottomColor: Ocean.cardBorder },
  modalTitle:   { fontSize: 20, fontWeight: "700", color: Ocean.textPrimary },
  modalCancel:  { fontSize: 16, color: Ocean.accent },
  modalScroll:  { padding: 20 },

  fieldLabel:    { fontSize: 13, fontWeight: "600", color: Ocean.textMuted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8, marginTop: 20 },
  input:         { backgroundColor: Ocean.card, borderWidth: 1, borderColor: Ocean.cardBorder, borderRadius: 12, padding: 14, fontSize: 16, color: Ocean.textPrimary },
  dosageRow:     { gap: 10 },
  dosageAmount:  {},
  unitScroll:    { flexGrow: 0 },
  unitScrollContent: { gap: 8, paddingVertical: 2 },

  chip:          { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: Ocean.card, borderWidth: 1, borderColor: Ocean.cardBorder },
  chipActive:    { backgroundColor: Ocean.accent, borderColor: Ocean.accent },
  chipText:      { fontSize: 14, color: Ocean.textSecondary, fontWeight: "500" },
  chipTextActive: { color: "#fff", fontWeight: "700" },

  scheduleGrid:          { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  scheduleChip:          { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: Ocean.card, borderWidth: 1, borderColor: Ocean.cardBorder },
  scheduleChipActive:    { backgroundColor: Ocean.accent, borderColor: Ocean.accent },
  scheduleChipText:      { fontSize: 14, color: Ocean.textSecondary, fontWeight: "500" },
  scheduleChipTextActive: { color: "#fff", fontWeight: "700" },

  dayRow:         { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  dayChip:        { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: Ocean.card, borderWidth: 1, borderColor: Ocean.cardBorder },
  dayChipActive:  { backgroundColor: Ocean.accent, borderColor: Ocean.accent },
  dayChipText:    { fontSize: 12, fontWeight: "600", color: Ocean.textSecondary },
  dayChipTextActive: { color: "#fff" },

  timesHeader:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 20 },
  addTimeBtn:     { fontSize: 14, color: Ocean.accent, fontWeight: "600" },
  timeSlot:       { marginTop: 16, gap: 10 },
  timeSlotHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  timeSlotLabel:  { fontSize: 14, color: Ocean.textSecondary, fontWeight: "500" },
  removeTimeText: { fontSize: 13, color: Ocean.danger },

  asNeededNote:     { marginTop: 16, backgroundColor: Ocean.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Ocean.cardBorder },
  asNeededNoteText: { fontSize: 14, color: Ocean.textSecondary, lineHeight: 20 },

  saveBtn:     { backgroundColor: Ocean.accentBtn, borderRadius: 14, padding: 16, alignItems: "center", marginTop: 32, marginBottom: 20 },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
