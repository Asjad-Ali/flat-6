import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, spacing } from '../theme';
import { Button } from './Button';

type IconName = keyof typeof Ionicons.glyphMap;

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Ionicons name="alert-circle-outline" size={44} color={colors.danger} />
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? <Button title="Try again" onPress={onRetry} variant="secondary" compact /> : null}
    </View>
  );
}

interface EmptyStateProps {
  icon: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

export function EmptyState({ icon, title, message, actionLabel, onAction, compact }: EmptyStateProps) {
  return (
    <View style={[styles.empty, compact && styles.emptyCompact]}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={compact ? 24 : 32} color={colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} compact style={styles.emptyAction} />
      ) : null}
    </View>
  );
}

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary';

const tones: Record<Tone, { fg: string; bg: string }> = {
  success: { fg: colors.success, bg: colors.successSoft },
  warning: { fg: colors.warning, bg: colors.warningSoft },
  danger: { fg: colors.danger, bg: colors.dangerSoft },
  info: { fg: colors.info, bg: colors.infoSoft },
  neutral: { fg: colors.textMuted, bg: '#F1F5F9' },
  primary: { fg: colors.primary, bg: colors.primarySoft },
};

export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const t = tones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={t.fg} /> : null}
      <Text style={[styles.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

/** Inline notice for warnings and hints inside screens. */
export function Banner({ tone = 'info', icon, title, message, action }: {
  tone?: Tone;
  icon?: IconName;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
}) {
  const t = tones[tone];
  return (
    <View style={[styles.banner, { backgroundColor: t.bg }]}>
      <Ionicons name={icon ?? 'information-circle'} size={20} color={t.fg} />
      <View style={styles.bannerBody}>
        <Text style={[styles.bannerTitle, { color: t.fg }]}>{title}</Text>
        {message ? <Text style={styles.bannerMessage}>{message}</Text> : null}
        {action ? (
          <Text style={[styles.bannerAction, { color: t.fg }]} onPress={action.onPress} suppressHighlighting>
            {action.label} →
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl, backgroundColor: colors.background },
  muted: { color: colors.textMuted, fontSize: font.small },
  title: { fontSize: font.subtitle, fontWeight: '700', color: colors.text, textAlign: 'center' },
  message: { fontSize: font.small, color: colors.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 300 },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg, gap: spacing.sm },
  emptyCompact: { paddingVertical: spacing.lg },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyAction: { marginTop: spacing.sm },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: font.caption, fontWeight: '700' },
  banner: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'flex-start' },
  bannerBody: { flex: 1, gap: 2 },
  bannerTitle: { fontSize: font.small, fontWeight: '700' },
  bannerMessage: { fontSize: font.small, color: colors.text, lineHeight: 18 },
  bannerAction: { fontSize: font.small, fontWeight: '700', marginTop: 4 },
});
