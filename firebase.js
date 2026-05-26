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
  apiKey:            "AIzaSyAkQ-Pu5Xz1l-QwIICv8J2HsptSjYhE2d8",
  authDomain:        "calyx-meet.firebaseapp.com",
  projectId:         "calyx-meet",
  storageBucket:     "calyx-meet.firebasestorage.app",
  messagingSenderId: "554595048851",
  appId:             "1:554595048851:web:1f75faaf50e456a5e99c66",
  measurementId:     "G-VGZWN7XZBQ",
};
// ───────────────────────────────────────────────────────────────────────────

const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
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
