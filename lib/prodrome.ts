import { collection, doc, getDocs, orderBy, query, setDoc } from 'firebase/firestore';
import * as Notifications from 'expo-notifications';
import { db } from './firebase';
import { dateKey } from './dates';
import { detectStreak, STREAK_THRESHOLD } from './analysis';
import type { ProdromeDirection, Streak } from './analysis';
import { prodromeBrief, type CompanionContext } from './claude';

/**
 * Prodrome detection — the early-warning layer.
 *
 * Runs over the stored check-in history whenever the app opens. Three or more
 * consecutive days leaning the same non-stable direction is the trigger; that
 * window is then handed to Claude, which writes the alert in this person's own
 * terms. Alerts are deduplicated by their streak signature so reopening the app
 * never re-notifies for a pattern the user has already seen.
 */

export { detectStreak, STREAK_THRESHOLD };
export type { ProdromeDirection, Streak };

export type ProdromeAlert = {
  id: string;
  firedOn: string; // dateKey
  direction: ProdromeDirection;
  streakDays: number;
  title: string;
  body: string;
  recommendations: string[];
  createdAt: number;
};

const alertsCol = (uid: string) => collection(db, 'users', uid, 'alerts');

/** Stable identity for a streak, so the same pattern alerts only once. */
function signature(streak: Streak): string {
  return `${streak.direction}_${streak.days[0].date}_${streak.days.length}`;
}

export async function getAlerts(uid: string): Promise<ProdromeAlert[]> {
  try {
    const snap = await getDocs(query(alertsCol(uid), orderBy('createdAt', 'desc')));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProdromeAlert, 'id'>) }));
  } catch {
    const snap = await getDocs(alertsCol(uid));
    const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProdromeAlert, 'id'>) }));
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }
}

async function notify(alert: ProdromeAlert): Promise<void> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (!settings.granted) {
      const asked = await Notifications.requestPermissionsAsync();
      if (!asked.granted) return;
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: alert.title,
        body: alert.body,
        data: { alertId: alert.id },
      },
      trigger: null, // deliver now
    });
  } catch {
    // Notifications are unavailable in Expo Go on some platforms — the in-app
    // card still carries the alert, so this is non-fatal.
  }
}

/**
 * Checks the history for a qualifying streak and, if one is new, writes and
 * delivers the alert. Returns the alert when it fires, otherwise null.
 */
export async function runProdromeCheck(
  uid: string,
  ctx: CompanionContext,
): Promise<ProdromeAlert | null> {
  const streak = detectStreak(ctx.history);
  if (!streak) return null;

  const id = signature(streak);
  const existing = await getAlerts(uid).catch(() => [] as ProdromeAlert[]);
  if (existing.some((a) => a.id === id)) return null;

  const brief = await prodromeBrief(ctx, streak.days.length, streak.direction);
  const alert: ProdromeAlert = {
    id,
    firedOn: dateKey(),
    direction: streak.direction,
    streakDays: streak.days.length,
    title: brief.title,
    body: brief.body,
    recommendations: brief.recommendations,
    createdAt: Date.now(),
  };

  await setDoc(doc(alertsCol(uid), id), alert);
  await notify(alert);
  return alert;
}
