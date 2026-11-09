import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { useDb, useSubmit } from '../hooks/data';
import { exportPdfReport } from '../report/exportPdf';
import { colors, font, radius, spacing } from '../theme';
import { showError } from './dialogs';

export const ALL_TIME = { label: 'All time' } as const;

/** Hook that creates the all-time PDF report (all expenses, balances and payments). */
export function useAllTimePdf() {
  const db = useDb();
  const { run, busy } = useSubmit();
  const download = () =>
    run(async () => {
      try {
        await exportPdfReport(db, ALL_TIME);
      } catch (e) {
        showError(e, 'Could not create PDF');
      }
    });
  return { download, busy };
}

/** Compact "PDF" button for screen headers. */
export function PdfHeaderButton() {
  const { download, busy } = useAllTimePdf();
  return (
    <Pressable onPress={download} disabled={busy} style={styles.button} accessibilityLabel="Download PDF report of all expenses" hitSlop={8}>
      {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="download-outline" size={16} color={colors.primary} />}
      <Text style={styles.label}>PDF</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.md,
    height: 34,
    borderRadius: radius.pill,
    marginRight: spacing.lg,
  },
  label: { color: colors.primary, fontWeight: '800', fontSize: font.small },
});
