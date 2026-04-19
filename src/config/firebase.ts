// ============================================================
// CellHub Pro — Firebase Configuration
// ============================================================
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import type { FirebaseConfig } from '@/store/types';

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

/**
 * Default Firebase config from environment variables.
 * Can be overridden by Setup Wizard (stored in localStorage).
 */
function getFirebaseConfig(): FirebaseConfig | null {
  // 1. Check localStorage for wizard-configured values
  try {
    const stored = localStorage.getItem('cellhub_firebase_config');
    if (stored) {
      const parsed = JSON.parse(stored) as FirebaseConfig;
      if (parsed.apiKey && parsed.projectId) return parsed;
    }
  } catch {
    // ignore parse errors
  }

  // 2. Fall back to Vite env vars
  const envConfig: FirebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  };

  if (envConfig.apiKey && envConfig.projectId) return envConfig;

  return null;
}

/**
 * Initialize Firebase. Call once at app startup.
 * Returns null if no config is available (triggers Setup Wizard).
 */
export function initFirebase(): Firestore | null {
  if (db) return db;

  const config = getFirebaseConfig();
  if (!config) return null;

  try {
    app = initializeApp(config);

    // initializeFirestore with persistentLocalCache replaces the deprecated
    // getFirestore() + enableIndexedDbPersistence() pattern (Firebase v10+).
    // persistentMultipleTabManager allows offline persistence across multiple tabs.
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
    console.log('✅ Firestore offline persistence enabled (multi-tab)');

    return db;
  } catch (err) {
    console.error('❌ Firebase init failed:', err);
    return null;
  }
}

/**
 * Get the Firestore instance. Throws if not initialized.
 */
export function getDb(): Firestore {
  if (!db) throw new Error('Firestore not initialized. Call initFirebase() first.');
  return db;
}

/**
 * Check if Firebase is configured and initialized.
 */
export function isFirebaseReady(): boolean {
  return db !== null;
}

/**
 * Save Firebase config (from Setup Wizard) to localStorage.
 */
export function saveFirebaseConfig(config: FirebaseConfig): void {
  localStorage.setItem('cellhub_firebase_config', JSON.stringify(config));
}
