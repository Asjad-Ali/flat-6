import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { confirmAsync, saveWithDuplicateCheck, showError } from '../../components/dialogs';
import { Banner, EmptyState, ErrorView, LoadingView } from '../../components/feedback';
import { ChipSelect, DateField, MoneyField, TextField, type ChipOption } from '../../components/fields';
import { Avatar } from '../../components/finance';
import { Card, InfoRow, Screen } from '../../components/layout';
import { SegmentedControl } from '../../components/navigation';
import { CATEGORIES, CATEGORY_META, type Category } from '../../domain/categories';
import { formatDate, formatTimestamp, isValidISODate, todayISO } from '../../domain/dates';
import { formatPKR, paisaToInput, parseAmount } from '../../domain/money';
import { checkSplit, equalSplit, type SplitEntry, type SplitMode } from '../../domain/split';
import {
  getExpense,
  validateExpense,
  type ExpenseDetail,
  type ExpenseFieldErrors,
  type ExpenseInput,
} from '../../db/expenses';
import { listMembers, type Member } from '../../db/members';
import { useStore } from '../../data/context';
import { useAsyncData, useSubmit } from '../../hooks/data';
import { colors, font, radius, spacing } from '../../theme';

const CATEGORY_OPTIONS: ChipOption<Category>[] = CATEGORIES.map((c) => ({
  value: c,
  label: c,
  icon: CATEGORY_META[c].icon,
  color: CATEGORY_META[c].color,
  tint: CATEGORY_META[c].tint,
}));

const SPLIT_MODES: { value: SplitMode; label: string }[] = [
  { value: 'equal', label: 'Equally' },
  { value: 'amounts', label: 'By amounts' },
];

