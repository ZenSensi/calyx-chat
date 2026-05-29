// ─────────────────────────────────────────────────────────────────────────────
// admin.js  |  Calyx Chat Admin Portal  –  Real-time Support Dashboard Logic
// ─────────────────────────────────────────────────────────────────────────────

import {
  auth,
  db,
  provider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from './firebase-admin.js';

import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  setDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';

// Robust Timestamp and Date helper functions
function formatTimestamp(timestamp) {
  if (!timestamp) return 'Now';
  if (typeof timestamp.toDate === 'function') {
    try {
      const date = timestamp.toDate();
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      console.error("Error calling toDate on timestamp:", e);
    }
  }
  if (typeof timestamp === 'object' && timestamp !== null && 'seconds' in timestamp) {
    try {
      const date = new Date(timestamp.seconds * 1000);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      console.error("Error parsing seconds timestamp:", e);
    }
  }
  if (timestamp instanceof Date) {
    return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (typeof timestamp === 'string' || typeof timestamp === 'number') {
    try {
      const date = new Date(timestamp);
      if (!isNaN(date.getTime())) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    } catch (e) {
      console.error("Error parsing string/number timestamp:", e);
    }
  }
  return 'Now';
}

function getTimestampMs(timestamp) {
  if (!timestamp) return 0;
  if (typeof timestamp.toDate === 'function') {
    try {
      return timestamp.toDate().getTime();
    } catch (e) { }
  }
  if (typeof timestamp === 'object' && 'seconds' in timestamp) {
    return timestamp.seconds * 1000;
  }
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }
  if (typeof timestamp === 'string' || typeof timestamp === 'number') {
    const date = new Date(timestamp);
    return isNaN(date.getTime()) ? 0 : date.getTime();
  }
  return 0;
}

// ── Application State ────────────────────────────────────────────────────────
const state = {
  tickets: {},
  activeTicketId: null,
  filterStatus: 'all', // all, open, resolved
  searchQuery: '',
};

// Listener references
let ticketsListener = null;
let messagesListener = null;

// DOM Elements
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app');
const gridBg = document.getElementById('app-grid-bg');
const glowBg = document.getElementById('app-glow-bg');
const adminDisplayName = document.getElementById('admin-display-name');
const avatarInitials = document.getElementById('avatar-initials');
const userProfileBtn = document.getElementById('user-profile-btn');

// Sign In Form DOM
const signinForm = document.getElementById('signin-form');
const signinEmail = document.getElementById('signin-email');
const signinPassword = document.getElementById('signin-password');
const signinError = document.getElementById('signin-error');
const btnForgot = document.getElementById('btn-forgot');
const btnGoogleSignin = document.getElementById('btn-google-signin');

// Dashboard DOM
const ticketListContainer = document.getElementById('ticket-list-container');
const chatEmptyState = document.getElementById('chat-empty-state');
const chatActiveContainer = document.getElementById('chat-active-container');
const activeChatAvatar = document.getElementById('active-chat-avatar');
const activeChatTitle = document.getElementById('active-chat-title');
const activeChatUserEmail = document.getElementById('active-chat-user-email');
const activeTicketStatus = document.getElementById('active-ticket-status');
const chatMessages = document.getElementById('chat-messages');
const messagesListWrapper = document.getElementById('messages-list-wrapper');

const messageTextarea = document.getElementById('message-textarea');
const btnSendMessage = document.getElementById('btn-send-message');

// Utility Sidebar DOM
const utilityEmptyState = document.getElementById('utility-empty-state');
const utilityActiveState = document.getElementById('utility-active-state');
const btnToggleTicketStatus = document.getElementById('btn-toggle-ticket-status');
const btnToggleTicketText = document.getElementById('btn-toggle-ticket-text');
const metaUserName = document.getElementById('meta-user-name');
const metaUserEmail = document.getElementById('meta-user-email');
const metaUserUid = document.getElementById('meta-user-uid');
const metaTicketUid = document.getElementById('meta-ticket-uid');
const operatorNotes = document.getElementById('operator-notes');

// ── Auth Handling ────────────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
  if (user) {
    // Verified Admin User logged in
    if (authContainer) authContainer.style.display = 'none';
    if (gridBg) gridBg.style.display = 'block';
    if (glowBg) glowBg.style.display = 'block';
    if (appContainer) appContainer.style.display = 'flex';

    // Show name & avatar initials
    const name = user.displayName || user.email.split('@')[0];
    adminDisplayName.textContent = name;
    avatarInitials.textContent = name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

    // Load support tickets queue
    setupTicketsQueueListener();
  } else {
    // Logged out
    if (authContainer) authContainer.style.display = 'flex';
    if (gridBg) gridBg.style.display = 'none';
    if (glowBg) glowBg.style.display = 'none';
    if (appContainer) appContainer.style.display = 'none';

    // Clear subscription
    if (ticketsListener) {
      ticketsListener();
      ticketsListener = null;
    }
    if (messagesListener) {
      messagesListener();
      messagesListener = null;
    }
  }
});

