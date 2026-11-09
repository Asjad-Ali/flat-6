import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { showError } from '../../components/dialogs';
import { Badge, EmptyState, ErrorView, LoadingView } from '../../components/feedback';
import { Avatar, StatCard, StatGrid, TransactionRow } from '../../components/finance';
import { Card, Screen, SectionHeader } from '../../components/layout';
import { markSuggestedPaymentPaid, SettleRow } from '../../components/settle';
import { formatPKR } from '../../domain/money';
import { getMemberBalance, getSettlementPlan } from '../../db/balances';
import { listExpensesForMember } from '../../db/expenses';
import { getMember } from '../../db/members';
import { listSettlements } from '../../db/settlements';
import { useStore } from '../../data/context';
import { useAsyncData, useSubmit } from '../../hooks/data';
import { colors, font, spacing } from '../../theme';

export default function MemberAccountScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const store = useStore();
  const { run, busy } = useSubmit();
  const { data, loading, error, reload, refresh, refreshing } = useAsyncData(
    async (d) => {
      const member = await getMember(d, id);
      if (!member) return null;
      const [balance, plan, expenses, settlements] = await Promise.all([
        getMemberBalance(d, id),
        getSettlementPlan(d),
        listExpensesForMember(d, id),
        listSettlements(d, { memberId: id }),
      ]);
      return { member, balance, plan: plan.filter((p) => p.fromId === id || p.toId === id), expenses, settlements };
    },
    [id],
  );

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!data) return <ErrorView message="This member no longer exists." />;

  const { member, balance, plan, expenses, settlements } = data;
  const bal = balance?.balance ?? 0;

  const markPaid = (i: number) =>
    run(async () => {
      if (await markSuggestedPaymentPaid(store, plan[i])) await reload();
    });

  const restore = () =>
    run(async () => {
      try {
        await store.restoreMember(member.id);
      } catch (e) {
        showError(e, 'Could not restore');
      }
    });

  return (
    <>
      <Stack.Screen
        options={{
          title: member.name,
          headerRight: () =>
            store.canManageMembers ? (
            <Pressable onPress={() => router.push(`/member/form?id=${member.id}`)} hitSlop={10} accessibilityLabel="Edit member">
              <Ionicons name="create-outline" size={22} color={colors.primary} />
            </Pressable>
            ) : null,
        }}
      />
      <Screen onRefresh={refresh} refreshing={refreshing}>
        <Card style={styles.profile}>
          <Avatar name={member.name} size={56} muted={!member.isActive} />
          <View style={styles.profileBody}>
            <Text style={styles.name}>{member.name}</Text>
            {member.phone ? <Text style={styles.meta}>{member.phone}</Text> : null}
            {member.email ? <Text style={styles.meta}>{member.email}</Text> : null}
            {!member.isActive ? <Badge label="Former member" /> : null}
          </View>
        </Card>

        <Card style={styles.balanceCard}>
          <Text style={styles.balLabel}>{bal > 0 ? 'Gets back' : bal < 0 ? 'Owes' : 'Balance'}</Text>
          <Text style={[styles.balValue, { color: bal > 0 ? colors.success : bal < 0 ? colors.danger : colors.textMuted }]}>
            {bal === 0 ? 'Settled up' : formatPKR(Math.abs(bal))}
          </Text>
        </Card>

        <StatGrid>
          <StatCard label="Paid for group" value={formatPKR(balance?.paid ?? 0)} icon="card-outline" tone={colors.success} />
          <StatCard label="Own share" value={formatPKR(balance?.share ?? 0)} icon="pie-chart-outline" tone={colors.warning} />
        </StatGrid>

        {plan.length > 0 ? (
          <>
            <SectionHeader title="To settle" />
            <Card>
              {plan.map((p, i) => (
                <SettleRow key={`${p.fromId}-${p.toId}`} payment={p} onMarkPaid={() => markPaid(i)} busy={busy} />
              ))}
            </Card>
          </>
        ) : null}

        {!member.isActive && store.canManageMembers ? <Button title="Restore member" icon="refresh" variant="secondary" onPress={restore} loading={busy} /> : null}

        <SectionHeader title={`Expenses (${expenses.length})`} />
        <Card>
          {expenses.length === 0 ? (
            <EmptyState compact icon="receipt-outline" title="No expenses yet" />
          ) : (
            expenses.map((e) => {
              const paid = e.paidBy === member.id;
              return (
                <TransactionRow
                  key={e.id}
                  kind="expense"
                  title={e.title}
                  subtitle={paid ? `You paid · your share ${formatPKR(e.myShare)}` : `Paid by ${e.paidByName ?? '?'} · your share ${formatPKR(e.myShare)}`}
                  category={e.category}
                  amount={e.amount}
                  date={e.date}
                  onPress={() => router.push(`/expense/form?id=${e.id}`)}
                />
              );
            })
          )}
        </Card>

        <SectionHeader title={`Payments (${settlements.length})`} />
        <Card>
          {settlements.length === 0 ? (
            <EmptyState compact icon="swap-horizontal" title="No payments yet" />
          ) : (
            settlements.map((s) => (
              <TransactionRow
                key={s.id}
                kind="settlement"
                title={s.fromId === member.id ? `Paid ${s.toName}` : `Received from ${s.fromName}`}
                subtitle={s.note ?? undefined}
                amount={s.amount}
                date={s.date}
              />
            ))
          )}
        </Card>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  profileBody: { flex: 1, gap: 3 },
  name: { fontSize: font.title, fontWeight: '800', color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted },
  balanceCard: { gap: 4 },
  balLabel: { fontSize: font.small, color: colors.textMuted, fontWeight: '600' },
  balValue: { fontSize: font.display, fontWeight: '800', marginVertical: 2 },
});
