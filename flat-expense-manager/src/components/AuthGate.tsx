import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CloudAuth } from '../data/CloudStoreProvider';
import { errorMessage } from '../db/client';
import { colors, font, radius, spacing } from '../theme';
import { Button } from './Button';
import { LoadingView } from './feedback';
import { TextField } from './fields';

/** What a shared-mode user sees before the app opens: loading, login, first-time setup, or "not a member". */
export function AuthGate({ auth }: { auth: CloudAuth }) {
  if (auth.state.status === 'loading') return <LoadingView label="Loading your flat…" />;
  if (auth.state.status === 'notMember') return <NotMember auth={auth} message={auth.state.message} />;
  // Nobody has set this flat up yet: the first person creates the admin account.
  return auth.flatExists === false ? <SetupScreen auth={auth} /> : <LoginScreen auth={auth} />;
}

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.logo}>
            <Ionicons name="home" size={34} color={colors.textOnPrimary} />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          <View style={styles.form}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.error}>
      <Ionicons name="alert-circle" size={18} color={colors.danger} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

/** Runs a login/setup action with a busy flag and a visible error message. */
function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

function LoginScreen({ auth }: { auth: CloudAuth }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, run } = useAction();
  const submit = () => run(() => auth.signIn(username, password));

  return (
    <Shell title="Flat Expense Manager" subtitle="Log in with the username and password the admin gave you.">
      <TextField label="Username" value={username} onChangeText={setUsername} placeholder="e.g. ali" autoCapitalize="none" autoCorrect={false} autoComplete="username" returnKeyType="next" />
      <TextField label="Password" value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry autoCapitalize="none" autoComplete="password" returnKeyType="go" onSubmitEditing={submit} />
      <ErrorBox message={error} />
      <Button title="Log in" icon="log-in-outline" onPress={submit} loading={busy} />
      <Text style={styles.hint}>Forgot your password? Ask the admin to give you a new one.</Text>
    </Shell>
  );
}

function SetupScreen({ auth }: { auth: CloudAuth }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const { error, busy, run } = useAction();
  const submit = () => run(() => auth.setUp(name, username, password));

  return (
    <Shell title="Set up your flat" subtitle="You are the first one here. Create the admin account. Then you can add your flatmates and give each of them a username and password.">
      <TextField label="Your name" value={name} onChangeText={setName} placeholder="e.g. Asjad Ali" autoCapitalize="words" />
      <TextField label="Admin username" value={username} onChangeText={(t) => setUsername(t.toLowerCase().replace(/\s/g, ''))} placeholder="admin" autoCapitalize="none" autoCorrect={false} />
      <TextField label="Password" value={password} onChangeText={setPassword} placeholder="At least 6 characters" secureTextEntry autoCapitalize="none" returnKeyType="go" onSubmitEditing={submit} hint="Remember it: you need it to log in on every phone." />
      <ErrorBox message={error} />
      <Button title="Create flat" icon="checkmark" onPress={submit} loading={busy} />
    </Shell>
  );
}

function NotMember({ auth, message }: { auth: CloudAuth; message: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.content, styles.center]}>
        <Ionicons name="person-remove-outline" size={44} color={colors.warning} />
        <Text style={styles.title}>{'Can’t open the flat'}</Text>
        <Text style={styles.subtitle}>{message}</Text>
        <View style={styles.form}>
          <Button
            title="Try again"
            icon="refresh"
            variant="secondary"
            loading={busy}
            onPress={async () => {
              setBusy(true);
              await auth.retry();
              setBusy(false);
            }}
          />
          <Button title="Log out" icon="log-out-outline" variant="danger" onPress={() => void auth.signOut()} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  center: { alignItems: 'center' },
  logo: { width: 72, height: 72, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  title: { fontSize: font.headline, fontWeight: '800', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: font.body, color: colors.textMuted, textAlign: 'center', lineHeight: 21 },
  form: { gap: spacing.md, marginTop: spacing.md, alignSelf: 'stretch' },
  error: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.dangerSoft, padding: spacing.md, borderRadius: radius.md },
  errorText: { flex: 1, color: colors.danger, fontSize: font.small, fontWeight: '600' },
  hint: { fontSize: font.small, color: colors.textFaint, textAlign: 'center' },
});
