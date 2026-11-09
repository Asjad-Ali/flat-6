import { Ionicons } from '@expo/vector-icons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { showError } from '../../components/dialogs';
import { EmptyState, ErrorView, LoadingView } from '../../components/feedback';
import { Avatar, BalanceText, CategoryBars, StatCard, StatGrid, TransactionRow } from '../../components/finance';
import { Card, Divider, InfoRow, Screen, SectionHeader } from '../../components/layout';
import { PeriodStepper, SegmentedControl } from '../../components/navigation';
import { addDays, addMonths, formatDate, formatMonth, formatRange, monthKey, monthRange, parseISODate, relativeDayLabel, toISODate, todayISO } from '../../domain/dates';
import { formatPKR } from '../../domain/money';
import { getMemberBalances } from '../../db/balances';
import { getDailyReport, getMonthlyReport, getWeeklyReport } from '../../db/reports';
import { useAsyncData, useDb, useSubmit } from '../../hooks/data';
import type { ReportPeriod } from '../../report/data';
import { exportPdfReport } from '../../report/exportPdf';
import { colors, font, spacing } from '../../theme';

type Tab = 'daily' | 'weekly' | 'monthly' | 'members';

const TABS: { value: Tab; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'members', label: 'Members' },
];

/** "Download PDF" buttons for this month, last month and all time. */
function PdfButtons() {
  const db = useDb();
  const { run, busy } = useSubmit();
  const thisMonth = monthKey(todayISO());
  const lastMonth = addMonths(thisMonth, -1);
  const periods: { title: string; period: ReportPeriod }[] = [
    { title: 'This month', period: { label: formatMonth(thisMonth), ...monthRange(thisMonth) } },
    { title: 'Last month', period: { label: formatMonth(lastMonth), ...monthRange(lastMonth) } },
    { title: 'All time', period: { label: 'All time' } },
  ];
  const download = (period: ReportPeriod) =>
    run(async () => {
      try {
        await exportPdfReport(db, period);
      } catch (e) {
        showError(e, 'Could not create PDF');
      }
    });
  return (
    <View style={styles.pdf}>
      <View style={styles.pdfTitle}>
        <Ionicons name="document-text-outline" size={18} color={colors.primary} />
        <Text style={styles.pdfLabel}>Download PDF report</Text>
      </View>
      <View style={styles.pdfButtons}>
        {periods.map((p) => (
          <Button key={p.title} title={p.title} compact variant="secondary" onPress={() => download(p.period)} disabled={busy} style={styles.pdfButton} />
        ))}
      </View>
    </View>
  );
}

export default function ReportsScreen() {
  const [tab, setTab] = useState<Tab>('monthly');
  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <PdfButtons />
        <SegmentedControl options={TABS} value={tab} onChange={setTab} />
      </View>
      {tab === 'daily' ? <DailyReport /> : null}
      {tab === 'weekly' ? <WeeklyReport /> : null}
      {tab === 'monthly' ? <MonthlyReport /> : null}
      {tab === 'members' ? <MembersReport /> : null}
    </View>
  );
}

