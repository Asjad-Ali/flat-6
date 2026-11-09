import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Badge, EmptyState, ErrorView, LoadingView } from '../../components/feedback';
import { Avatar, BalanceText } from '../../components/finance';
import { Card, Fab, Screen } from '../../components/layout';
import { formatPKR } from '../../domain/money';
import { getMemberBalances } from '../../db/balances';
import { listMembers } from '../../db/members';
import { useStore } from '../../data/context';
import { useAsyncData } from '../../hooks/data';
import { colors, font, spacing } from '../../theme';

export default function MembersScreen() {
  const store = useStore();
  const [showFormer, setShowFormer] = useState(false);
  const { data, loading, error, reload, refresh, refreshing } = useAsyncData(async (db) => {
    const [members, balances] = await Promise.all([
      listMembers(db, { includeInactive: true }),
      getMemberBalances(db, { includeInactive: true }),
    ]);
    const byId = new Map(balances.map((b) => [b.memberId, b]));
    return members.map((m) => ({ member: m, balance: byId.get(m.id) }));
  }, []);

  if (loading) return <LoadingView />;
  if (error || !data) return <ErrorView message={error ?? 'No data'} onRetry={reload} />;

  const active = data.filter((d) => d.member.isActive);
  const former = data.filter((d) => !d.member.isActive);
  const visible = showFormer ? data : active;
  const totalDue = active.reduce((acc, d) => acc + Math.max(d.balance?.balance ?? 0, 0), 0);

  return (
    <View style={styles.container}>
      <Screen onRefresh={refresh} refreshing={refreshing}>
        {active.length > 0 ? (
          <Card style={styles.summary}>
            <View>
              <Text style={styles.summaryLabel}>Active members</Text>
              <Text style={styles.summaryValue}>{active.length}</Text>
            </View>
            <View style={styles.summaryRight}>
              <Text style={styles.summaryLabel}>Total outstanding</Text>
              <Text style={[styles.summaryValue, { color: totalDue > 0 ? colors.danger : colors.success }]}>{formatPKR(totalDue)}</Text>
            </View>
          </Card>
        ) : null}

        {former.length > 0 ? (
          <View style={styles.toggle}>
            <Text style={styles.toggleLabel}>Show former members ({former.length})</Text>
            <Switch value={showFormer} onValueChange={setShowFormer} trackColor={{ true: colors.primary }} thumbColor={colors.surface} />
          </View>
        ) : null}

        {visible.length === 0 ? (
          <EmptyState
            icon="people-outline"
            title="No members yet"
            message="Add everyone living in the flat. You'll distribute weekly expenses among them and track their payments."
            actionLabel={store.canManageMembers ? 'Add first member' : undefined}
            onAction={() => router.push('/member/form')}
          />
        ) : (
          <Card style={styles.list}>
            {visible.map(({ member, balance }, i) => (
              <Pressable
                key={member.id}
                onPress={() => router.push(`/member/${member.id}`)}
                android_ripple={{ color: colors.border }}
                style={[styles.row, i > 0 && styles.rowBorder]}
              >
                <Avatar name={member.name} muted={!member.isActive} />
                <View style={styles.rowBody}>
                  <Text style={styles.name} numberOfLines={1}>
                    {member.name}
                  </Text>
                  {member.isActive ? (
                    <Text style={styles.meta} numberOfLines={1}>
                      {[member.isAdmin ? 'Admin' : null, member.username ? `@${member.username}` : null, member.phone ?? member.email]
                        .filter(Boolean)
                        .join(' · ') || 'No contact info'}
                    </Text>
                  ) : (
                    <Badge label="Former member" />
                  )}
                </View>
                <BalanceText balance={balance?.balance ?? 0} />
              </Pressable>
            ))}
          </Card>
        )}
      </Screen>
      {store.canManageMembers ? <Fab icon="person-add" label="Add member" onPress={() => router.push('/member/form')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  summary: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryRight: { alignItems: 'flex-end' },
  summaryLabel: { fontSize: font.caption, color: colors.textMuted, fontWeight: '600' },
  summaryValue: { fontSize: font.title, fontWeight: '800', color: colors.text, marginTop: 2 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xs },
  toggleLabel: { fontSize: font.small, color: colors.textMuted, fontWeight: '600' },
  list: { paddingVertical: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowBody: { flex: 1, gap: 3 },
  name: { fontSize: font.body, fontWeight: '700', color: colors.text },
  meta: { fontSize: font.caption, color: colors.textMuted },
});