// Email/Password Submit
if (signinForm) {
  signinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = signinEmail.value.trim();
    const password = signinPassword.value;

    signinError.hidden = true;
    if (!email || !password) return;

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      console.error(err);
      signinError.textContent = getFriendlyErrorMessage(err);
      signinError.hidden = false;
    }
  });
}

// Google Sign In
if (btnGoogleSignin) {
  btnGoogleSignin.addEventListener('click', async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
      showToast(getFriendlyErrorMessage(err));
    }
  });
}

// Forgot Password
if (btnForgot) {
  btnForgot.addEventListener('click', async () => {
    const email = signinEmail.value.trim();
    if (!email) {
      signinError.textContent = "Please enter your operator email address first.";
      signinError.hidden = false;
      signinEmail.focus();
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      showToast(`Password reset link sent to: ${email}`);
    } catch (err) {
      signinError.textContent = getFriendlyErrorMessage(err);
      signinError.hidden = false;
    }
  });
}

// Sign Out click handler
if (userProfileBtn) {
  userProfileBtn.addEventListener('click', () => {
    if (confirm("Are you sure you want to sign out of the console?")) {
      signOut(auth).then(() => location.reload());
    }
  });
}

// ── Support Tickets Database Listener ────────────────────────────────────────
function setupTicketsQueueListener() {
  const ticketsQuery = query(
    collection(db, 'chat_conversations'),
    where('type', '==', 'support')
  );

  ticketsListener = onSnapshot(ticketsQuery, (snapshot) => {
    const updatedTickets = {};
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      updatedTickets[docSnap.id] = {
        id: docSnap.id,
        ...data,
      };
    });

    state.tickets = updatedTickets;
    renderTicketsList();

    // If active ticket is deleted or updated
    if (state.activeTicketId && !state.tickets[state.activeTicketId]) {
      closeActiveTicket();
    } else if (state.activeTicketId) {
      updateTicketUI(state.activeTicketId);
    }
  }, (error) => {
    console.error("Tickets snapshot error:", error);
    showToast("Error syncing tickets queue.");
  });
}

