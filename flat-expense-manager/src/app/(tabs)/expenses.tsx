import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';

import { EmptyState, ErrorView, LoadingView } from '../../components/feedback';
import { ChipSelect, type ChipOption } from '../../components/fields';
import { TransactionRow } from '../../components/finance';
import { Fab } from '../../components/layout';
import { CATEGORIES, CATEGORY_META, type Category } from '../../domain/categories';
import { dayHeader } from '../../domain/dates';
import { formatPKR } from '../../domain/money';
import { listExpenses, type Expense } from '../../db/expenses';
import { useAsyncData } from '../../hooks/data';
import { colors, font, radius, shadow, spacing } from '../../theme';

type Filter = Category | 'All';

const FILTERS: ChipOption<Filter>[] = [
  { value: 'All', label: 'All' },
  ...CATEGORIES.map((c) => ({ value: c, label: c, icon: CATEGORY_META[c].icon, color: CATEGORY_META[c].color, tint: CATEGORY_META[c].tint })),
];

export default function ExpensesScreen() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Filter>('All');
  const { data, loading, error, reload, refresh, refreshing } = useAsyncData(
    (db) => listExpenses(db, { search, category: category === 'All' ? undefined : category }),
    [search, category],
  );

  const sections = useMemo(() => {
    const groups = new Map<string, Expense[]>();
    for (const e of data ?? []) {
      if (!groups.has(e.date)) groups.set(e.date, []);
      groups.get(e.date)!.push(e);
    }
    return [...groups.entries()].map(([date, items]) => ({
      date,
      total: items.reduce((acc, e) => acc + e.amount, 0),
      data: items,
    }));
  }, [data]);

  const total = (data ?? []).reduce((acc, e) => acc + e.amount, 0);
  const filtered = search.trim() !== '' || category !== 'All';

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;

  return (
    <View style={styles.container}>
      <View style={styles.filters}>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.textFaint} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search title or who paid"
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            returnKeyType="search"
          />
          {search ? <Ionicons name="close-circle" size={18} color={colors.textFaint} onPress={() => setSearch('')} /> : null}
        </View>
        <ChipSelect options={FILTERS} value={category} onChange={setCategory} scroll />
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>
            {data?.length ?? 0} {data?.length === 1 ? 'expense' : 'expenses'}
            {filtered ? ' (filtered)' : ''}
          </Text>
          <Text style={styles.summaryValue}>{formatPKR(total)}</Text>
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primary]} />}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionDate}>{dayHeader(section.date)}</Text>
            <Text style={styles.sectionTotal}>{formatPKR(section.total)}</Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <View
            style={[
              styles.item,
              index === 0 && styles.itemFirst,
              index === section.data.length - 1 && styles.itemLast,
            ]}
          >
            <TransactionRow
              kind="expense"
              title={item.title}
              subtitle={item.paidByName ? `Paid by ${item.paidByName} · ${item.splitCount} people` : 'Paid by: not set'}
              category={item.category}
              amount={item.amount}
              date={item.date}
              onPress={() => router.push(`/expense/form?id=${item.id}`)}
            />
          </View>
        )}
        ListEmptyComponent={
          filtered ? (
            <EmptyState icon="search" title="No matching expenses" message="Try a different search or category." />
          ) : (
            <EmptyState
              icon="receipt-outline"
              title="No expenses yet"
              message="Record shared flat expenses like groceries, milk and bills. They all go into one common ledger."
              actionLabel="Add first expense"
              onAction={() => router.push('/expense/form')}
            />
          )
        }
      />
      <Fab label="Add expense" onPress={() => router.push('/expense/form')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  filters: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md, backgroundColor: colors.background },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 46,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: font.body, color: colors.text },
  summary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: spacing.xs },
  summaryLabel: { fontSize: font.small, color: colors.textMuted },
  summaryValue: { fontSize: font.subtitle, fontWeight: '800', color: colors.text },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 110 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.lg, paddingBottom: spacing.sm },
  sectionDate: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  sectionTotal: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  item: { backgroundColor: colors.surface, paddingHorizontal: spacing.md, ...shadow, elevation: 0 },
  itemFirst: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.xs },
  itemLast: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, paddingBottom: spacing.xs },
});
