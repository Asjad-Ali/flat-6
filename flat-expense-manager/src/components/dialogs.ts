import { Alert, Platform } from 'react-native';

import { errorMessage, isAppError } from '../db/client';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  destructive?: boolean;
}

/** Promise-based confirmation dialog. */
export function confirmAsync({ title, message, confirmText = 'Confirm', destructive }: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? false);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function showError(error: unknown, title = 'Could not save') {
  const message = errorMessage(error);
  if (Platform.OS === 'web') globalThis.alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export function showInfo(title: string, message: string) {
  if (Platform.OS === 'web') globalThis.alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

/**
 * Runs a save that may be rejected as a possible duplicate. If so, asks the user and
 * retries with `allowDuplicate = true` only after explicit confirmation.
 * Resolves to the result, or undefined if the user cancelled or an error was shown.
 */
export async function saveWithDuplicateCheck<T>(save: (allowDuplicate: boolean) => Promise<T>): Promise<T | undefined> {
  try {
    return await save(false);
  } catch (e) {
    if (!isAppError(e, 'DUPLICATE')) {
      showError(e);
      return undefined;
    }
    const ok = await confirmAsync({ title: 'Possible duplicate', message: e.message, confirmText: 'Save anyway' });
    if (!ok) return undefined;
    try {
      return await save(true);
    } catch (err) {
      showError(err);
      return undefined;
    }
  }
}
