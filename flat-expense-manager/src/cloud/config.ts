/**
 * Shared (Firebase) mode settings. Set these in `.env` for development and in `eas.json`
 * for APK builds. When they are missing the app runs in local-only mode.
 * Values come from Firebase console → Project settings → Your apps → Web app → Config.
 */
export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};

/** Only for automated tests: host of a local Firebase emulator (e.g. "localhost"). */
export const EMULATOR_HOST = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST ?? '';

const filled = (v: string) => v.length > 3 && !v.startsWith('PASTE_');

export const isCloudConfigured = filled(firebaseConfig.apiKey) && filled(firebaseConfig.projectId) && filled(firebaseConfig.appId);

/**
 * People log in with a username. Firebase logins are email-based, so each username maps to
 * "<username>@flat6.app". No email is ever sent to it.
 */
export const LOGIN_EMAIL_DOMAIN = 'flat6.app';

export const usernameToEmail = (username: string) => `${username.trim().toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;

export const emailToUsername = (email: string | undefined | null) => (email ?? '').split('@')[0].toLowerCase();
