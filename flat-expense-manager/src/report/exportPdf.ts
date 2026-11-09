import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { Db } from '../db/client';
import { todayISO } from '../domain/dates';
import { getReportData, type ReportPeriod } from './data';
import { buildReportHtml } from './html';

/**
 * Web: loads the report into a hidden same-page frame and prints it once it has fully
 * rendered (printing earlier gives a blank page). Choose "Save as PDF" in the dialog.
 * No pop-up window is used, so it also works where pop-ups are blocked.
 */
function printHtmlOnWeb(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    frame.onload = () => {
      // Give layout a moment before opening the print dialog.
      setTimeout(() => {
        try {
          const win = frame.contentWindow;
          if (!win) throw new Error('Could not prepare the report for printing.');
          win.focus();
          win.print();
          resolve();
        } catch (e) {
          reject(e);
        } finally {
          setTimeout(() => frame.remove(), 60_000);
        }
      }, 400);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

/** A4 at 72 dpi. */
const A4 = { width: 595, height: 842 };

/**
 * Creates the PDF report and opens the share sheet (save to Files, WhatsApp, email…).
 * On web, opens the report in a new tab with the print dialog, where "Save as PDF" is available.
 */
export async function exportPdfReport(db: Db, period: ReportPeriod): Promise<void> {
  const html = buildReportHtml(await getReportData(db, period, todayISO()));

  if (Platform.OS === 'web') {
    await printHtmlOnWeb(html);
    return;
  }

  const { uri } = await Print.printToFileAsync({ html, ...A4 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Flat expense report' });
  } else {
    await Print.printAsync({ uri });
  }
}
