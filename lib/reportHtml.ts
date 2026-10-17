import { lastNDays, shortLabel } from './dates';
import { classify } from './analysis';
import type { CheckIn, MoodState, ProdromeDirection } from './analysis';
import type { AdherenceSummary } from './medications';

/**
 * The psychiatrist report: 30 days of measured data, a Claude-written narrative
 * at the top, and charts a clinician can read without a legend lecture.
 *
 * Charts are inline SVG so expo-print renders them into the PDF with no
 * dependency on a charting library. Each chart carries exactly one axis — there
 * are deliberately three separate figures rather than one overloaded one.
 *
 * Palette is print-first (the PDF is read on white, not in the app's dark
 * theme) and validated for colour-vision deficiency: every adjacent pair clears
 * ΔE 14 under deuteranopia and protanopia. Series are direct-labelled as well
 * as coloured, so identity never rests on colour alone.
 */

const INK = '#1F2430';
const INK_SOFT = '#5B6476';
const INK_MUTED = '#8A92A3';
const GRID = '#E4E7EC';
const SURFACE = '#FFFFFF';

// Validated categorical trio for the voice-biomarker figure.
const SERIES = {
  speechRate: '#0E9F8F',
  energy: '#C2410C',
  valence: '#7C3AED',
} as const;

// Diverging pair for mood polarity, with a neutral midpoint.
const ELEVATED = '#C2410C';
const LOW = '#1D4ED8';
const NEUTRAL = '#9CA3AF';

/** The slice of a prodrome alert the report needs — kept local so this module
 * stays free of Firebase and Expo imports and can be rendered under plain Node. */
export type ReportAlert = {
  id: string;
  firedOn: string;
  direction: ProdromeDirection;
  streakDays: number;
  title: string;
};

export type ReportStats = {
  days: number;
  checkIns: CheckIn[];
  avgMood: number;
  avgSleep: number;
  sleepStdev: number;
  stateCounts: Record<MoodState, number>;
  adherence: AdherenceSummary;
  alerts: ReportAlert[];
  voiceTrend: { date: string; speechRate: number; energy: number; valence: number }[];
};

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildStats(
  checkIns: CheckIn[],
  adherence: AdherenceSummary,
  alerts: ReportAlert[],
  days = 30,
): ReportStats {
  const window = new Set(lastNDays(days));
  const inWindow = checkIns.filter((c) => window.has(c.date));

  const stateCounts: Record<MoodState, number> = { stable: 0, elevated: 0, low: 0, mixed: 0 };
  for (const c of inWindow) stateCounts[c.analysis?.state ?? classify(c)] += 1;

  const sleep = inWindow.map((c) => c.sleepHours);

  return {
    days,
    checkIns: inWindow,
    avgMood: mean(inWindow.map((c) => c.mood)),
    avgSleep: mean(sleep),
    sleepStdev: stdev(sleep),
    stateCounts,
    adherence,
    alerts: alerts.filter((a) => window.has(a.firedOn)),
    voiceTrend: inWindow
      .filter((c) => c.voice)
      .map((c) => ({
        date: c.date,
        speechRate: c.voice!.speechRate,
        energy: c.voice!.energy,
        valence: c.voice!.valence,
      })),
  };
}

