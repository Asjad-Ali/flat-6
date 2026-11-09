import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { confirmAsync, showError } from '../../components/dialogs';
import { Banner, EmptyState, ErrorView, LoadingView } from '../../components/feedback';
import { Avatar, BalanceText, TransactionRow } from '../../components/finance';
import { Card, Fab, Screen, SectionHeader } from '../../components/layout';
import { markSuggestedPaymentPaid, SettleRow } from '../../components/settle';
import { formatPKR } from '../../domain/money';
import { getMemberBalances, getSettlementPlan } from '../../db/balances';
import { listSettlements } from '../../db/settlements';
import { useStore } from '../../data/context';
import { useAsyncData, useSubmit } from '../../hooks/data';
import { colors, font, spacing } from '../../theme';

export default function BalancesScreen() {
  const store = useStore();
  const { run, busy } = useSubmit();
  const { data, loading, error, reload, refresh, refreshing } = useAsyncData(
    async (d) => ({
      balances: await getMemberBalances(d),
      plan: await getSettlementPlan(d),
      settlements: await listSettlements(d, { limit: 50 }),
    }),
    [],
  );

  if (loading) return <LoadingView />;
  if (error || !data) return <ErrorView message={error ?? 'No data'} onRetry={reload} />;
  const { balances, plan, settlements } = data;
  const toSettle = balances.reduce((acc, b) => acc + Math.max(b.balance, 0), 0);

  const markPaid = (index: number) =>
    run(async () => {
      if (await markSuggestedPaymentPaid(store, plan[index])) await reload();
    });

  const undo = (id: number, label: string) =>
    run(async () => {
      const ok = await confirmAsync({ title: 'Delete this payment?', message: `${label} will be removed and balances recalculated.`, confirmText: 'Delete', destructive: true });
      if (!ok) return;
      try {
        await store.deleteSettlement(id);
      } catch (e) {
        showError(e, 'Could not delete');
      }
    });

  if (balances.length === 0) {
    return (
      <Screen>
        <EmptyState icon="people-outline" title="No members yet" message="Add flatmates, then add expenses with who paid. Balances show up here." actionLabel="Add member" onAction={() => router.push('/member/form')} />
      </Screen>
    );
  }

  return (
    <View style={styles.container}>
      <Screen onRefresh={refresh} refreshing={refreshing}>
        <Card style={styles.summary}>
          <Text style={styles.summaryLabel}>{toSettle > 0 ? 'Still to settle' : 'Everyone is settled up'}</Text>
          <Text style={[styles.summaryValue, { color: toSettle > 0 ? colors.text : colors.success }]}>{formatPKR(toSettle)}</Text>
          <Text style={styles.summaryCaption}>
            {plan.length > 0 ? `${plan.length} payment${plan.length === 1 ? '' : 's'} needed to settle everyone` : 'No payments needed'}
          </Text>
        </Card>

        <SectionHeader title="How to settle up" />
        <Card>
          {plan.length === 0 ? (
            <EmptyState compact icon="checkmark-done-circle-outline" title="All settled" message="Nobody owes anybody right now." />
          ) : (
            plan.map((p, i) => <SettleRow key={`${p.fromId}-${p.toId}`} payment={p} onMarkPaid={() => markPaid(i)} busy={busy} />)
          )}
        </Card>
        {plan.length > 0 ? (
          <Banner tone="info" title="Paid only part of it?" message="Use “Record payment” below and enter the amount actually paid. The plan updates automatically." />
        ) : null}

        <SectionHeader title="Balances" />
        <Card style={styles.list}>
          {balances.map((b, i) => (
            <Pressable key={b.memberId} onPress={() => router.push(`/member/${b.memberId}`)} android_ripple={{ color: colors.border }} style={[styles.row, i > 0 && styles.rowBorder]}>
              <Avatar name={b.name} size={38} muted={!b.isActive} />
              <View style={styles.rowBody}>
                <Text style={styles.name}>
                  {b.name}
                  {!b.isActive ? ' (former)' : ''}
                </Text>
                <Text style={styles.meta}>
                  Paid {formatPKR(b.paid)} · Share {formatPKR(b.share)}
                </Text>
              </View>
              <BalanceText balance={b.balance} />
            </Pressable>
          ))}
        </Card>

        <SectionHeader title={`Payments between members (${settlements.length})`} />
        <Card>
          {settlements.length === 0 ? (
            <EmptyState compact icon="swap-horizontal" title="No payments yet" message="When someone pays another member back, record it here." />
          ) : (
            settlements.map((s) => (
              <View key={s.id} style={styles.paymentRow}>
                <View style={styles.flex}>
                  <TransactionRow
                    kind="settlement"
                    title={`${s.fromName} paid ${s.toName}`}
                    subtitle={[s.note, s.createdByName ? `added by ${s.createdByName}` : null].filter(Boolean).join(' · ') || undefined}
                    amount={s.amount}
                    date={s.date}
                  />
                </View>
                {store.canEdit(s.createdBy) ? (
                  <Pressable onPress={() => undo(s.id, `${s.fromName} → ${s.toName} ${formatPKR(s.amount)}`)} hitSlop={10} style={styles.trash} accessibilityLabel="Delete payment">
                    <Ionicons name="trash-outline" size={18} color={colors.textFaint} />
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </Card>
      </Screen>
      <Fab icon="swap-horizontal" label="Record payment" onPress={() => router.push('/settlement/form')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  summary: { gap: 2 },
  summaryLabel: { fontSize: font.small, color: colors.textMuted, fontWeight: '600' },
  summaryValue: { fontSize: font.display, fontWeight: '800' },
  summaryCaption: { fontSize: font.small, color: colors.textMuted },
  list: { paddingVertical: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: font.body, fontWeight: '700', color: colors.text },
  meta: { fontSize: font.caption, color: colors.textMuted },
  paymentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  trash: { padding: spacing.xs },
});
