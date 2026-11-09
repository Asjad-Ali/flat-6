import { StyleSheet, Text, View } from 'react-native';

import type { SuggestedPayment } from '../db/balances';
import type { Store } from '../data/context';
import { todayISO } from '../domain/dates';
import { formatPKR } from '../domain/money';
import { colors, font, spacing } from '../theme';
import { Button } from './Button';
import { confirmAsync, saveWithDuplicateCheck } from './dialogs';
import { Avatar } from './finance';

/** One "Bilal → Ali  Rs. 500  [Mark paid]" line of the settle-up plan. */
export function SettleRow({ payment, onMarkPaid, busy }: { payment: SuggestedPayment; onMarkPaid?: () => void; busy?: boolean }) {
  return (
    <View style={styles.row}>
      <Avatar name={payment.fromName} size={34} />
      <View style={styles.body}>
        <Text style={styles.sentence} numberOfLines={2}>
          <Text style={styles.name}>{payment.fromName}</Text> pays <Text style={styles.name}>{payment.toName}</Text>
        </Text>
        <Text style={styles.amount}>{formatPKR(payment.amount)}</Text>
      </View>
      {onMarkPaid ? <Button title="Mark paid" compact variant="secondary" icon="checkmark" onPress={onMarkPaid} disabled={busy} /> : null}
    </View>
  );
}

/** Confirms and records a suggested payment in full. Resolves true if it was saved. */
export async function markSuggestedPaymentPaid(store: Store, p: SuggestedPayment): Promise<boolean> {
  const ok = await confirmAsync({
    title: 'Mark as paid?',
    message: `${p.fromName} paid ${p.toName} ${formatPKR(p.amount)}. This is recorded with today's date.`,
    confirmText: 'Mark paid',
  });
  if (!ok) return false;
  const saved = await saveWithDuplicateCheck((allowDuplicate) =>
    store.createSettlement({ fromId: p.fromId, toId: p.toId, amount: p.amount, date: todayISO() }, { allowDuplicate }),
  );
  return saved !== undefined;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  body: { flex: 1, minWidth: 0, gap: 2 },
  sentence: { fontSize: font.body, color: colors.textMuted },
  name: { fontWeight: '700', color: colors.text },
  amount: { fontSize: font.body, fontWeight: '800', color: colors.danger },
});
