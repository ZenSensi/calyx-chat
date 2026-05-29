// ─────────────────────────────────────────────────────────────────────────────
// firebase-admin.js  –  Calyx Chat Admin Dashboard Firebase Configuration
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword as fbSignInWithEmailAndPassword,
  signInWithPopup as fbSignInWithPopup,
  GoogleAuthProvider,
  signOut as fbSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// ── 1. Main Project Config (Where regular chats & support chats are stored) ──
const mainFirebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAkQ-Pu5Xz1l-QwIICv8J2HsptSjYhE2d8",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "calyx-meet.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "calyx-meet",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "calyx-meet.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "554595048851",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:554595048851:web:1f75faaf50e456a5e99c66",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-VGZWN7XZBQ",
};

// ── 2. Admin Project Config (Separate project console for secure admin logins) 
// 🔴 REPLACE this config block later with your separate Admin Firebase Console settings.
// By default, it is initialized to the same project so it works out-of-the-box.
const adminFirebaseConfig = {
  apiKey: import.meta.env.VITE_ADMIN_FIREBASE_API_KEY || "AIzaSyAkQ-Pu5Xz1l-QwIICv8J2HsptSjYhE2d8",
  authDomain: import.meta.env.VITE_ADMIN_FIREBASE_AUTH_DOMAIN || "calyx-meet.firebaseapp.com",
  projectId: import.meta.env.VITE_ADMIN_FIREBASE_PROJECT_ID || "calyx-meet",
  storageBucket: import.meta.env.VITE_ADMIN_FIREBASE_STORAGE_BUCKET || "calyx-meet.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_ADMIN_FIREBASE_MESSAGING_SENDER_ID || "554595048851",
  appId: import.meta.env.VITE_ADMIN_FIREBASE_APP_ID || "1:554595048851:web:1f75faaf50e456a5e99c66",
  measurementId: import.meta.env.VITE_ADMIN_FIREBASE_MEASUREMENT_ID || "G-VGZWN7XZBQ",
};

// Initialize apps conditionally
let db;
let auth;
let mainAuth = null;

if (mainFirebaseConfig.projectId === adminFirebaseConfig.projectId) {
  // Same project: use a single app instance so Auth state is shared with Firestore
  const app = initializeApp(mainFirebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
} else {
  // Separate projects: initialize mainApp for database and adminApp for secure auth
  const mainApp = initializeApp(mainFirebaseConfig, 'mainApp');
  db = getFirestore(mainApp);
  mainAuth = getAuth(mainApp);

  const adminApp = initializeApp(adminFirebaseConfig, 'adminApp');
  auth = getAuth(adminApp);
}

const provider = new GoogleAuthProvider();

// Custom wrapped auth functions to sign in to both projects if they are separate
async function signInWithEmailAndPassword(authInstance, email, password) {
  const userCredential = await fbSignInWithEmailAndPassword(authInstance, email, password);
  if (mainAuth && mainAuth !== authInstance) {
    try {
      await fbSignInWithEmailAndPassword(mainAuth, email, password);
    } catch (err) {
      console.warn("Could not authenticate operator on the main project's Auth:", err);
    }
  }
  return userCredential;
}

async function signInWithPopup(authInstance, providerInstance) {
  const userCredential = await fbSignInWithPopup(authInstance, providerInstance);
  if (mainAuth && mainAuth !== authInstance) {
    try {
      await fbSignInWithPopup(mainAuth, providerInstance);
    } catch (err) {
      console.warn("Could not authenticate operator on the main project's Auth with Google:", err);
    }
  }
  return userCredential;
}

async function signOut(authInstance) {
  await fbSignOut(authInstance);
  if (mainAuth && mainAuth !== authInstance) {
    try {
      await fbSignOut(mainAuth);
    } catch (err) {}
  }
}

export {
  auth,
  db,
  provider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
};