// ── Render Tickets List Sidebar ──────────────────────────────────────────────
function renderTicketsList() {
  ticketListContainer.innerHTML = '';
  const searchVal = state.searchQuery.toLowerCase();

  const filtered = Object.values(state.tickets).filter(ticket => {
    // 1. Status Filter
    if (state.filterStatus === 'open' && ticket.status !== 'open') return false;
    if (state.filterStatus === 'resolved' && ticket.status !== 'resolved') return false;

    // Resolve user details
    const participants = ticket.participants || [];
    const clientUid = participants.find(p => p !== 'support-admin') || '';
    const client = ticket.participantDetails?.[clientUid] || {};
    const name = client.displayName || 'Anonymous User';
    const email = client.email || 'No email';

    // 2. Search Query Filter
    if (searchVal) {
      const nameMatch = name.toLowerCase().includes(searchVal);
      const emailMatch = email.toLowerCase().includes(searchVal);
      const lastMsgMatch = (ticket.lastMessage || '').toLowerCase().includes(searchVal);
      return nameMatch || emailMatch || lastMsgMatch;
    }

    return true;
  });

  if (filtered.length === 0) {
    ticketListContainer.innerHTML = `
      <div class="empty-list-placeholder">
        <i data-lucide="inbox"></i>
        <p>No tickets found</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  // Sort by last active timestamp descending
  filtered.sort((a, b) => {
    return getTimestampMs(b.lastMessageTime) - getTimestampMs(a.lastMessageTime);
  });

  filtered.forEach(ticket => {
    const li = document.createElement('li');
    li.className = `ticket-item ${state.activeTicketId === ticket.id ? 'active' : ''}`;

    const clientUid = (ticket.participants || []).find(p => p !== 'support-admin') || '';
    const client = ticket.participantDetails?.[clientUid] || {};
    const name = client.displayName || 'Support Client';
    const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
    const avatarColor = client.avatarColor || 'teal';
    const isTicketOpen = ticket.status === 'open';

    let lastMsgSnippet = ticket.lastMessage || 'Open support channel';
    if (lastMsgSnippet.length > 36) lastMsgSnippet = lastMsgSnippet.substring(0, 34) + '...';

    const email = client.email || 'No email';

    li.innerHTML = `
      <div class="ticket-avatar ${avatarColor}">${initials}</div>
      <div class="ticket-details">
        <div class="ticket-row-top">
          <span class="ticket-username">${name}</span>
          <span class="ticket-pill ${isTicketOpen ? 'open' : 'resolved'}">${isTicketOpen ? 'Open' : 'Resolved'}</span>
        </div>
        <div class="ticket-email" style="font-size: 11px; color: var(--primary-teal); margin: 2px 0;">${email}</div>
        <div class="ticket-row-bottom">
          <span class="ticket-preview">${lastMsgSnippet}</span>
        </div>
      </div>
    `;

    li.addEventListener('click', () => selectTicket(ticket.id));
    ticketListContainer.appendChild(li);
  });

  lucide.createIcons();
}

// ── Select and Load Support Ticket ───────────────────────────────────────────
function selectTicket(ticketId) {
  state.activeTicketId = ticketId;

  // Unsubscribe previous messages listener
  if (messagesListener) {
    messagesListener();
    messagesListener = null;
  }

  // Render Sidebar selection state
  document.querySelectorAll('.ticket-item').forEach(item => {
    item.classList.toggle('active', item.dataset.chatId === ticketId);
  });
  renderTicketsList();

  // Show Workspace Pane
  chatEmptyState.style.display = 'none';
  chatActiveContainer.style.display = 'flex';
  utilityEmptyState.style.display = 'none';
  utilityActiveState.style.display = 'block';

  // Load ticket details and setup messages listener
  updateTicketUI(ticketId);
  setupMessagesListener(ticketId);

  // Focus message text box
  messageTextarea.focus();
}

// ── Unload Ticket Workspace ──────────────────────────────────────────────────
function closeActiveTicket() {
  state.activeTicketId = null;
  chatEmptyState.style.display = 'flex';
  chatActiveContainer.style.display = 'none';
  utilityEmptyState.style.display = 'flex';
  utilityActiveState.style.display = 'none';

  if (messagesListener) {
    messagesListener();
    messagesListener = null;
  }
  renderTicketsList();
}

// ── Update active ticket interface metadata ──────────────────────────────────
function updateTicketUI(ticketId) {
  const ticket = state.tickets[ticketId];
  if (!ticket) return;

  const clientUid = (ticket.participants || []).find(p => p !== 'support-admin') || '';
  const client = ticket.participantDetails?.[clientUid] || {};
  const name = client.displayName || 'Support Client';
  const email = client.email || 'No email';
  const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  const avatarColor = client.avatarColor || 'teal';
  const isTicketOpen = ticket.status === 'open';

  // Active chat header
  activeChatTitle.textContent = name;
  activeChatUserEmail.textContent = email;
  activeChatAvatar.innerHTML = `<div class="message-avatar ${avatarColor}" style="width:36px; height:36px; font-size:13px; font-weight:700; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#0f172a;">${initials}</div>`;

  activeTicketStatus.textContent = isTicketOpen ? 'Open' : 'Resolved';
  activeTicketStatus.className = `ticket-status-badge ${isTicketOpen ? 'open' : 'resolved'}`;

  // Control side-panel inputs
  metaUserName.textContent = name;
  metaUserEmail.textContent = email;
  metaUserUid.textContent = clientUid;
  metaTicketUid.textContent = ticketId;

  // Toggle button state
  btnToggleTicketText.textContent = isTicketOpen ? 'Mark as Resolved' : 'Reopen Ticket';
  btnToggleTicketStatus.className = `btn-control ${isTicketOpen ? 'btn-resolve' : 'btn-reopen'}`;
  const toggleIcon = btnToggleTicketStatus.querySelector('i');
  if (toggleIcon) {
    toggleIcon.setAttribute('data-lucide', isTicketOpen ? 'check-circle' : 'refresh-cw');
  }

  // Load private operator notes
  operatorNotes.value = localStorage.getItem(`operator_notes_${ticketId}`) || '';

  lucide.createIcons();
}

// ── Real-time Messages Listener for ticket subcollection ────────────────────
function setupMessagesListener(ticketId) {
  const messagesQuery = query(
    collection(db, `chat_conversations/${ticketId}/messages`),
    orderBy('time', 'asc')
  );

  messagesListener = onSnapshot(messagesQuery, (snapshot) => {
    messagesListWrapper.innerHTML = '';

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const isAdminMsg = data.senderUid === 'support-admin';

      const timeString = formatTimestamp(data.time);

      const item = document.createElement('div');
      item.className = `message-item ${isAdminMsg ? 'sent' : ''}`;

      const initials = isAdminMsg ? 'SU' : activeChatTitle.textContent.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
      const avatarColor = isAdminMsg ? 'yellow' : (state.tickets[ticketId]?.participantDetails?.[(state.tickets[ticketId]?.participants || []).find(p => p !== 'support-admin')]?.avatarColor || 'teal');

      item.innerHTML = `
        <div class="message-avatar-wrap">
          <div class="message-avatar ${avatarColor}">${initials}</div>
        </div>
        <div class="message-content-wrap">
          <div class="message-sender-row">
            <span class="message-sender-name">${data.senderName}</span>
            <span class="message-time">${timeString}</span>
          </div>
          <div class="message-bubble">
            ${data.text}
          </div>
        </div>
      `;

      messagesListWrapper.appendChild(item);
    });

    // Auto-scroll support chats to bottom
    setTimeout(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 50);
  });
}

// ── Send Support Operator Message ────────────────────────────────────────────
async function handleSendAdminReply() {
  const text = messageTextarea.value.trim();
  const ticketId = state.activeTicketId;
  if (!text || !ticketId) return;

  try {
    const messagesColl = collection(db, `chat_conversations/${ticketId}/messages`);
    await addDoc(messagesColl, {
      senderUid: 'support-admin',
      senderName: 'Calyx Support',
      text: text,
      time: serverTimestamp()
    });

    const convDocRef = doc(db, 'chat_conversations', ticketId);
    await setDoc(convDocRef, {
      lastMessage: `Calyx Support: ${text}`,
      lastMessageTime: serverTimestamp()
    }, { merge: true });

    messageTextarea.value = '';
    messageTextarea.style.height = 'auto';
    btnSendMessage.disabled = true;
  } catch (err) {
    console.error("Failed to send operator message:", err);
    showToast("Error sending reply.");
  }
}

// ── Toggle Ticket Status (Open vs Resolved) ──────────────────────────────────
btnToggleTicketStatus.addEventListener('click', async () => {
  const ticketId = state.activeTicketId;
  const ticket = state.tickets[ticketId];
  if (!ticketId || !ticket) return;

  const currentStatus = ticket.status || 'open';
  const newStatus = currentStatus === 'open' ? 'resolved' : 'open';

  try {
    const convDocRef = doc(db, 'chat_conversations', ticketId);
    await setDoc(convDocRef, {
      status: newStatus,
      lastMessage: `Status updated to: ${newStatus === 'open' ? 'Open' : 'Resolved'}`,
      lastMessageTime: serverTimestamp()
    }, { merge: true });

    showToast(`Ticket status marked as: ${newStatus.toUpperCase()}`);
  } catch (err) {
    console.error("Error updating ticket status:", err);
    showToast("Failed to toggle ticket status.");
  }
});

// ── Autosave internal notes ──────────────────────────────────────────────────
operatorNotes.addEventListener('input', () => {
  const ticketId = state.activeTicketId;
  if (!ticketId) return;
  localStorage.setItem(`operator_notes_${ticketId}`, operatorNotes.value);
});

// ── Chat text input interactions ─────────────────────────────────────────────
messageTextarea.addEventListener('input', () => {
  // Auto-grow textarea
  messageTextarea.style.height = 'auto';
  messageTextarea.style.height = (messageTextarea.scrollHeight - 4) + 'px';

  // Toggle button state
  btnSendMessage.disabled = messageTextarea.value.trim().length === 0;
});

messageTextarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendAdminReply();
  }
});

btnSendMessage.addEventListener('click', handleSendAdminReply);

// ── Ticket Sidebar Tabs controls ──────────────────────────────────────────────
document.getElementById('tab-all-tickets').addEventListener('click', (e) => {
  setActiveTab(e.currentTarget, 'all');
});
document.getElementById('tab-open-tickets').addEventListener('click', (e) => {
  setActiveTab(e.currentTarget, 'open');
});
document.getElementById('tab-resolved-tickets').addEventListener('click', (e) => {
  setActiveTab(e.currentTarget, 'resolved');
});

function setActiveTab(button, filter) {
  document.querySelectorAll('.ticket-status-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
  button.classList.add('active');
  state.filterStatus = filter;
  renderTicketsList();
}

// ── Search bar text listener ─────────────────────────────────────────────────
document.getElementById('ticket-search').addEventListener('input', (e) => {
  state.searchQuery = e.target.value.trim();
  renderTicketsList();
});

// ── Utility Helper Functions ──────────────────────────────────────────────────
function showToast(message) {
  const toast = document.getElementById('auth-toast');
  const msgEl = document.getElementById('auth-toast-msg');
  if (!toast || !msgEl) return;

  msgEl.textContent = message;
  toast.style.display = 'flex';

  if (window.toastTimeout) clearTimeout(window.toastTimeout);
  window.toastTimeout = setTimeout(() => {
    toast.style.display = 'none';
  }, 2500);
}

function getFriendlyErrorMessage(err) {
  switch (err.code) {
    case 'auth/invalid-email': return 'The operator email address format is invalid.';
    case 'auth/user-disabled': return 'This operator account has been disabled.';
    case 'auth/user-not-found': return 'Authorized operator profile was not found.';
    case 'auth/wrong-password': return 'Incorrect secret credentials entered.';
    case 'auth/invalid-credential': return 'Authentication credentials mismatched.';
    default: return err.message || 'An unexpected authentication error occurred.';
  }
}
