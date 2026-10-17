import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { buildReportHtml, statsDigest, type ReportStats } from './reportHtml';
import { reportNarrative, type CompanionContext } from './claude';

/**
 * Expo-facing half of the report: rendering to PDF and handing it to the share
 * sheet. All the document and chart construction lives in ./reportHtml, which
 * imports nothing from Expo or Firebase so it can be rendered and inspected
 * outside the app (see `npm run check:report`).
 */

export { buildReportHtml, buildStats, statsDigest } from './reportHtml';
export type { ReportAlert, ReportStats } from './reportHtml';

export type ReportResult = { uri: string; html: string };

/** Renders the report to a PDF and returns its file URI. */
export async function generateReport(
  ctx: CompanionContext,
  s: ReportStats,
): Promise<ReportResult> {
  const narrative = await reportNarrative(ctx, statsDigest(s));
  const html = buildReportHtml(ctx.displayName, narrative, s);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  return { uri, html };
}

export async function shareReport(uri: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Share your Anchor summary',
    UTI: 'com.adobe.pdf',
  });
  return true;
}
