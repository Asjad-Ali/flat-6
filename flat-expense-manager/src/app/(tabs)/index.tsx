import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { confirmAsync } from '../../components/dialogs';
import { Banner, EmptyState, ErrorView, LoadingView } from '../../components/feedback';
import { StatCard, StatGrid, TransactionRow } from '../../components/finance';
import { Card, Screen, SectionHeader } from '../../components/layout';
import { useAllTimePdf } from '../../components/PdfButton';
import { markSuggestedPaymentPaid, SettleRow } from '../../components/settle';
import { formatDate, todayISO } from '../../domain/dates';
import { formatPKR } from '../../domain/money';
import { getDashboard } from '../../db/reports';
import { useStore } from '../../data/context';
import { useAsyncData, useSubmit } from '../../hooks/data';
import { colors, font, radius, spacing } from '../../theme';

type IconName = keyof typeof Ionicons.glyphMap;

function QuickAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]} accessibilityRole="button">
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

/** "Synced · 2 min ago" / "Syncing…" / "Offline · showing saved data". Tap to sync now. */
function SyncPill() {
  const store = useStore();
  const { status, lastSyncedAt, message } = store.sync;
  const tone =
    status === 'offline' ? { fg: colors.warning, bg: colors.warningSoft, icon: 'cloud-offline-outline' as const }
    : status === 'error' ? { fg: colors.danger, bg: colors.dangerSoft, icon: 'warning-outline' as const }
    : status === 'syncing' ? { fg: colors.info, bg: colors.infoSoft, icon: 'sync-outline' as const }
    : { fg: colors.success, bg: colors.successSoft, icon: 'cloud-done-outline' as const };
  const label =
    status === 'syncing' ? 'Syncing…'
    : status === 'offline' ? 'Offline · showing saved data · tap to retry'
    : status === 'error' ? `Sync problem · tap to retry${message ? ` (${message})` : ''}`
    : lastSyncedAt ? `Synced with everyone · ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'Synced';
  return (
    <Pressable onPress={() => void store.refresh()} style={[styles.pill, { backgroundColor: tone.bg }]} accessibilityRole="button">
      <Ionicons name={tone.icon} size={14} color={tone.fg} />
      <Text style={[styles.pillText, { color: tone.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function DashboardScreen() {
  const store = useStore();
  const { run, busy } = useSubmit();
  const pdf = useAllTimePdf();
  const { data, loading, error, reload, refresh, refreshing } = useAsyncData(getDashboard, []);

  if (loading) return <LoadingView />;
  if (error || !data) return <ErrorView message={error ?? 'No data'} onRetry={reload} />;

  const logOut = () =>
    run(async () => {
      const ok = await confirmAsync({
        title: 'Log out?',
        message: 'The shared data is removed from this phone until you log in again. Nothing is lost online.',
        confirmText: 'Log out',
      });
      if (ok) await store.signOut();
    });

  const markPaid = (i: number) =>
    run(async () => {
      if (await markSuggestedPaymentPaid(store, data.plan[i])) await reload();
    });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Screen onRefresh={refresh} refreshing={refreshing}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.greeting} numberOfLines={1}>
              {store.me ? `Hi, ${store.me.name.split(' ')[0]}` : 'Flat Expense Manager'}
            </Text>
            <Text style={styles.date}>{formatDate(todayISO(), 'long')}</Text>
          </View>
          {store.mode === 'cloud' ? (
            <Pressable onPress={logOut} style={styles.iconButton} accessibilityLabel="Log out" hitSlop={6}>
              <Ionicons name="log-out-outline" size={22} color={colors.textMuted} />
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.push('/expense/form')} style={styles.headerButton} accessibilityLabel="Add expense">
            <Ionicons name="add" size={24} color={colors.textOnPrimary} />
          </Pressable>
        </View>
        {store.mode === 'cloud' ? <SyncPill /> : null}

        <Pressable onPress={() => router.push('/balances')} style={({ pressed }) => [styles.hero, pressed && { opacity: 0.95 }]}>
          <Text style={styles.heroLabel}>{data.toSettle > 0 ? 'Still to settle in the group' : 'Group status'}</Text>
          <Text style={styles.heroValue}>{data.toSettle > 0 ? formatPKR(data.toSettle) : 'All settled up'}</Text>
          <Text style={styles.heroCaption}>
            {data.plan.length > 0 ? `${data.plan.length} payment${data.plan.length === 1 ? '' : 's'} needed` : 'Nobody owes anybody'}
          </Text>
          <View style={styles.heroFooter}>
            <Text style={styles.heroLink}>See balances</Text>
            <Ionicons name="arrow-forward" size={16} color={colors.textOnPrimary} />
          </View>
        </Pressable>

        <StatGrid>
          <StatCard label="Total expenses" value={formatPKR(data.totalExpenses)} icon="wallet-outline" caption="All time" />
          <StatCard label="This week" value={formatPKR(data.periodExpenses)} icon="calendar-outline" tone={colors.info} caption={data.period.label} />
        </StatGrid>

        {data.memberCount === 0 ? (
          <Banner tone="primary" icon="person-add" title="Add your flatmates" message="Add everyone in the flat, then record who paid for what." action={{ label: 'Add member', onPress: () => router.push('/member/form') }} />
        ) : null}
        {data.expensesWithoutPayer > 0 ? (
          <Banner
            tone="warning"
            icon="person"
            title={`${data.expensesWithoutPayer} expense${data.expensesWithoutPayer === 1 ? ' has' : 's have'} no “Paid by”`}
            message="They were added before. Open them and choose who paid so balances include them."
            action={{ label: 'Open expenses', onPress: () => router.push('/expenses') }}
          />
        ) : null}

        <Card style={styles.actions}>
          <QuickAction icon="receipt-outline" label="Add expense" onPress={() => router.push('/expense/form')} />
          <QuickAction icon="swap-horizontal" label="Record payment" onPress={() => router.push('/settlement/form')} />
          <QuickAction icon="document-text-outline" label={pdf.busy ? 'Creating…' : 'PDF report'} onPress={pdf.download} />
          <QuickAction icon="person-add-outline" label="Add member" onPress={() => router.push('/member/form')} />
        </Card>

        {data.plan.length > 0 ? (
          <>
            <SectionHeader title="Who pays whom" action={data.plan.length > 3 ? 'See all' : undefined} onAction={() => router.push('/balances')} />
            <Card>
              {data.plan.slice(0, 3).map((p, i) => (
                <SettleRow key={`${p.fromId}-${p.toId}`} payment={p} onMarkPaid={() => markPaid(i)} busy={busy} />
              ))}
            </Card>
          </>
        ) : null}

        <SectionHeader title="Recent activity" action={data.recent.length ? 'See all' : undefined} onAction={() => router.push('/expenses')} />
        <Card>
          {data.recent.length === 0 ? (
            <EmptyState compact icon="receipt-outline" title="Nothing yet" message="Add an expense: choose who paid and who shares it." actionLabel="Add expense" onAction={() => router.push('/expense/form')} />
          ) : (
            data.recent.map((t) => (
              <TransactionRow
                key={`${t.kind}-${t.id}`}
                kind={t.kind}
                title={t.label}
                subtitle={t.detail}
                category={t.category}
                amount={t.amount}
                date={t.date}
                onPress={t.kind === 'expense' ? () => router.push(`/expense/form?id=${t.id}`) : () => router.push('/balances')}
              />
            ))
          )}
        </Card>
      </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  greeting: { fontSize: font.headline, fontWeight: '800', color: colors.text },
  headerText: { flex: 1, minWidth: 0 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: spacing.xs },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, maxWidth: '100%' },
  pillText: { fontSize: font.caption, fontWeight: '700', flexShrink: 1 },
  date: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  headerButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  hero: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.xl, gap: 4 },
  heroLabel: { color: '#C7D2FE', fontSize: font.small, fontWeight: '600' },
  heroValue: { color: colors.textOnPrimary, fontSize: font.display, fontWeight: '800', marginTop: 4 },
  heroCaption: { color: '#E0E7FF', fontSize: font.small },
  heroFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  heroLink: { color: colors.textOnPrimary, fontWeight: '700', fontSize: font.small },
  actions: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.md },
  action: { flex: 1, alignItems: 'center', gap: 6 },
  actionIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: font.caption, fontWeight: '600', color: colors.text, textAlign: 'center' },
});