/** Loads the expense being edited (if any) and the members, then renders the form. */
export default function ExpenseFormScreen() {
  const params = useLocalSearchParams<{ id?: string; date?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const initialDate = params.date && isValidISODate(params.date) ? params.date : todayISO();
  const store = useStore();

  const { data, loading, error, reload } = useAsyncData(
    async (d) => ({
      expense: id ? await getExpense(d, id) : null,
      members: await listMembers(d, { includeInactive: true }),
    }),
    [id],
  );

  return (
    <>
      <Stack.Screen options={{ title: !id ? 'New expense' : data?.expense && !store.canEdit(data.expense.createdBy) ? 'Expense details' : 'Edit expense' }} />
      {loading ? (
        <LoadingView />
      ) : error || !data || (id && !data.expense) ? (
        <ErrorView message={error ?? 'This expense no longer exists.'} onRetry={reload} />
      ) : (
        data.expense && !store.canEdit(data.expense.createdBy) ? (
          <ExpenseReadOnly expense={data.expense} />
        ) : (
          <ExpenseForm expense={data.expense} allMembers={data.members} initialDate={initialDate} />
        )
      )}
    </>
  );
}

/** Shown to members who did not add this expense. */
function ExpenseReadOnly({ expense }: { expense: ExpenseDetail }) {
  const owner = expense.createdByName ?? 'the person who added it';
  return (
    <Screen>
      <Banner tone="neutral" icon="lock-closed" title={`Added by ${owner}`} message={`Only ${owner} can change or delete this expense.`} />
      <Card style={styles.readCard}>
        <Text style={styles.readTitle}>{expense.title}</Text>
        <Text style={styles.readAmount}>{formatPKR(expense.amount)}</Text>
        <InfoRow label="Paid by" value={expense.paidByName ?? 'Not set'} bold />
        <InfoRow label="Date" value={formatDate(expense.date, 'long')} />
        <InfoRow label="Category" value={expense.category} />
        {expense.description ? <Text style={styles.readDescription}>{expense.description}</Text> : null}
      </Card>
      <Card>
        <Text style={styles.label}>{expense.splitMode === 'equal' ? 'Split equally between' : 'Split by amounts'}</Text>
        {expense.splits.map((s) => (
          <InfoRow key={s.memberId} label={s.memberName} value={formatPKR(s.amount)} />
        ))}
      </Card>
      <Text style={styles.addedBy}>Added by {owner} · {formatTimestamp(expense.createdAt)}</Text>
    </Screen>
  );
}

function ExpenseForm({ expense, allMembers, initialDate }: { expense: ExpenseDetail | null; allMembers: Member[]; initialDate: string }) {
  const store = useStore();
  const { run, busy } = useSubmit();

  // Active members, plus former members who are already part of this expense.
  const members = useMemo(
    () =>
      allMembers.filter(
        (m) => m.isActive || m.id === expense?.paidBy || expense?.splits.some((s) => s.memberId === m.id),
      ),
    [allMembers, expense],
  );

  const [title, setTitle] = useState(expense?.title ?? '');
  const [amount, setAmount] = useState(expense ? paisaToInput(expense.amount) : '');
  const [category, setCategory] = useState<Category | null>(expense?.category ?? 'Other');
  const [date, setDate] = useState(expense?.date ?? initialDate);
  const [description, setDescription] = useState(expense?.description ?? '');
  const [paidBy, setPaidBy] = useState<number | null>(expense?.paidBy ?? null);
  const [mode, setMode] = useState<SplitMode>(expense?.splitMode ?? 'equal');
  const [selected, setSelected] = useState<Set<number>>(() =>
    expense && expense.splits.length > 0
      ? new Set(expense.splits.map((s) => s.memberId))
      : new Set(members.filter((m) => m.isActive).map((m) => m.id)),
  );
  const [custom, setCustom] = useState<Record<number, string>>(() =>
    Object.fromEntries((expense?.splits ?? []).map((s) => [s.memberId, paisaToInput(s.amount)])),
  );
  const [errors, setErrors] = useState<ExpenseFieldErrors>({});

  const total = parseAmount(amount);

  const split = useMemo(() => {
    if (mode === 'equal') {
      const ids = members.filter((m) => selected.has(m.id)).map((m) => m.id);
      return { splits: equalSplit(total ?? 0, ids), invalid: new Set<number>() };
    }
    const invalid = new Set<number>();
    const splits: SplitEntry[] = members.map((m) => {
      const raw = (custom[m.id] ?? '').trim();
      const value = raw === '' ? 0 : parseAmount(raw);
      if (value === null) invalid.add(m.id);
      return { memberId: m.id, amount: value ?? 0 };
    });
    return { splits, invalid };
  }, [mode, members, selected, custom, total]);

  const check = checkSplit(total ?? 0, split.splits);
  const shareOf = (memberId: number) => split.splits.find((s) => s.memberId === memberId)?.amount ?? 0;

  if (members.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="people-outline"
          title="Add members first"
          message="Every expense needs someone who paid and people to split it with."
          actionLabel="Add member"
          onAction={() => router.replace('/member/form')}
        />
      </Screen>
    );
  }

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const changeMode = (next: SplitMode) => {
    // Start "by amounts" from the current equal shares so the user only adjusts.
    if (next === 'amounts' && mode === 'equal' && total) {
      setCustom(Object.fromEntries(split.splits.map((s) => [s.memberId, s.amount > 0 ? paisaToInput(s.amount) : ''])));
    }
    if (next === 'equal' && mode === 'amounts') {
      setSelected(new Set(split.splits.filter((s) => s.amount > 0).map((s) => s.memberId)));
    }
    setMode(next);
  };

  const fillRest = (memberId: number) => {
    const next = shareOf(memberId) + check.remaining;
    if (next >= 0) setCustom((c) => ({ ...c, [memberId]: paisaToInput(next) }));
  };

  const save = () =>
    run(async () => {
      const input: ExpenseInput = {
        title,
        description,
        amount: total ?? NaN,
        category: category ?? '',
        date,
        paidBy: paidBy ?? NaN,
        splitMode: mode,
        splits: split.splits.filter((s) => s.amount > 0),
      };
      const fieldErrors = validateExpense(input);
      if (amount.trim() && total === null) fieldErrors.amount = 'Enter a valid amount, e.g. 1250 or 99.50.';
      if (split.invalid.size > 0) fieldErrors.splits = 'Fix the highlighted amounts.';
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length > 0) return;
      const saved = await saveWithDuplicateCheck(async (allowDuplicate) => {
        await store.saveExpense(expense?.id, input, { allowDuplicate });
        return true;
      });
      if (saved) router.back();
    });

  const remove = () =>
    run(async () => {
      if (!expense) return;
      const ok = await confirmAsync({
        title: 'Delete expense?',
        message: `"${expense.title}" (${formatPKR(expense.amount)}) will be removed and everyone's balance updated.`,
        confirmText: 'Delete',
        destructive: true,
      });
      if (!ok) return;
      try {
        await store.deleteExpense(expense.id);
        router.back();
      } catch (err) {
        showError(err, 'Could not delete');
      }
    });

  const payerOptions: ChipOption<number>[] = members.map((m) => ({ value: m.id, label: m.name }));
  const selectedCount = split.splits.filter((s) => s.amount > 0).length;
  const remainingColor = check.remaining === 0 ? colors.success : check.remaining > 0 ? colors.warning : colors.danger;

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          {expense ? <Button title="Delete" variant="danger" icon="trash-outline" onPress={remove} disabled={busy} style={styles.delete} /> : null}
          <Button title={expense ? 'Save changes' : 'Add expense'} icon="checkmark" onPress={save} loading={busy} style={styles.save} />
        </View>
      }
    >
      {expense?.createdByName ? (
        <Text style={styles.addedBy}>Added by {expense.createdByName} · {formatTimestamp(expense.createdAt)}</Text>
      ) : null}
      {expense && expense.paidBy === null ? (
        <Banner tone="warning" icon="person" title="Choose who paid" message="This expense was added before 'Paid by' existed. Pick the payer and who shares it." />
      ) : null}

      <TextField label="Title" required value={title} onChangeText={setTitle} placeholder="e.g. Weekly groceries" error={errors.title} maxLength={80} autoFocus={!expense} />
      <MoneyField label="Amount" required value={amount} onChangeText={setAmount} error={errors.amount} hint={total ? formatPKR(total) : undefined} />
      <ChipSelect label="Paid by" options={payerOptions} value={paidBy} onChange={setPaidBy} error={errors.paidBy} />

      <View style={styles.splitHeader}>
        <Text style={styles.label}>Split between</Text>
        {mode === 'equal' ? (
          <Text style={styles.splitSummary}>
            {selectedCount > 0 && total ? `${formatPKR(Math.floor(total / selectedCount))} each · ${selectedCount} people` : `${selected.size} selected`}
          </Text>
        ) : null}
      </View>
      <SegmentedControl options={SPLIT_MODES} value={mode} onChange={changeMode} />

      <Card style={styles.splitCard}>
        {members.map((m, i) => {
          const share = shareOf(m.id);
          const isPayer = m.id === paidBy;
          const checked = selected.has(m.id);
          return (
            <View key={m.id} style={[styles.row, i > 0 && styles.rowBorder]}>
              {mode === 'equal' ? (
                <Pressable onPress={() => toggle(m.id)} style={styles.rowPress} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={`Split with ${m.name}`}>
                  <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={24} color={checked ? colors.primary : colors.textFaint} />
                  <Avatar name={m.name} size={32} muted={!m.isActive} />
                  <View style={styles.rowBody}>
                    <Text style={styles.name} numberOfLines={1}>
                      {m.name}
                    </Text>
                    {isPayer ? <Text style={styles.payer}>Paid</Text> : null}
                  </View>
                  <Text style={[styles.share, !checked && styles.shareOff]}>{checked && total ? formatPKR(share) : '—'}</Text>
                </Pressable>
              ) : (
                <View style={styles.rowPress}>
                  <Avatar name={m.name} size={32} muted={!m.isActive} />
                  <View style={styles.rowBody}>
                    <Text style={styles.name} numberOfLines={1}>
                      {m.name}
                    </Text>
                    {split.invalid.has(m.id) ? (
                      <Text style={styles.invalid}>Invalid amount</Text>
                    ) : check.remaining > 0 && total ? (
                      <Text style={styles.fill} onPress={() => fillRest(m.id)} suppressHighlighting>
                        + Add rest {formatPKR(check.remaining)}
                      </Text>
                    ) : isPayer ? (
                      <Text style={styles.payer}>Paid</Text>
                    ) : null}
                  </View>
                  <View style={[styles.inputWrap, split.invalid.has(m.id) && styles.inputInvalid]}>
                    <Text style={styles.prefix}>Rs.</Text>
                    <TextInput
                      value={custom[m.id] ?? ''}
                      onChangeText={(t) => setCustom((c) => ({ ...c, [m.id]: t.replace(/[^\d.,]/g, '') }))}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textFaint}
                      style={styles.input}
                      accessibilityLabel={`Share for ${m.name}`}
                    />
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </Card>
      {mode === 'amounts' && total ? (
        <Text style={[styles.remaining, { color: remainingColor }]}>
          {check.remaining === 0 ? 'Shares add up to the total ✓' : check.remaining > 0 ? `${formatPKR(check.remaining)} left to assign` : `${formatPKR(-check.remaining)} too much`}
        </Text>
      ) : null}
      {errors.splits ? <Text style={styles.error}>{errors.splits}</Text> : null}

      <ChipSelect label="Category" options={CATEGORY_OPTIONS} value={category} onChange={setCategory} error={errors.category} />
      <DateField label="Date" value={date} onChange={setDate} maximumDate={todayISO()} error={errors.date} />
      <TextField label="Description" value={description} onChangeText={setDescription} placeholder="Optional details (shop, items, bill month…)" multiline maxLength={300} error={errors.description} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: 12 },
  delete: { flex: 1 },
  save: { flex: 2 },
  label: { fontSize: font.small, fontWeight: '600', color: colors.text },
  splitHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs },
  splitSummary: { fontSize: font.caption, color: colors.textMuted, fontWeight: '600' },
  splitCard: { paddingVertical: spacing.xs },
  row: { paddingVertical: spacing.sm },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowPress: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: font.body, fontWeight: '600', color: colors.text },
  payer: { fontSize: font.caption, color: colors.success, fontWeight: '700' },
  share: { fontSize: font.body, fontWeight: '700', color: colors.text },
  shareOff: { color: colors.textFaint },
  fill: { fontSize: font.caption, color: colors.primary, fontWeight: '700' },
  invalid: { fontSize: font.caption, color: colors.danger, fontWeight: '600' },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 120,
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
  },
  inputInvalid: { borderColor: colors.danger },
  prefix: { fontSize: font.small, color: colors.textMuted, fontWeight: '700', marginRight: 4 },
  input: { flex: 1, minWidth: 0, fontSize: font.body, fontWeight: '700', color: colors.text, textAlign: 'right' },
  remaining: { fontSize: font.small, fontWeight: '700', textAlign: 'center' },
  error: { fontSize: font.caption, color: colors.danger, fontWeight: '500' },
  addedBy: { fontSize: font.caption, color: colors.textMuted, textAlign: 'center' },
  readCard: { gap: spacing.xs },
  readTitle: { fontSize: font.title, fontWeight: '800', color: colors.text },
  readAmount: { fontSize: font.display, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  readDescription: { fontSize: font.small, color: colors.textMuted, marginTop: spacing.xs },
});