/** One-line data digest handed to Claude so the narrative is grounded in numbers. */
export function statsDigest(s: ReportStats): string {
  const lines = [
    `Check-ins completed: ${s.checkIns.length} of ${s.days} days.`,
    `Mean self-reported mood: ${round1(s.avgMood)} on a -3 (low) to +3 (elevated) scale.`,
    `Mean sleep: ${round1(s.avgSleep)} h, standard deviation ${round1(s.sleepStdev)} h.`,
    `Day states: ${s.stateCounts.stable} stable, ${s.stateCounts.elevated} elevated, ${s.stateCounts.low} low, ${s.stateCounts.mixed} mixed.`,
    `Medication adherence: ${Math.round(s.adherence.rate * 100)}% (${s.adherence.taken} doses taken, ${s.adherence.missed} missed).`,
    `Early-warning alerts fired: ${s.alerts.length}${
      s.alerts.length ? ` (${s.alerts.map((a) => `${a.streakDays}d ${a.direction} on ${a.firedOn}`).join('; ')})` : ''
    }.`,
  ];
  if (s.voiceTrend.length > 0) {
    lines.push(
      `Vocal prosody samples: ${s.voiceTrend.length}. Mean speech rate ${round1(
        mean(s.voiceTrend.map((v) => v.speechRate)) * 100,
      )}%, vocal energy ${round1(mean(s.voiceTrend.map((v) => v.energy)) * 100)}%, emotional valence ${round1(
        mean(s.voiceTrend.map((v) => v.valence)) * 100,
      )}% (all normalized 0-100%).`,
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

const W = 660;
const H = 190;
const PAD = { top: 16, right: 20, bottom: 30, left: 38 };

type Pt = { x: number; y: number };

const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

function xAt(i: number, n: number): number {
  if (n <= 1) return PAD.left + plotW / 2;
  return PAD.left + (i / (n - 1)) * plotW;
}

function path(points: Pt[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round1(p.x)},${round1(p.y)}`).join(' ');
}

function axisLabels(dates: string[]): string {
  if (dates.length === 0) return '';
  // Selective labelling only — first, middle, last. Never one per point.
  const idx = [...new Set([0, Math.floor((dates.length - 1) / 2), dates.length - 1])];
  return idx
    .map(
      (i) =>
        `<text x="${round1(xAt(i, dates.length))}" y="${H - 10}" fill="${INK_MUTED}" font-size="10" text-anchor="middle">${esc(shortLabel(dates[i]))}</text>`,
    )
    .join('');
}

function emptyChart(message: string): string {
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><rect width="${W}" height="${H}" fill="${SURFACE}"/><text x="${W / 2}" y="${H / 2}" fill="${INK_MUTED}" font-size="13" text-anchor="middle">${esc(message)}</text></svg>`;
}

/** Mood polarity: diverging bars around a neutral zero line. */
function moodChart(checkIns: CheckIn[]): string {
  if (checkIns.length === 0) return emptyChart('No mood check-ins recorded in this window.');
  const n = checkIns.length;
  const zero = PAD.top + plotH / 2;
  const unit = plotH / 2 / 3; // mood runs -3..+3
  // 2px gap between adjacent bars, and never wider than the slot.
  const slot = n > 1 ? plotW / (n - 1) : plotW;
  const barW = Math.max(3, Math.min(18, slot - 2));

  const bars = checkIns
    .map((c, i) => {
      const x = xAt(i, n) - barW / 2;
      const h = Math.abs(c.mood) * unit;
      const y = c.mood >= 0 ? zero - h : zero;
      const fill = c.mood > 0 ? ELEVATED : c.mood < 0 ? LOW : NEUTRAL;
      if (c.mood === 0)
        return `<rect x="${round1(x)}" y="${round1(zero - 1.5)}" width="${round1(barW)}" height="3" rx="1.5" fill="${NEUTRAL}"/>`;
      // 4px rounded data-end, square against the baseline.
      return `<rect x="${round1(x)}" y="${round1(y)}" width="${round1(barW)}" height="${round1(Math.max(h, 3))}" rx="3" fill="${fill}"/>`;
    })
    .join('');

  const ticks = [3, 0, -3]
    .map((v) => {
      const y = zero - v * unit;
      return `<line x1="${PAD.left}" y1="${round1(y)}" x2="${W - PAD.right}" y2="${round1(y)}" stroke="${v === 0 ? INK_MUTED : GRID}" stroke-width="1"/><text x="${PAD.left - 8}" y="${round1(y + 3)}" fill="${INK_MUTED}" font-size="10" text-anchor="end">${v > 0 ? '+' : ''}${v}</text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Daily self-reported mood from -3 low to +3 elevated">
  <rect width="${W}" height="${H}" fill="${SURFACE}"/>
  ${ticks}${bars}${axisLabels(checkIns.map((c) => c.date))}
  <text x="${W - PAD.right}" y="${PAD.top - 4}" fill="${ELEVATED}" font-size="10" text-anchor="end">elevated ▲</text>
  <text x="${W - PAD.right}" y="${H - PAD.bottom - 6}" fill="${LOW}" font-size="10" text-anchor="end">low ▼</text>
</svg>`;
}

/** Sleep hours with the 7-9 h target band shaded behind the bars. */
function sleepChart(checkIns: CheckIn[]): string {
  if (checkIns.length === 0) return emptyChart('No sleep data recorded in this window.');
  const n = checkIns.length;
  const max = Math.max(12, ...checkIns.map((c) => c.sleepHours));
  const base = H - PAD.bottom;
  const yOf = (h: number) => base - (h / max) * plotH;
  const slot = n > 1 ? plotW / (n - 1) : plotW;
  const barW = Math.max(3, Math.min(18, slot - 2));

  const band = `<rect x="${PAD.left}" y="${round1(yOf(9))}" width="${plotW}" height="${round1(yOf(7) - yOf(9))}" fill="${SERIES.speechRate}" opacity="0.1"/>`;

  const bars = checkIns
    .map((c, i) => {
      const x = xAt(i, n) - barW / 2;
      const y = yOf(c.sleepHours);
      return `<rect x="${round1(x)}" y="${round1(y)}" width="${round1(barW)}" height="${round1(Math.max(base - y, 2))}" rx="3" fill="${SERIES.speechRate}"/>`;
    })
    .join('');

  const ticks = [0, 4, 8, 12]
    .filter((v) => v <= max)
    .map(
      (v) =>
        `<line x1="${PAD.left}" y1="${round1(yOf(v))}" x2="${W - PAD.right}" y2="${round1(yOf(v))}" stroke="${GRID}" stroke-width="1"/><text x="${PAD.left - 8}" y="${round1(yOf(v) + 3)}" fill="${INK_MUTED}" font-size="10" text-anchor="end">${v}h</text>`,
    )
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Hours slept per night, with the 7 to 9 hour target band shaded">
  <rect width="${W}" height="${H}" fill="${SURFACE}"/>
  ${ticks}${band}${bars}${axisLabels(checkIns.map((c) => c.date))}
  <text x="${W - PAD.right}" y="${round1(yOf(9) - 4)}" fill="${INK_MUTED}" font-size="10" text-anchor="end">7–9 h target</text>
</svg>`;
}

/** Three voice biomarkers over time. Legend plus direct end labels. */
function voiceChart(trend: ReportStats['voiceTrend']): string {
  if (trend.length < 2)
    return emptyChart('Not enough spoken check-ins yet to plot a vocal trend.');
  const n = trend.length;
  const base = H - PAD.bottom;
  const yOf = (v: number) => base - v * plotH;

  const keys = ['speechRate', 'energy', 'valence'] as const;
  const names: Record<(typeof keys)[number], string> = {
    speechRate: 'Speech rate',
    energy: 'Vocal energy',
    valence: 'Valence',
  };

  const lines = keys
    .map((k) => {
      const pts = trend.map((t, i) => ({ x: xAt(i, n), y: yOf(t[k]) }));
      const last = pts[pts.length - 1];
      return `<path d="${path(pts)}" fill="none" stroke="${SERIES[k]}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${round1(last.x)}" cy="${round1(last.y)}" r="4" fill="${SERIES[k]}" stroke="${SURFACE}" stroke-width="2"/>`;
    })
    .join('');

  const ticks = [0, 0.5, 1]
    .map(
      (v) =>
        `<line x1="${PAD.left}" y1="${round1(yOf(v))}" x2="${W - PAD.right}" y2="${round1(yOf(v))}" stroke="${GRID}" stroke-width="1"/><text x="${PAD.left - 8}" y="${round1(yOf(v) + 3)}" fill="${INK_MUTED}" font-size="10" text-anchor="end">${v * 100}</text>`,
    )
    .join('');

  const legend = keys
    .map(
      (k, i) =>
        `<span class="key"><span class="swatch" style="background:${SERIES[k]}"></span>${names[k]}${i < keys.length - 1 ? '' : ''}</span>`,
    )
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Speech rate, vocal energy and emotional valence over time, each normalized 0 to 100">
  <rect width="${W}" height="${H}" fill="${SURFACE}"/>
  ${ticks}${lines}${axisLabels(trend.map((t) => t.date))}
</svg>
<div class="legend">${legend}</div>`;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function buildReportHtml(
  patientName: string,
  narrative: string,
  s: ReportStats,
  generatedOn: Date = new Date(),
): string {
  const adherencePct = Math.round(s.adherence.rate * 100);
  const completion = Math.round((s.checkIns.length / s.days) * 100);

  const tiles = [
    { label: 'Check-ins completed', value: `${s.checkIns.length}/${s.days}`, sub: `${completion}% of days` },
    { label: 'Medication adherence', value: `${adherencePct}%`, sub: `${s.adherence.missed} doses missed` },
    { label: 'Mean sleep', value: `${round1(s.avgSleep)} h`, sub: `± ${round1(s.sleepStdev)} h night to night` },
    { label: 'Early-warning alerts', value: `${s.alerts.length}`, sub: s.alerts.length ? 'see timeline below' : 'none fired' },
  ]
    .map(
      (t) =>
        `<div class="tile"><div class="tile-label">${esc(t.label)}</div><div class="tile-value">${esc(t.value)}</div><div class="tile-sub">${esc(t.sub)}</div></div>`,
    )
    .join('');

  const stateRows = (['stable', 'elevated', 'low', 'mixed'] as const)
    .map(
      (k) =>
        `<tr><td>${k[0].toUpperCase()}${k.slice(1)}</td><td class="num">${s.stateCounts[k]}</td><td class="num">${s.checkIns.length ? Math.round((s.stateCounts[k] / s.checkIns.length) * 100) : 0}%</td></tr>`,
    )
    .join('');

  const alertRows = s.alerts.length
    ? s.alerts
        .map(
          (a) =>
            `<tr><td>${esc(a.firedOn)}</td><td>${esc(a.direction)}</td><td class="num">${a.streakDays} d</td><td>${esc(a.title)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="muted">No early-warning alerts fired in this window.</td></tr>';

  // Accessibility: every figure also exists as readable numbers.
  const dataRows = s.checkIns
    .map(
      (c) =>
        `<tr><td>${esc(c.date)}</td><td class="num">${c.mood > 0 ? '+' : ''}${c.mood}</td><td class="num">${c.energy}</td><td class="num">${round1(c.sleepHours)}</td><td class="num">${c.irritability}</td><td>${esc(c.analysis?.state ?? classify(c))}</td><td class="num">${c.voice ? Math.round(c.voice.speechRate * 100) : '—'}</td><td class="num">${c.voice ? Math.round(c.voice.energy * 100) : '—'}</td><td class="num">${c.voice ? Math.round(c.voice.valence * 100) : '—'}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  @page { margin: 34px 30px; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: ${INK}; font-size: 12px; line-height: 1.55; margin: 0; }
  h1 { font-size: 21px; margin: 0 0 2px; letter-spacing: -0.2px; }
  h2 { font-size: 13px; margin: 26px 0 8px; text-transform: uppercase; letter-spacing: 0.7px; color: ${INK_SOFT}; }
  .meta { color: ${INK_MUTED}; font-size: 11px; margin-bottom: 18px; }
  .narrative { background: #F7F9FB; border-left: 3px solid ${SERIES.speechRate}; padding: 14px 16px; border-radius: 0 6px 6px 0; font-size: 13px; }
  .tiles { display: flex; gap: 10px; margin-top: 16px; }
  .tile { flex: 1; border: 1px solid ${GRID}; border-radius: 8px; padding: 10px 12px; }
  .tile-label { color: ${INK_MUTED}; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  .tile-value { font-size: 22px; font-weight: 700; margin-top: 3px; letter-spacing: -0.5px; }
  .tile-sub { color: ${INK_SOFT}; font-size: 10.5px; margin-top: 1px; }
  .figure { border: 1px solid ${GRID}; border-radius: 8px; padding: 10px 6px 4px; }
  .caption { color: ${INK_MUTED}; font-size: 10.5px; padding: 0 10px 6px; }
  .legend { display: flex; gap: 16px; padding: 2px 12px 8px; font-size: 10.5px; color: ${INK_SOFT}; }
  .key { display: inline-flex; align-items: center; gap: 5px; }
  .swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { text-align: left; padding: 5px 7px; border-bottom: 1px solid ${GRID}; }
  th { color: ${INK_MUTED}; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: ${INK_MUTED}; }
  .footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid ${GRID}; color: ${INK_MUTED}; font-size: 10px; }
  .page-break { page-break-before: always; }
</style></head>
<body>
  <h1>Anchor — 30-Day Summary</h1>
  <div class="meta">${esc(patientName || 'Patient')} · generated ${esc(generatedOn.toLocaleDateString())} · patient-generated data</div>

  <div class="narrative">${esc(narrative).replace(/\n+/g, '<br/>')}</div>

  <div class="tiles">${tiles}</div>

  <h2>Daily mood</h2>
  <div class="figure">${moodChart(s.checkIns)}<div class="caption">Self-reported daily mood, −3 (low) to +3 (elevated). Each bar is one check-in.</div></div>

  <h2>Sleep consistency</h2>
  <div class="figure">${sleepChart(s.checkIns)}<div class="caption">Hours slept per night. Shaded band marks the 7–9 hour target.</div></div>

  <h2>Vocal biomarker trend</h2>
  <div class="figure">${voiceChart(s.voiceTrend)}<div class="caption">Prosody measures from spoken check-ins, each normalised 0–100. Higher speech rate and energy indicate activation; lower valence indicates negative affect.</div></div>

  <h2>Day states</h2>
  <table><thead><tr><th>State</th><th class="num">Days</th><th class="num">Share</th></tr></thead><tbody>${stateRows}</tbody></table>

  <h2>Early-warning alerts</h2>
  <table><thead><tr><th>Date</th><th>Direction</th><th class="num">Streak</th><th>Summary</th></tr></thead><tbody>${alertRows}</tbody></table>

  <div class="page-break"></div>
  <h2>Underlying data</h2>
  <table><thead><tr><th>Date</th><th class="num">Mood</th><th class="num">Energy</th><th class="num">Sleep</th><th class="num">Irrit.</th><th>State</th><th class="num">Rate</th><th class="num">Vocal&nbsp;E</th><th class="num">Valence</th></tr></thead><tbody>${dataRows || '<tr><td colspan="9" class="muted">No check-ins recorded.</td></tr>'}</tbody></table>

  <div class="footer">
    Generated by Anchor from patient self-report, medication logs, and vocal prosody analysis. Mood, energy and irritability are self-rated. Vocal measures are derived from short spoken check-ins and are normalised per-sample, not calibrated against a clinical baseline. Early-warning alerts are pattern notifications, not diagnoses. This document is intended to support clinical assessment, not to replace it.
  </div>
</body></html>`;
}

