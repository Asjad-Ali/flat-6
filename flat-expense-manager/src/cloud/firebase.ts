// Gives native builds a persistent `localStorage` (backed by SQLite) so the login survives restarts.
import 'expo-sqlite/localStorage/install';

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, getReactNativePersistence, initializeAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { Platform } from 'react-native';

import { EMULATOR_HOST, firebaseConfig } from './config';

export interface Firebase {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let instance: Firebase | null = null;

/** Keeps the signed-in user on the phone between app starts. */
const loginStorage = {
  getItem: async (key: string) => localStorage.getItem(key),
  setItem: async (key: string, value: string) => localStorage.setItem(key, value),
  removeItem: async (key: string) => localStorage.removeItem(key),
};

export function getFirebase(): Firebase {
  if (instance) return instance;
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const auth =
    Platform.OS === 'web' ? getAuth(app) : initializeAuth(app, { persistence: getReactNativePersistence(loginStorage) });
  const db = getFirestore(app);
  if (EMULATOR_HOST) {
    connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, EMULATOR_HOST, 8080);
  }
  instance = { app, auth, db };
  return instance;
}
