import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense, type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthGate } from '../components/AuthGate';
import { LoadingView } from '../components/feedback';
import { isCloudConfigured } from '../cloud/config';
import { CloudStoreProvider } from '../data/CloudStoreProvider';
import { LocalStoreProvider } from '../data/LocalStoreProvider';
import { CLOUD_CACHE_DATABASE_NAME, DATABASE_NAME, initDatabase } from '../db/schema';
import { colors } from '../theme';

export { ErrorBoundary } from 'expo-router';

/**
 * Shared mode (Supabase settings present): login required, data synced between phones.
 * Local mode (no settings): everything stays on this phone.
 */
function DataProvider({ children }: { children: ReactNode }) {
  if (isCloudConfigured) {
    return <CloudStoreProvider renderGate={(auth) => <AuthGate auth={auth} />}>{children}</CloudStoreProvider>;
  }
  return <LocalStoreProvider>{children}</LocalStoreProvider>;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Suspense fallback={<LoadingView label="Opening your ledger…" />}>
        <SQLiteProvider
          databaseName={isCloudConfigured ? CLOUD_CACHE_DATABASE_NAME : DATABASE_NAME}
          onInit={initDatabase}
          useSuspense
        >
          <DataProvider>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.surface },
                headerTintColor: colors.text,
                headerTitleStyle: { fontWeight: '700' },
                headerShadowVisible: false,
                contentStyle: { backgroundColor: colors.background },
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="expense/form" options={{ title: 'Expense', presentation: 'modal' }} />
              <Stack.Screen name="member/form" options={{ title: 'Member', presentation: 'modal' }} />
              <Stack.Screen name="member/[id]" options={{ title: 'Member' }} />
              <Stack.Screen name="settlement/form" options={{ title: 'Record a payment', presentation: 'modal' }} />
            </Stack>
          </DataProvider>
        </SQLiteProvider>
      </Suspense>
    </SafeAreaProvider>
  );
}