function DailyReport() {
  const today = todayISO();
  const [date, setDate] = useState(today);
  const { data, loading, error, reload, refresh, refreshing } = useAsyncData((db) => getDailyReport(db, date), [date]);

  const pickDate = Platform.OS === 'android'
    ? () => DateTimePickerAndroid.open({ value: parseISODate(date), mode: 'date', maximumDate: new Date(), onValueChange: (_e, d) => setDate(toISODate(d)) })
    : undefined;

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <PeriodStepper label={relativeDayLabel(date)} onPrev={() => setDate(addDays(date, -1))} onNext={() => setDate(addDays(date, 1))} nextDisabled={date >= today} onPressLabel={pickDate} />
      {loading ? <LoadingView /> : error || !data ? <ErrorView message={error ?? 'No data'} onRetry={reload} /> : (
        <>
          <StatGrid>
            <StatCard label="Spent" value={formatPKR(data.total)} icon="wallet-outline" caption={formatDate(date, 'long')} />
            <StatCard label="Entries" value={String(data.expenses.length)} icon="receipt-outline" tone={colors.info} />
          </StatGrid>
          {data.expenses.length === 0 ? (
            <Card>
              <EmptyState compact icon="sunny-outline" title="No expenses on this day" />
            </Card>
          ) : (
            <>
              <SectionHeader title="By category" />
              <Card>
                <CategoryBars items={data.categories} />
              </Card>
              <SectionHeader title="Expenses" />
              <Card>
                {data.expenses.map((e) => (
                  <TransactionRow key={e.id} kind="expense" title={e.title} subtitle={e.paidByName ? `Paid by ${e.paidByName}` : e.category} category={e.category} amount={e.amount} date={e.date} onPress={() => router.push(`/expense/form?id=${e.id}`)} />
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </Screen>
  );
}

function WeeklyReport() {
  const { data, loading, error, reload, refresh, refreshing } = useAsyncData(getWeeklyReport, []);
  if (loading) return <LoadingView />;
  if (error || !data) return <ErrorView message={error ?? 'No data'} onRetry={reload} />;
  const max = Math.max(...data.map((w) => w.total), 1);
  const grand = data.reduce((a, w) => a + w.total, 0);

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      {data.length === 0 ? (
        <EmptyState icon="calendar-outline" title="No expenses yet" message="Weekly totals appear once you add expenses." />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Weeks with expenses" value={String(data.length)} icon="calendar-outline" />
            <StatCard label="Avg. per week" value={formatPKR(Math.round(grand / data.length))} icon="trending-up-outline" tone={colors.info} />
          </StatGrid>
          <Card>
            {data.map((w, i) => (
              <View key={w.from} style={i > 0 ? styles.weekGap : undefined}>
                <View style={styles.weekHeader}>
                  <Text style={styles.weekTitle}>{formatRange(w.from, w.to)}</Text>
                  <Text style={styles.weekTitle}>{formatPKR(w.total)}</Text>
                </View>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${(w.total / max) * 100}%` }]} />
                </View>
                <Text style={styles.memberMeta}>
                  {w.count} expense{w.count === 1 ? '' : 's'}
                </Text>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

function MonthlyReport() {
  const current = monthKey(todayISO());
  const [month, setMonth] = useState(current);
  const { data, loading, error, reload, refresh, refreshing } = useAsyncData((db) => getMonthlyReport(db, month), [month]);

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <PeriodStepper label={formatMonth(month)} onPrev={() => setMonth(addMonths(month, -1))} onNext={() => setMonth(addMonths(month, 1))} nextDisabled={month >= current} />
      {loading ? <LoadingView /> : error || !data ? <ErrorView message={error ?? 'No data'} onRetry={reload} /> : (
        <>
          <StatGrid>
            <StatCard label="Total spent" value={formatPKR(data.total)} icon="wallet-outline" caption={`${data.count} entries`} />
            <StatCard label="Avg. per day" value={formatPKR(data.averagePerDay)} icon="trending-up-outline" tone={colors.info} />
            <StatCard label="Paid back" value={formatPKR(data.settled)} icon="swap-horizontal" tone={colors.success} caption="Between members" />
            <StatCard label="Top category" value={data.categories[0]?.category ?? '—'} icon="pricetag-outline" tone={colors.warning} caption={data.categories[0] ? formatPKR(data.categories[0].total) : undefined} />
          </StatGrid>
          {data.count === 0 ? (
            <Card>
              <EmptyState compact icon="calendar-clear-outline" title={`No expenses in ${formatMonth(month)}`} />
            </Card>
          ) : (
            <>
              <SectionHeader title="By category" />
              <Card>
                <CategoryBars items={data.categories} />
              </Card>
              <SectionHeader title="Day by day" />
              <Card>
                {data.days.map((d, i) => (
                  <View key={d.date}>
                    {i > 0 ? <Divider /> : null}
                    <InfoRow label={`${formatDate(d.date, 'long')} · ${d.count}`} value={formatPKR(d.total)} />
                  </View>
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </Screen>
  );
}

function MembersReport() {
  const { data, loading, error, reload, refresh, refreshing } = useAsyncData((db) => getMemberBalances(db), []);
  if (loading) return <LoadingView />;
  if (error || !data) return <ErrorView message={error ?? 'No data'} onRetry={reload} />;
  const totalPaid = data.reduce((a, b) => a + b.paid, 0);
  const toSettle = data.reduce((a, b) => a + Math.max(b.balance, 0), 0);

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <StatGrid>
        <StatCard label="Paid by members" value={formatPKR(totalPaid)} icon="card-outline" />
        <StatCard label="Still to settle" value={formatPKR(toSettle)} icon="hourglass-outline" tone={colors.danger} />
      </StatGrid>
      <SectionHeader title="Each member" />
      {data.length === 0 ? (
        <Card>
          <EmptyState compact icon="people-outline" title="No members yet" actionLabel="Add member" onAction={() => router.push('/member/form')} />
        </Card>
      ) : (
        <Card style={styles.list}>
          {data.map((b, i) => (
            <Pressable key={b.memberId} onPress={() => router.push(`/member/${b.memberId}`)} android_ripple={{ color: colors.border }} style={[styles.memberRow, i > 0 && styles.border]}>
              <Avatar name={b.name} size={38} muted={!b.isActive} />
              <View style={styles.memberBody}>
                <Text style={styles.memberName}>
                  {b.name}
                  {!b.isActive ? ' (former)' : ''}
                </Text>
                <Text style={styles.memberMeta}>
                  Paid {formatPKR(b.paid)} · Share {formatPKR(b.share)}
                </Text>
              </View>
              <BalanceText balance={b.balance} />
            </Pressable>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  tabs: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  pdf: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, gap: spacing.sm },
  pdfTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pdfLabel: { fontSize: font.small, fontWeight: '700', color: colors.text },
  pdfButtons: { flexDirection: 'row', gap: spacing.sm },
  pdfButton: { flex: 1, paddingHorizontal: spacing.xs },
  weekHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  weekGap: { marginTop: spacing.lg },
  weekTitle: { fontSize: font.body, fontWeight: '800', color: colors.text },
  track: { height: 6, borderRadius: 3, backgroundColor: '#F1F5F9', marginBottom: spacing.sm, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  list: { paddingVertical: spacing.xs },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  memberBody: { flex: 1, gap: 2 },
  memberName: { fontSize: font.body, fontWeight: '700', color: colors.text },
  memberMeta: { fontSize: font.caption, color: colors.textMuted },
});
