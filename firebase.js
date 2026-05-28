// ─────────────────────────────────────────────────────────────────────────────
// firebase.js  –  Calyx Chat  ×  Calyx Meet shared Firebase project
//
// 🔴 IMPORTANT: Replace the placeholder values below with your actual
//    Calyx Meet Firebase config from:
//    Firebase Console → Project Settings → Your Apps → SDK setup
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
} from 'firebase/auth';

// ── Calyx Meet Firebase project (shared across all Calyx products) ──────────
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAkQ-Pu5Xz1l-QwIICv8J2HsptSjYhE2d8",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "calyx-meet.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "calyx-meet",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "calyx-meet.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "554595048851",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:554595048851:web:1f75faaf50e456a5e99c66",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-VGZWN7XZBQ",
};
// ───────────────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export {
  auth,
  provider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
};
