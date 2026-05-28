// ─────────────────────────────────────────────────────────────────────────────
// auth.js  |  Calyx Chat  –  Authentication Logic
// ─────────────────────────────────────────────────────────────────────────────

import {
  auth,
  provider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
} from './firebase.js';

// ── Redirect if already logged in ────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
  if (user) {
    // ✅ User is signed in.
    // Update this path when you create your main app page, e.g.:
    //   window.location.href = '/app.html';
    // For now, show a success message so you can verify auth is working.
    document.body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100dvh;font-family:Inter,sans-serif;background:#010307;color:#f0f4ff;gap:16px;text-align:center;padding:24px;">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style="margin-bottom:8px">
          <circle cx="12" cy="12" r="10" stroke="#10b981" stroke-width="2"/>
          <path d="M8 12l3 3 5-6" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h2 style="font-size:22px;font-weight:700;margin:0">Signed in successfully!</h2>
        <p style="color:#8b9ab8;margin:0">Welcome, <strong style="color:#fbbf24">${user.displayName || user.email}</strong></p>
        <p style="color:#4e5e7a;font-size:13px;margin:0">Firebase auth is working ✓<br>Connect your app page to complete the setup.</p>
        <button onclick="import('./firebase.js').then(m => m.auth.signOut()).then(() => location.reload())"
          style="margin-top:16px;padding:10px 24px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#f0f4ff;font-size:14px;cursor:pointer;">
          Sign Out
        </button>
      </div>`;
  }
});


// ── DOM refs ──────────────────────────────────────────────────────────────────
const tabSignin = document.getElementById('tab-signin');
const tabRegister = document.getElementById('tab-register');
const panelSignin = document.getElementById('panel-signin');
const panelRegister = document.getElementById('panel-register');
const tabIndicator = document.querySelector('.tab-indicator');

const signinForm = document.getElementById('signin-form');
const signinEmail = document.getElementById('signin-email');
const signinPassword = document.getElementById('signin-password');
const signinError = document.getElementById('signin-error');
const btnSignin = document.getElementById('btn-signin');

const registerForm = document.getElementById('register-form');
const registerName = document.getElementById('register-name');
const registerEmail = document.getElementById('register-email');
const registerPassword = document.getElementById('register-password');
const registerConfirm = document.getElementById('register-confirm');
const registerError = document.getElementById('register-error');
const btnRegister = document.getElementById('btn-register');
const pwStrength = document.getElementById('pw-strength');

const btnGoogleSignin = document.getElementById('btn-google-signin');
const btnGoogleRegister = document.getElementById('btn-google-register');

const btnForgot = document.getElementById('btn-forgot');

const toast = document.getElementById('toast');
const toastMsg = document.getElementById('toast-msg');

// ── Tab Switcher ──────────────────────────────────────────────────────────────
function switchTab(toSignin) {
  if (toSignin) {
    tabSignin.classList.add('active');
    tabRegister.classList.remove('active');
    tabSignin.setAttribute('aria-selected', 'true');
    tabRegister.setAttribute('aria-selected', 'false');
    panelSignin.classList.add('active');
    panelRegister.classList.remove('active');
    panelSignin.hidden = false;
    panelRegister.hidden = true;
    tabIndicator.classList.remove('right');
  } else {
    tabRegister.classList.add('active');
    tabSignin.classList.remove('active');
    tabRegister.setAttribute('aria-selected', 'true');
    tabSignin.setAttribute('aria-selected', 'false');
    panelRegister.classList.add('active');
    panelSignin.classList.remove('active');
    panelRegister.hidden = false;
    panelSignin.hidden = true;
    tabIndicator.classList.add('right');
  }
  clearErrors();
}

tabSignin.addEventListener('click', () => switchTab(true));
tabRegister.addEventListener('click', () => switchTab(false));

// ── Password Toggle ───────────────────────────────────────────────────────────
document.querySelectorAll('.toggle-pw').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
  });
});

// ── Password Strength ─────────────────────────────────────────────────────────
registerPassword.addEventListener('input', () => {
  const val = registerPassword.value;
  if (!val) { pwStrength.textContent = ''; pwStrength.className = 'pw-strength'; return; }
  const hasUpper = /[A-Z]/.test(val);
  const hasNum = /[0-9]/.test(val);
  const hasSpec = /[^A-Za-z0-9]/.test(val);
  const score = (val.length >= 8 ? 1 : 0) + (hasUpper ? 1 : 0) + (hasNum ? 1 : 0) + (hasSpec ? 1 : 0);
  if (score <= 1) { pwStrength.textContent = '● Weak'; pwStrength.className = 'pw-strength weak'; }
  else if (score <= 2) { pwStrength.textContent = '●● Medium'; pwStrength.className = 'pw-strength medium'; }
  else { pwStrength.textContent = '●●● Strong'; pwStrength.className = 'pw-strength strong'; }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function showError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}
function clearErrors() {
  signinError.hidden = true;
  registerError.hidden = true;
  [signinEmail, signinPassword, registerName, registerEmail, registerPassword, registerConfirm]
    .forEach(i => i.classList.remove('error'));
}

function setLoading(btn, loading) {
  const text = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.btn-spinner');
  btn.disabled = loading;
  text.hidden = loading;
  spinner.hidden = !loading;
}

function showToast(msg, duration = 3500) {
  toastMsg.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { toast.hidden = true; }, duration);
}

function friendlyError(code) {
  const map = {
    'auth/user-not-found': 'No account found with that email.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/weak-password': 'Password must be at least 8 characters.',
    'auth/too-many-requests': 'Too many attempts. Please try again later.',
    'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/invalid-credential': 'Incorrect email or password.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

// ── Email Sign In ─────────────────────────────────────────────────────────────
signinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();

  const email = signinEmail.value.trim();
  const password = signinPassword.value;

  if (!email) { signinEmail.classList.add('error'); showError(signinError, 'Please enter your email.'); return; }
  if (!password) { signinPassword.classList.add('error'); showError(signinError, 'Please enter your password.'); return; }

  setLoading(btnSignin, true);
  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged will redirect
  } catch (err) {
    showError(signinError, friendlyError(err.code));
    setLoading(btnSignin, false);
  }
});

// ── Email Register ────────────────────────────────────────────────────────────
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();

  const name = registerName.value.trim();
  const email = registerEmail.value.trim();
  const password = registerPassword.value;
  const confirm = registerConfirm.value;

  if (!name) { registerName.classList.add('error'); showError(registerError, 'Please enter your name.'); return; }
  if (!email) { registerEmail.classList.add('error'); showError(registerError, 'Please enter your email.'); return; }
  if (password.length < 8) { registerPassword.classList.add('error'); showError(registerError, 'Password must be at least 8 characters.'); return; }
  if (password !== confirm) { registerConfirm.classList.add('error'); showError(registerError, "Passwords don't match."); return; }

  setLoading(btnRegister, true);
  try {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(user, { displayName: name });
    // onAuthStateChanged will redirect
  } catch (err) {
    showError(registerError, friendlyError(err.code));
    setLoading(btnRegister, false);
  }
});

// ── Google Auth ───────────────────────────────────────────────────────────────
async function handleGoogle() {
  clearErrors();
  try {
    await signInWithPopup(auth, provider);
    // onAuthStateChanged will redirect
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      showToast(friendlyError(err.code));
    }
  }
}

btnGoogleSignin.addEventListener('click', handleGoogle);
btnGoogleRegister.addEventListener('click', handleGoogle);

// ── Forgot Password ───────────────────────────────────────────────────────────
btnForgot.addEventListener('click', async () => {
  const email = signinEmail.value.trim();
  if (!email) {
    signinEmail.classList.add('error');
    signinEmail.focus();
    showError(signinError, 'Enter your email above, then click "Forgot password?"');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showToast(`Password reset email sent to ${email}`);
  } catch (err) {
    showError(signinError, friendlyError(err.code));
  }
});
