// All dates are handled in LOCAL time — the app's "day" follows the user's clock.

export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  const d = keyToDate(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

/** Keys from oldest to newest, ending at endKey (default: today). */
export function lastNDays(n: number, endKey: string = dateKey()): string[] {
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(addDays(endKey, -i));
  return keys;
}

export function weekdayOf(key: string): number {
  return keyToDate(key).getDay();
}

export function shortLabel(key: string): string {
  const d = keyToDate(key);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
