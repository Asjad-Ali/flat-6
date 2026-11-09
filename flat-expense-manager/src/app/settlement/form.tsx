import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { saveWithDuplicateCheck } from '../../components/dialogs';
import { Banner, EmptyState, ErrorView, LoadingView } from '../../components/feedback';
import { BalanceText } from '../../components/finance';
import { ChipSelect, DateField, MoneyField, TextField, type ChipOption } from '../../components/fields';
import { Card, Screen } from '../../components/layout';
import { todayISO } from '../../domain/dates';
import { formatPKR, paisaToInput, parseAmount } from '../../domain/money';
import { getMemberBalances, getSettlementPlan, type MemberBalance, type SuggestedPayment } from '../../db/balances';
import { validateSettlement, type SettlementFieldErrors } from '../../db/settlements';
import { useStore } from '../../data/context';
import { useAsyncData, useSubmit } from '../../hooks/data';
import { colors, font, spacing } from '../../theme';

/** Records one member paying another back (full or partial). */
export default function SettlementFormScreen() {
  const params = useLocalSearchParams<{ from?: string; to?: string }>();
  const { data, loading, error, reload } = useAsyncData(
    async (d) => ({ balances: await getMemberBalances(d), plan: await getSettlementPlan(d) }),
    [],
  );
  if (loading) return <LoadingView />;
  if (error || !data) return <ErrorView message={error ?? 'No data'} onRetry={reload} />;
  return (
    <SettlementForm
      balances={data.balances}
      plan={data.plan}
      initialFrom={params.from ? Number(params.from) : null}
      initialTo={params.to ? Number(params.to) : null}
    />
  );
}

function SettlementForm({ balances, plan, initialFrom, initialTo }: {
  balances: MemberBalance[];
  plan: SuggestedPayment[];
  initialFrom: number | null;
  initialTo: number | null;
}) {
  const store = useStore();
  const { run, busy } = useSubmit();
  const [fromId, setFromId] = useState<number | null>(initialFrom);
  const [toId, setToId] = useState<number | null>(initialTo);
  const [amount, setAmount] = useState(() => {
    const s = plan.find((p) => p.fromId === initialFrom && p.toId === initialTo);
    return s ? paisaToInput(s.amount) : '';
  });
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<SettlementFieldErrors>({});

  if (balances.length < 2) {
    return (
      <Screen>
        <EmptyState icon="people-outline" title="Need at least two members" actionLabel="Add member" onAction={() => router.replace('/member/form')} />
      </Screen>
    );
  }

  const options: ChipOption<number>[] = balances.map((b) => ({ value: b.memberId, label: b.name }));
  const suggestion = plan.find((p) => p.fromId === fromId && p.toId === toId);
  const parsed = parseAmount(amount);
  const balanceOf = (id: number | null) => balances.find((b) => b.memberId === id);

  const save = () =>
    run(async () => {
      const input = { fromId: fromId ?? NaN, toId: toId ?? NaN, amount: parsed ?? NaN, date, note };
      const fieldErrors = validateSettlement(input);
      if (amount.trim() && parsed === null) fieldErrors.amount = 'Enter a valid amount, e.g. 500 or 250.50.';
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length > 0) return;
      const saved = await saveWithDuplicateCheck((allowDuplicate) => store.createSettlement(input, { allowDuplicate }));
      if (saved !== undefined) router.back();
    });

  return (
    <Screen footer={<Button title="Save payment" icon="checkmark" onPress={save} loading={busy} />}>
      <ChipSelect label="Who paid?" options={options} value={fromId} onChange={setFromId} error={errors.fromId} />
      <ChipSelect label="Paid to" options={options.filter((o) => o.value !== fromId)} value={toId} onChange={setToId} error={errors.toId} />

      {fromId !== null && toId !== null && fromId !== toId ? (
        <Card style={styles.preview}>
          {[fromId, toId].map((id) => {
            const b = balanceOf(id);
            return b ? (
              <View key={id} style={styles.previewRow}>
                <Text style={styles.previewName}>{b.name}</Text>
                <BalanceText balance={b.balance} />
              </View>
            ) : null;
          })}
          {suggestion ? (
            <Text style={styles.suggestion}>
              Suggested: {suggestion.fromName} pays {suggestion.toName} {formatPKR(suggestion.amount)}
            </Text>
          ) : null}
        </Card>
      ) : (
        <Banner tone="info" title="Paying someone back?" message="Choose who paid and who received the money. Their balances update immediately." />
      )}

      <MoneyField label="Amount" required value={amount} onChangeText={setAmount} error={errors.amount} hint={parsed ? formatPKR(parsed) : undefined} />
      {suggestion ? (
        <View style={styles.quick}>
          <Button title={`Full amount ${formatPKR(suggestion.amount)}`} variant="secondary" compact onPress={() => setAmount(paisaToInput(suggestion.amount))} />
        </View>
      ) : null}
      <DateField label="Date" value={date} onChange={setDate} maximumDate={todayISO()} error={errors.date} />
      <TextField label="Note" value={note} onChangeText={setNote} placeholder="Optional, e.g. via JazzCash" maxLength={200} error={errors.note} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { gap: spacing.sm },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewName: { fontSize: font.body, fontWeight: '700', color: colors.text },
  suggestion: { fontSize: font.small, color: colors.primary, fontWeight: '600' },
  quick: { flexDirection: 'row' },
});
