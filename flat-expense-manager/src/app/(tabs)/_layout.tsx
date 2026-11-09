import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';

import { PdfHeaderButton } from '../../components/PdfButton';
import { colors } from '../../theme';

type IconName = keyof typeof Ionicons.glyphMap;

const tab = (title: string, icon: IconName, activeIcon: IconName) => ({
  title,
  tabBarIcon: ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) => (
    <Ionicons name={focused ? activeIcon : icon} size={size} color={typeof color === 'string' ? color : undefined} />
  ),
});

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 64, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginBottom: 6 },
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { fontWeight: '800', fontSize: 20, color: colors.text },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ ...tab('Home', 'grid-outline', 'grid'), headerShown: false }} />
      <Tabs.Screen name="expenses" options={{ ...tab('Expenses', 'receipt-outline', 'receipt'), headerRight: () => <PdfHeaderButton /> }} />
      <Tabs.Screen name="balances" options={{ ...tab('Balances', 'swap-horizontal-outline', 'swap-horizontal'), title: 'Balances & settle up', tabBarLabel: 'Balances' }} />
      <Tabs.Screen name="members" options={tab('Members', 'people-outline', 'people')} />
      <Tabs.Screen name="reports" options={{ ...tab('Reports', 'bar-chart-outline', 'bar-chart'), headerRight: () => <PdfHeaderButton /> }} />
    </Tabs>
  );
}
