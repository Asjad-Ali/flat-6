import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, spacing } from '../theme';

export function SegmentedControl<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** "‹ label ›" stepper for moving between days or months. */
export function PeriodStepper({ label, onPrev, onNext, nextDisabled, onPressLabel }: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  onPressLabel?: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable onPress={onPrev} hitSlop={8} style={styles.stepButton} accessibilityLabel="Previous">
        <Ionicons name="chevron-back" size={20} color={colors.primary} />
      </Pressable>
      <Pressable onPress={onPressLabel} disabled={!onPressLabel} style={styles.stepLabelWrap}>
        <Text style={styles.stepLabel}>{label}</Text>
        {onPressLabel ? <Ionicons name="calendar-outline" size={14} color={colors.textMuted} /> : null}
      </Pressable>
      <Pressable onPress={onNext} disabled={nextDisabled} hitSlop={8} style={[styles.stepButton, nextDisabled && styles.disabled]} accessibilityLabel="Next">
        <Ionicons name="chevron-forward" size={20} color={colors.primary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: { flexDirection: 'row', backgroundColor: '#E8EAF2', borderRadius: radius.md, padding: 4 },
  segment: { flex: 1, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segmentSelected: { backgroundColor: colors.surface, elevation: 1 },
  segmentText: { fontSize: font.small, fontWeight: '600', color: colors.textMuted },
  segmentTextSelected: { color: colors.primary, fontWeight: '800' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.xs,
  },
  stepButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.primarySoft },
  stepLabelWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  stepLabel: { fontSize: font.body, fontWeight: '700', color: colors.text },
  disabled: { opacity: 0.35 },
});
