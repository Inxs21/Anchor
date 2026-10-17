/**
 * Renders the psychiatrist report from synthetic data so the charts and layout
 * can be eyeballed without a device, a Firebase account, or 30 days of history.
 *
 *   npm run check:report          # writes and validates dist-report/report.html
 *
 * Open the written file in a browser: what you see is what expo-print turns
 * into the PDF.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReportHtml, buildStats, statsDigest } from '../lib/reportHtml.ts';

const OUT_DIR = 'dist-report';

function dateKey(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A 30-day arc that slides from stable into an elevated run, so every chart
 *  branch and the alert table all have something to draw. */
function syntheticHistory() {
  const out = [];
  for (let i = 29; i >= 0; i--) {
    const t = (29 - i) / 29;
    const ramp = t > 0.65 ? (t - 0.65) / 0.35 : 0;
    const wobble = Math.sin(i * 1.3) * 0.5;

    const mood = Math.max(-3, Math.min(3, Math.round(ramp * 3 + wobble - (t < 0.3 ? 1 : 0))));
    const sleepHours = Math.round((8 - ramp * 3.5 + wobble * 0.5) * 2) / 2;
    const energy = Math.max(0, Math.min(10, Math.round(5 + ramp * 4 + wobble)));

    // Leave a few days without a voice sample — the charts must cope.
    const hasVoice = i % 4 !== 1;

    out.push({
      date: dateKey(i),
      mood,
      energy,
      sleepHours,
      irritability: Math.max(0, Math.min(10, Math.round(2 + ramp * 6))),
      symptoms: ramp > 0.4 ? ['Racing thoughts', 'Low sleep'] : [],
      note: '',
      voice: hasVoice
        ? {
            speechRate: Math.min(1, 0.42 + ramp * 0.45 + wobble * 0.06),
            pitchVariance: Math.min(1, 0.4 + ramp * 0.35),
            energy: Math.min(1, 0.4 + ramp * 0.5),
            valence: Math.max(0, 0.55 - ramp * 0.25 + wobble * 0.05),
          }
        : null,
      turns: [],
      analysis: null,
      createdAt: 0,
    });
  }
  return out;
}

const history = syntheticHistory();

const adherence = {
  days: history.map((c, i) => ({
    date: c.date,
    taken: i % 7 === 3 ? 1 : 2,
    missed: i % 7 === 3 ? 1 : 0,
    pending: 0,
  })),
  taken: 56,
  missed: 4,
  rate: 56 / 60,
};

const alerts = [
  {
    id: 'elevated_x_4',
    firedOn: dateKey(3),
    direction: 'elevated',
    streakDays: 4,
    title: 'Four days of elevated signals',
  },
];

const stats = buildStats(history, adherence, alerts, 30);
const narrative = statsDigest(stats); // stand-in for the Claude-written opening
const html = buildReportHtml('Sample Patient', narrative, stats, new Date());

mkdirSync(OUT_DIR, { recursive: true });
const path = join(OUT_DIR, 'report.html');
writeFileSync(path, html, 'utf8');

// --- structural assertions --------------------------------------------------
const failures = [];
const must = (cond, msg) => {
  if (!cond) failures.push(msg);
};

must(stats.checkIns.length === 30, `expected 30 check-ins in window, got ${stats.checkIns.length}`);
must(stats.voiceTrend.length > 10, `expected a populated voice trend, got ${stats.voiceTrend.length}`);
must(stats.alerts.length === 1, `expected the alert to fall inside the window`);
must((html.match(/<svg/g) ?? []).length === 3, 'expected exactly three figures');
must(!/NaN|undefined|Infinity/.test(html), 'rendered HTML contains NaN/undefined/Infinity');
must(/aria-label=/.test(html), 'figures are missing aria-labels');
must(/Underlying data/.test(html), 'the data table is missing');
// Every chart must also exist as readable numbers.
must((html.match(/<tr>/g) ?? []).length > 30, 'the data table looks empty');

// Empty-state path: no data at all must still render a valid document.
const emptyStats = buildStats([], { days: [], taken: 0, missed: 0, rate: 0 }, [], 30);
const emptyHtml = buildReportHtml('Nobody', 'No data yet.', emptyStats, new Date());
must(!/NaN|undefined|Infinity/.test(emptyHtml), 'empty report contains NaN/undefined/Infinity');
must((emptyHtml.match(/<svg/g) ?? []).length === 3, 'empty report is missing its figures');

if (failures.length > 0) {
  console.error(`\n  ${failures.length} report check(s) FAILED\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n  Rendered anyway: ${path}\n`);
  process.exit(1);
}

console.log(`\n  report checks passed — open ${path} to review the layout\n`);
