/**
 * Shared (cloud) mode settings. Set these in `.env` for development and in `eas.json`
 * for APK builds. When they are missing the app runs in local-only mode.
 */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isCloudConfigured = SUPABASE_URL.startsWith('https://') && SUPABASE_ANON_KEY.length > 20;

/**
 * People log in with a username. Supabase logins are email-based, so each username maps to
 * "<username>@flat6.app" (never emailed; accounts are created with "Auto Confirm User").
 */
export const LOGIN_EMAIL_DOMAIN = 'flat6.app';

export const usernameToEmail = (username: string) => `${username.trim().toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;

export const emailToUsername = (email: string | undefined | null) => (email ?? '').split('@')[0].toLowerCase();
