import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Asks for notification permission and returns this phone's push address (an Expo push token).
 * Returns null where push is unavailable: web, Expo Go, permission denied, or a build made
 * without google-services.json. The app works the same without it; only alerts are missing.
 */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const Notifications = await import('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Flat activity',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;
  }
}

/** Calls `onOpen` with the notification's data when the user taps one. Returns an unsubscribe function. */
export async function onNotificationTap(onOpen: (data: Record<string, unknown>) => void): Promise<() => void> {
  if (Platform.OS === 'web') return () => {};
  try {
    const Notifications = await import('expo-notifications');
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      onOpen((response.notification.request.content.data ?? {}) as Record<string, unknown>);
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
