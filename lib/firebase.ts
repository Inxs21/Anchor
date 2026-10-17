import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBHk8KYvuiq613qhz0iIVtXPZSJCxSX_gY',
  authDomain: 'anchor-fa680.firebaseapp.com',
  projectId: 'anchor-fa680',
  storageBucket: 'anchor-fa680.firebasestorage.app',
  messagingSenderId: '536794768326',
  appId: '1:536794768326:web:f4530e77604f5b8d9748c7',
  measurementId: 'G-PBYWZZN8RS',
};

// Guard against hot-reload double initialization
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);

// initializeFirestore throws if called a second time, so fall back to getFirestore
let db: ReturnType<typeof getFirestore>;
try {
  db = initializeFirestore(app, { experimentalForceLongPolling: true });
} catch {
  db = getFirestore(app);
}
export { db };
