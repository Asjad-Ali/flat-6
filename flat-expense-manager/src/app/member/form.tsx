import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { confirmAsync, showError, showInfo } from '../../components/dialogs';
import { Banner, ErrorView, LoadingView } from '../../components/feedback';
import { TextField } from '../../components/fields';
import { Screen } from '../../components/layout';
import { formatPKR } from '../../domain/money';
import { getMemberBalance } from '../../db/balances';
import {
  getMember,
  memberHasHistory,
  validateMember,
  type Member,
  type MemberFieldErrors,
} from '../../db/members';
import { LOGIN_EMAIL_DOMAIN } from '../../cloud/config';
import { useStore } from '../../data/context';
import { useAsyncData, useDb, useSubmit } from '../../hooks/data';

export default function MemberFormScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const { data, loading, error, reload } = useAsyncData(async (d) => ({ member: id ? await getMember(d, id) : null }), [id]);

  return (
    <>
      <Stack.Screen options={{ title: id ? 'Edit member' : 'New member' }} />
      {loading ? (
        <LoadingView />
      ) : error || !data || (id && !data.member) ? (
        <ErrorView message={error ?? 'This member no longer exists.'} onRetry={reload} />
      ) : (
        <MemberForm member={data.member} />
      )}
    </>
  );
}

function MemberForm({ member }: { member: Member | null }) {
  const db = useDb();
  const store = useStore();
  const cloud = store.mode === 'cloud';
  const { run, busy } = useSubmit();
  const [name, setName] = useState(member?.name ?? '');
  const [username, setUsername] = useState(member?.username ?? '');
  const [phone, setPhone] = useState(member?.phone ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [notes, setNotes] = useState(member?.notes ?? '');
  const [errors, setErrors] = useState<MemberFieldErrors>({});

  const save = () =>
    run(async () => {
      const input = { name, username, phone, email, notes };
      const fieldErrors = validateMember(input, { requireUsername: cloud });
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length > 0) return;
      try {
        await store.saveMember(member?.id, input);
        router.back();
      } catch (e) {
        showError(e);
      }
    });

  const remove = () =>
    run(async () => {
      if (!member) return;
      const [history, balance] = await Promise.all([memberHasHistory(db, member.id), getMemberBalance(db, member.id)]);
      const owed = balance?.balance ?? 0;
      let message = history || cloud
        ? `${member.name} will be moved to former members${cloud ? ' and can no longer log in' : ''}. All past records are kept.`
        : `${member.name} has no financial history and will be permanently removed.`;
      if (owed < 0) message += `\n\nWarning: they still owe ${formatPKR(-owed)}.`;
      if (owed > 0) message += `\n\nWarning: the group still owes them ${formatPKR(owed)}.`;
      const ok = await confirmAsync({ title: `Remove ${member.name}?`, message, confirmText: history || cloud ? 'Archive' : 'Remove', destructive: true });
      if (!ok) return;
      try {
        const result = await store.removeMember(member.id);
        router.dismissTo('/members');
        if (result === 'archived') showInfo('Member archived', `${member.name} was moved to former members. Their history is preserved.`);
      } catch (e) {
        showError(e, 'Could not remove');
      }
    });

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          {member?.isActive && store.canManageMembers && member.id !== store.me?.memberId ? <Button title="Remove" variant="danger" icon="person-remove-outline" onPress={remove} disabled={busy} style={styles.flex1} /> : null}
          <Button title={member ? 'Save changes' : 'Add member'} icon="checkmark" onPress={save} loading={busy} disabled={!store.canManageMembers} style={styles.flex2} />
        </View>
      }
    >
      <TextField label="Full name" required value={name} onChangeText={setName} placeholder="e.g. Ahmed Raza" autoCapitalize="words" error={errors.name} maxLength={50} autoFocus={!member} />
      {!store.canManageMembers ? (
        <Banner tone="neutral" icon="lock-closed" title="Only the admin can change members" />
      ) : null}
      {cloud ? (
        <TextField
          label="Login username"
          required
          value={username}
          onChangeText={(t) => setUsername(t.toLowerCase().replace(/\s/g, ''))}
          placeholder="e.g. ali"
          autoCapitalize="none"
          autoCorrect={false}
          error={errors.username}
          maxLength={30}
          hint={`In Supabase, create the login ${username || '<username>'}@${LOGIN_EMAIL_DOMAIN} with a password.`}
        />
      ) : null}
      <TextField label="Phone" value={phone} onChangeText={setPhone} placeholder="0300-1234567" keyboardType="phone-pad" error={errors.phone} maxLength={20} />
      <TextField label="Email" value={email} onChangeText={setEmail} placeholder="Optional" keyboardType="email-address" autoCapitalize="none" error={errors.email} />
      <TextField label="Notes" value={notes} onChangeText={setNotes} placeholder="Room number, joining date…" multiline maxLength={200} error={errors.notes} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: 12 },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
});
