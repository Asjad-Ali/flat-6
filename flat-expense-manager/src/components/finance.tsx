import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CATEGORY_META, type Category } from '../domain/categories';
import { formatDate } from '../domain/dates';
import { formatPKR } from '../domain/money';
import { colors, font, radius, shadow, spacing } from '../theme';

type IconName = keyof typeof Ionicons.glyphMap;

export function StatCard({ label, value, icon, tone = colors.primary, caption }: {
  label: string;
  value: string;
  icon: IconName;
  tone?: string;
  caption?: string;
}) {
  return (
    <View style={styles.stat}>
      <View style={[styles.statIcon, { backgroundColor: `${tone}1A` }]}>
        <Ionicons name={icon} size={18} color={tone} />
      </View>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {caption ? (
        <Text style={styles.statCaption} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

export function CategoryIcon({ category, size = 40 }: { category: Category; size?: number }) {
  const meta = CATEGORY_META[category];
  return (
    <View style={[styles.catIcon, { width: size, height: size, borderRadius: size / 3, backgroundColor: meta.tint }]}>
      <Ionicons name={meta.icon as IconName} size={size * 0.5} color={meta.color} />
    </View>
  );
}

/** One line in an expense or transaction list. */
export function TransactionRow({ kind, title, subtitle, amount, category, date, onPress, muted }: {
  kind: 'expense' | 'settlement';
  title: string;
  subtitle?: string;
  amount: number;
  category?: Category | null;
  date?: string;
  onPress?: () => void;
  muted?: boolean;
}) {
  const isPayment = kind === 'settlement';
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      android_ripple={{ color: colors.border }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {isPayment ? (
        <View style={[styles.catIcon, styles.paymentIcon]}>
          <Ionicons name="swap-horizontal" size={20} color={colors.success} />
        </View>
      ) : (
        <CategoryIcon category={category ?? 'Other'} />
      )}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {date ? (
          <View style={styles.dateLine}>
            <Ionicons name="calendar-outline" size={11} color={colors.textFaint} />
            <Text style={styles.rowDate}>{formatDate(date, 'long')}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.rowAmount, isPayment && { color: colors.success }, muted && { color: colors.textMuted }]}>
        {formatPKR(amount)}
      </Text>
    </Pressable>
  );
}

/** Horizontal bars showing how a total splits across categories. */
export function CategoryBars({ items }: { items: { category: Category; total: number; count: number }[] }) {
  const grand = items.reduce((acc, i) => acc + i.total, 0);
  if (grand === 0) return null;
  return (
    <View style={styles.bars}>
      {items.map((i) => {
        const meta = CATEGORY_META[i.category];
        const pct = (i.total / grand) * 100;
        return (
          <View key={i.category} style={styles.barRow}>
            <View style={styles.barHeader}>
              <View style={styles.barLabel}>
                <Ionicons name={meta.icon as IconName} size={14} color={meta.color} />
                <Text style={styles.barName}>{i.category}</Text>
                <Text style={styles.barCount}>
                  {i.count} {i.count === 1 ? 'entry' : 'entries'}
                </Text>
              </View>
              <Text style={styles.barAmount}>{formatPKR(i.total)}</Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${Math.max(pct, 2)}%`, backgroundColor: meta.color }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function Avatar({ name, size = 42, muted }: { name: string; size?: number; muted?: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  const palette = ['#4F46E5', '#0891B2', '#16A34A', '#D97706', '#DB2777', '#7C3AED', '#EA580C'];
  const color = muted ? colors.textFaint : palette[name.length % palette.length];
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: `${color}22` }]}>
      <Text style={[styles.avatarText, { color, fontSize: size * 0.38 }]}>{initials}</Text>
    </View>
  );
}

/** Balance shown Tricount-style: positive = gets back (green), negative = owes (red). */
export function BalanceText({ balance, size = 'normal' }: { balance: number; size?: 'normal' | 'large' }) {
  const color = balance > 0 ? colors.success : balance < 0 ? colors.danger : colors.textMuted;
  const caption = balance > 0 ? 'Gets back' : balance < 0 ? 'Owes' : 'Settled up';
  return (
    <View style={styles.balance}>
      <Text style={[styles.balanceValue, size === 'large' && styles.balanceLarge, { color }]}>
        {balance > 0 ? '+' : balance < 0 ? '−' : ''}
        {formatPKR(Math.abs(balance))}
      </Text>
      <Text style={[styles.balanceCaption, { color }]}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  stat: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 4,
    ...shadow,
  },
  statIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statLabel: { fontSize: font.caption, color: colors.textMuted, fontWeight: '600' },
  statValue: { fontSize: font.title, color: colors.text, fontWeight: '800' },
  statCaption: { fontSize: font.caption, color: colors.textFaint },
  catIcon: { alignItems: 'center', justifyContent: 'center' },
  paymentIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.successSoft },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  pressed: { opacity: 0.7 },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: font.body, fontWeight: '600', color: colors.text },
  rowSubtitle: { fontSize: font.caption, color: colors.textMuted },
  dateLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowDate: { fontSize: 11, color: colors.textFaint },
  rowAmount: { fontSize: font.body, fontWeight: '700', color: colors.text },
  bars: { gap: spacing.md },
  barRow: { gap: 6 },
  barHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barName: { fontSize: font.small, fontWeight: '600', color: colors.text },
  barCount: { fontSize: font.caption, color: colors.textFaint },
  barAmount: { fontSize: font.small, fontWeight: '700', color: colors.text },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: '#F1F5F9', overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800' },
  balance: { alignItems: 'flex-end' },
  balanceValue: { fontSize: font.body, fontWeight: '800' },
  balanceLarge: { fontSize: font.headline },
  balanceCaption: { fontSize: font.caption, fontWeight: '600' },
});
