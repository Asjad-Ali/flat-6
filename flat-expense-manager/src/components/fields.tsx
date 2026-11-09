import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { formatDate, isValidISODate, parseISODate, toISODate } from '../domain/dates';
import { colors, font, radius, spacing } from '../theme';

interface FieldShellProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}

function FieldShell({ label, error, hint, required, children }: FieldShellProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      {children}
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
}

export function TextField({ label, error, hint, required, multiline, editable = true, ...props }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <FieldShell label={label} error={error} hint={hint} required={required}>
      <TextInput
        {...props}
        editable={editable}
        multiline={multiline}
        placeholderTextColor={colors.textFaint}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[
          styles.input,
          multiline && styles.multiline,
          focused && styles.inputFocused,
          !!error && styles.inputError,
          !editable && styles.inputDisabled,
        ]}
      />
    </FieldShell>
  );
}

interface MoneyFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  editable?: boolean;
  autoFocus?: boolean;
}

/** Amount input in rupees with an "Rs." prefix and numeric keyboard. Parse with `parseAmount`. */
export function MoneyField({ label, value, onChangeText, error, hint, required, editable = true, autoFocus }: MoneyFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <FieldShell label={label} error={error} hint={hint} required={required}>
      <View
        style={[
          styles.input,
          styles.moneyRow,
          focused && styles.inputFocused,
          !!error && styles.inputError,
          !editable && styles.inputDisabled,
        ]}
      >
        <Text style={styles.prefix}>Rs.</Text>
        <TextInput
          value={value}
          onChangeText={(t) => onChangeText(t.replace(/[^\d.,]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.textFaint}
          editable={editable}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={styles.moneyInput}
          accessibilityLabel={label}
        />
      </View>
    </FieldShell>
  );
}

interface DateFieldProps {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  error?: string;
  hint?: string;
  minimumDate?: string;
  maximumDate?: string;
  editable?: boolean;
}

/** Native date picker on Android/iOS; plain YYYY-MM-DD text input on web. */
export function DateField({ label, value, onChange, error, hint, minimumDate, maximumDate, editable = true }: DateFieldProps) {
  const [showIOS, setShowIOS] = useState(false);
  const [webText, setWebText] = useState(value);

  if (Platform.OS === 'web') {
    return (
      <TextField
        label={label}
        value={webText}
        error={error}
        hint={hint ?? 'Format: YYYY-MM-DD'}
        editable={editable}
        onChangeText={(t) => {
          setWebText(t);
          if (isValidISODate(t)) onChange(t);
        }}
      />
    );
  }

  const open = () => {
    if (!editable) return;
    const options = {
      value: parseISODate(value),
      mode: 'date' as const,
      minimumDate: minimumDate ? parseISODate(minimumDate) : undefined,
      maximumDate: maximumDate ? parseISODate(maximumDate) : undefined,
    };
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ ...options, onValueChange: (_e, date) => onChange(toISODate(date)) });
    } else {
      setShowIOS((s) => !s);
    }
  };

  return (
    <FieldShell label={label} error={error} hint={hint}>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${formatDate(value, 'long')}`}
        style={[styles.input, styles.dateRow, !!error && styles.inputError, !editable && styles.inputDisabled]}
      >
        <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
        <Text style={styles.dateText}>{formatDate(value, 'long')}</Text>
        {editable ? <Ionicons name="chevron-down" size={16} color={colors.textFaint} /> : null}
      </Pressable>
      {showIOS ? (
        <DateTimePicker
          value={parseISODate(value)}
          mode="date"
          display="inline"
          minimumDate={minimumDate ? parseISODate(minimumDate) : undefined}
          maximumDate={maximumDate ? parseISODate(maximumDate) : undefined}
          onValueChange={(_e, date) => {
            onChange(toISODate(date));
            setShowIOS(false);
          }}
        />
      ) : null}
    </FieldShell>
  );
}

export interface ChipOption<T extends string | number> {
  value: T;
  label: string;
  icon?: string;
  color?: string;
  tint?: string;
}

interface ChipSelectProps<T extends string | number> {
  label?: string;
  options: ChipOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string;
  /** Horizontal scrolling row instead of wrapping grid. */
  scroll?: boolean;
  disabled?: boolean;
}

export function ChipSelect<T extends string | number>({ label, options, value, onChange, error, scroll, disabled }: ChipSelectProps<T>) {
  const chips = options.map((o) => {
    const selected = o.value === value;
    const accent = o.color ?? colors.primary;
    return (
      <Pressable
        key={String(o.value)}
        onPress={() => !disabled && onChange(o.value)}
        accessibilityRole="radio"
        accessibilityState={{ selected, disabled }}
        style={[
          styles.chip,
          selected && { backgroundColor: o.tint ?? colors.primarySoft, borderColor: accent },
          disabled && styles.inputDisabled,
        ]}
      >
        {o.icon ? (
          <Ionicons
            name={o.icon as keyof typeof Ionicons.glyphMap}
            size={16}
            color={selected ? accent : colors.textMuted}
          />
        ) : null}
        <Text style={[styles.chipText, selected && { color: accent, fontWeight: '700' }]}>{o.label}</Text>
      </Pressable>
    );
  });

  const body = scroll ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
      {chips}
    </ScrollView>
  ) : (
    <View style={styles.chipWrap}>{chips}</View>
  );

  if (!label) return body;
  return (
    <FieldShell label={label} error={error}>
      {body}
    </FieldShell>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: font.small, fontWeight: '600', color: colors.text },
  required: { color: colors.danger },
  hint: { fontSize: font.caption, color: colors.textMuted },
  error: { fontSize: font.caption, color: colors.danger, fontWeight: '500' },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: font.body,
    color: colors.text,
  },
  multiline: { minHeight: 90, paddingTop: spacing.md, textAlignVertical: 'top' },
  inputFocused: { borderColor: colors.primary, borderWidth: 1.5 },
  inputError: { borderColor: colors.danger },
  inputDisabled: { backgroundColor: colors.surfaceMuted, opacity: 0.7 },
  moneyRow: { flexDirection: 'row', alignItems: 'center' },
  prefix: { fontSize: font.body, fontWeight: '700', color: colors.textMuted, marginRight: spacing.sm },
  moneyInput: { flex: 1, minWidth: 0, fontSize: font.subtitle, fontWeight: '600', color: colors.text, paddingVertical: spacing.sm },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dateText: { flex: 1, fontSize: font.body, color: colors.text },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chipScroll: { gap: spacing.sm, paddingVertical: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipText: { fontSize: font.small, color: colors.textMuted, fontWeight: '500' },
});
