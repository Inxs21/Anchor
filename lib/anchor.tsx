import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './auth';
import { dateKey, lastNDays } from './dates';
import { getFingerprint, type EpisodeFingerprint } from './fingerprint';
import { getCheckIn, getRecentCheckIns, type CheckIn } from './checkins';
import { getAdherence, getDayLog, type AdherenceSummary, type DayLog } from './medications';
import { getAlerts, runProdromeCheck, type ProdromeAlert } from './prodrome';
import type { CompanionContext } from './claude';

/**
 * One load of everything the screens share: fingerprint, today's check-in and
 * dose log, recent history, adherence, and prodrome alerts. Screens read from
 * here instead of each hitting Firestore, which keeps the tab switches instant
 * and means the companion always sees the same context the Today screen shows.
 */

type AnchorValue = {
  loading: boolean;
  fingerprint: EpisodeFingerprint | null;
  today: CheckIn | null;
  dayLog: DayLog | null;
  history: CheckIn[];
  adherence: AdherenceSummary | null;
  alerts: ProdromeAlert[];
  /** The most recent alert the user has not dismissed on the Today screen. */
  activeAlert: ProdromeAlert | null;
  dismissAlert: (id: string) => void;
  refresh: () => Promise<void>;
  companionContext: CompanionContext;
};

const AnchorContext = createContext<AnchorValue | null>(null);

const ADHERENCE_WINDOW = 30;

export function AnchorProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [fingerprint, setFingerprint] = useState<EpisodeFingerprint | null>(null);
  const [today, setToday] = useState<CheckIn | null>(null);
  const [dayLog, setDayLog] = useState<DayLog | null>(null);
  const [history, setHistory] = useState<CheckIn[]>([]);
  const [adherence, setAdherence] = useState<AdherenceSummary | null>(null);
  const [alerts, setAlerts] = useState<ProdromeAlert[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  // Guards against the prodrome check firing twice when tabs mount in parallel.
  const prodromeRan = useRef(false);

  const uid = user?.uid;
  const displayName = user?.displayName ?? '';

  const load = useCallback(async () => {
    if (!uid) {
      setFingerprint(null);
      setToday(null);
      setDayLog(null);
      setHistory([]);
      setAdherence(null);
      setAlerts([]);
      setLoading(false);
      return;
    }
    const key = dateKey();
    const [fp, t, log, hist, adh, alertList] = await Promise.all([
      getFingerprint(uid).catch(() => null),
      getCheckIn(uid, key).catch(() => null),
      getDayLog(uid, key).catch(() => null),
      getRecentCheckIns(uid, ADHERENCE_WINDOW).catch(() => [] as CheckIn[]),
      getAdherence(uid, lastNDays(ADHERENCE_WINDOW)).catch(() => null),
      getAlerts(uid).catch(() => [] as ProdromeAlert[]),
    ]);
    setFingerprint(fp);
    setToday(t);
    setDayLog(log);
    setHistory(hist);
    setAdherence(adh);
    setAlerts(alertList);
    setLoading(false);
  }, [uid]);

  useEffect(() => {
    setLoading(true);
    prodromeRan.current = false;
    load();
  }, [load]);

  const missedRecently = useMemo(() => {
    if (!adherence) return [];
    // Doses missed over the last three days, named for the companion to notice.
    const recent = new Set(lastNDays(3));
    return adherence.days
      .filter((d) => recent.has(d.date) && d.missed > 0)
      .map((d) => `${d.missed} on ${d.date}`);
  }, [adherence]);

  const companionContext = useMemo<CompanionContext>(
    () => ({ displayName, fingerprint, today, history, adherence, missedRecently }),
    [displayName, fingerprint, today, history, adherence, missedRecently],
  );

  // Feature 5: the prodrome sweep runs silently once per session, after the
  // history is in hand.
  useEffect(() => {
    if (!uid || loading || prodromeRan.current || history.length === 0) return;
    prodromeRan.current = true;
    runProdromeCheck(uid, companionContext)
      .then((fired) => {
        if (fired) setAlerts((prev) => [fired, ...prev.filter((a) => a.id !== fired.id)]);
      })
      .catch(() => {});
  }, [uid, loading, history.length, companionContext]);

  const activeAlert = useMemo(
    () => alerts.find((a) => !dismissed.includes(a.id)) ?? null,
    [alerts, dismissed],
  );

  const dismissAlert = useCallback((id: string) => {
    setDismissed((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const value = useMemo<AnchorValue>(
    () => ({
      loading,
      fingerprint,
      today,
      dayLog,
      history,
      adherence,
      alerts,
      activeAlert,
      dismissAlert,
      refresh: load,
      companionContext,
    }),
    [
      loading,
      fingerprint,
      today,
      dayLog,
      history,
      adherence,
      alerts,
      activeAlert,
      dismissAlert,
      load,
      companionContext,
    ],
  );

  return <AnchorContext.Provider value={value}>{children}</AnchorContext.Provider>;
}

export function useAnchor(): AnchorValue {
  const ctx = useContext(AnchorContext);
  if (!ctx) throw new Error('useAnchor must be used within AnchorProvider');
  return ctx;
}
