
// Calyx Chat Application Logic
import { auth, db, updateProfile, signOut } from './firebase.js';
import { esc } from './html.js';
import {
  collection,
  getDocs,
  doc,
  setDoc,
  getDoc,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  arrayUnion,
} from 'firebase/firestore';

// Real-time listener references (stored so they can be unsubscribed)
let conversationsListener = null;
let messagesListener = null;

// Robust Timestamp and Date formatter helper
function formatTimestamp(timestamp) {
  if (!timestamp) return 'Now';

  // 1. If it's a Firestore Timestamp with toDate() method
  if (typeof timestamp.toDate === 'function') {
    try {
      const date = timestamp.toDate();
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      console.error("Error calling toDate on timestamp:", e);
    }
  }

  // 2. If it's a plain object with seconds (sometimes happens with serialized or offline data)
  if (typeof timestamp === 'object' && timestamp !== null && 'seconds' in timestamp) {
    try {
      const date = new Date(timestamp.seconds * 1000);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      console.error("Error parsing seconds timestamp:", e);
    }
  }

  // 3. If it's a JS Date object
  if (timestamp instanceof Date) {
    return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // 4. If it's a string or number
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

  // 5. Fallback for FieldValue (pending local write) or anything else
  return 'Now';
}

function getCurrentUserName() {
  const user = auth.currentUser;
  return user?.displayName || user?.email?.split('@')[0] || 'Me';
}

function getCurrentUserInitials() {
  const user = auth.currentUser;
  return user?.displayName
    ? user.displayName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : (user?.email ? user.email.slice(0, 2).toUpperCase() : 'ME');
}

async function updateParticipantDetailsInAllConversations(uid, displayName, photoUrl) {
  try {
    const conversationsQuery = query(
      collection(db, 'chat_conversations'),
      where('participants', 'array-contains', uid)
    );
    const convsSnap = await getDocs(conversationsQuery);
    for (const convDoc of convsSnap.docs) {
      const convData = convDoc.data();
      const details = convData.participantDetails || {};
      if (!details[uid]) {
        details[uid] = {};
      }
      details[uid].displayName = displayName;
      details[uid].photoURL = photoUrl || null;
      await updateDoc(convDoc.ref, { participantDetails: details });
    }
  } catch (err) {
    console.error("Error updating participant details in conversations:", err);
  }
}

function getStarredChatIds() {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const key = `starred_chats_${user.uid}`;
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch (e) {
    return [];
  }
}

function saveStarredChatIds(starredIds) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const key = `starred_chats_${user.uid}`;
    localStorage.setItem(key, JSON.stringify(starredIds));
  } catch (e) { }
}

function isChatStarred(chatId) {
  return getStarredChatIds().includes(chatId);
}

function toggleChatStarred(chatId) {
  let starredIds = getStarredChatIds();
  if (starredIds.includes(chatId)) {
    starredIds = starredIds.filter(id => id !== chatId);
  } else {
    starredIds.push(chatId);
  }
  saveStarredChatIds(starredIds);
  renderSidebar();
  renderHomeFeed();
  renderChatActiveWindow(chatId);
}

function hasMention(chat) {
  if (!chat.history) return false;
  const userName = getCurrentUserName().toLowerCase();
  const userInitials = getCurrentUserInitials().toLowerCase();

  return chat.history.some(msg => {
    if (msg.isMe) return false;
    const text = (msg.text || '').toLowerCase();

    return text.includes('@') && (
      text.includes('@' + userName) ||
      text.includes('@' + userName.replace(/\s+/g, '')) ||
      text.includes('@' + userInitials) ||
      text.includes('@all') ||
      text.includes('@everyone') ||
      text.includes('@here')
    );
  });
}

// Initial Application State
const state = {
  activeChatId: 'calyx-bot', // Default chat
  userStatus: 'active',  // active, away, dnd, offline
  isDarkMode: true,      // Default dark mode
  showUnreadOnly: false,
  collapsedSidebar: false,
  collapsedUtility: false,
  activeShortcut: 'home',
  replyingToMsg: null,
  editingMsg: null,
  chats: {
    'calyx-bot': {
      id: 'calyx-bot',
      type: 'app',
      name: 'Calyx Intro Bot',
      lastMessage: 'Welcome to Calyx Chat! How can I help you today?',
      lastMessageTime: 'Now',
      unreadCount: 0,
      avatarColor: 'yellow',
      status: 'online',
      history: [
        {
          id: 'cb1',
          senderName: 'Calyx Intro Bot',
          isMe: false,
          text: 'Hey there! I am the Calyx Intro Bot. I am developed by Arnabh aka ZenSensi',
          time: '12:44 PM'
        },
        {
          id: 'cb2',
          senderName: 'Calyx Intro Bot',
          isMe: false,
          text: 'Welcome to Calyx Chat! Calyx chat is a platform for seamless communication and collaboration. It is a place where you can connect with your friends, family, and colleagues in real-time, without sharing any personal information.',
          time: '12:45 PM'
        }
      ]
    }
  }
};

// DOM Elements
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

function initApp() {
  // Setup Lucide icons
  lucide.createIcons();

  // Register event listeners
  setupEventListeners();

  // Initial renders
  renderSidebar();
  renderHomeFeed();
  renderChatActiveWindow(state.activeChatId);
  updateTheme();

  // Start listening for real-time Firestore conversations
  setupRealtimeListeners();
}

function setupEventListeners() {
  // Theme Toggle
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  // Sidebar Toggle (Hamburger)
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('left-sidebar');
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      state.collapsedSidebar = !state.collapsedSidebar;
      sidebar.classList.toggle('collapsed', state.collapsedSidebar);
    });
  }

  // Utility Sidebar Toggle (Right side collapse)
  const utilityToggle = document.getElementById('btn-toggle-utility');
  const utilitySidebar = document.getElementById('utility-sidebar');
  if (utilityToggle && utilitySidebar) {
    utilityToggle.addEventListener('click', () => {
      state.collapsedUtility = !state.collapsedUtility;
      utilitySidebar.classList.toggle('collapsed', state.collapsedUtility);

      const icon = utilityToggle.querySelector('i');
      if (icon) {
        icon.setAttribute('data-lucide', state.collapsedUtility ? 'chevron-left' : 'chevron-right');
        lucide.createIcons();
      }
    });
  }

  // Status Selector
  const statusPill = document.getElementById('status-pill');
  const statusDropdown = document.getElementById('status-dropdown');
  if (statusPill && statusDropdown) {
    statusPill.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = statusDropdown.style.display === 'flex';
      statusDropdown.style.display = isVisible ? 'none' : 'flex';
    });

    // Close status dropdown clicking elsewhere
    document.addEventListener('click', () => {
      statusDropdown.style.display = 'none';
    });

    // Handle status changes
    statusDropdown.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const newStatus = e.currentTarget.getAttribute('data-status');
        updateUserStatus(newStatus);
      });
    });
  }

  // Textarea input auto-grow and submit check
  const textarea = document.getElementById('message-textarea');
  const sendBtn = document.getElementById('btn-send-message');
  if (textarea && sendBtn) {
    textarea.addEventListener('input', () => {
      // Auto-grow
      textarea.style.height = 'auto';
      textarea.style.height = (textarea.scrollHeight - 4) + 'px';

      // Send button disable state
      const hasText = textarea.value.trim().length > 0;
      sendBtn.disabled = !hasText;
    });

    // Submit on enter (unless shift is pressed)
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });

    sendBtn.addEventListener('click', handleSendMessage);
  }

  // Search input filter
  const searchInput = document.getElementById('chat-search');
  const clearSearchBtn = document.getElementById('search-clear-btn');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const val = searchInput.value.trim();
      clearSearchBtn.style.display = val.length > 0 ? 'block' : 'none';
      renderHomeFeed(val);
    });

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearSearchBtn.style.display = 'none';
      renderHomeFeed();
    });
  }

  // Unread Toggle filter
  const unreadToggle = document.getElementById('unread-toggle');
  if (unreadToggle) {
    unreadToggle.addEventListener('change', (e) => {
      state.showUnreadOnly = e.target.checked;
      renderHomeFeed();
    });
  }

  const nameInput = document.getElementById('new-chat-name');
  const searchDropdown = document.getElementById('search-results-dropdown');

  const triggerUserSearch = async () => {
    const typeRadio = newChatForm.querySelector('input[name="chat-type"]:checked');
    const type = typeRadio ? typeRadio.value : 'dm';

    if (type !== 'dm') {
      if (searchDropdown) searchDropdown.style.display = 'none';
      return;
    }

    try {
      renderSearchResults(await findUsers(nameInput ? nameInput.value : ''));
    } catch (err) {
      console.error("Error querying users collection:", err);
    }
  };

  // New Chat Modal Triggers
  const newChatBtns = document.querySelectorAll('.trigger-new-chat, #btn-new-chat');
  const newChatModal = document.getElementById('new-chat-modal');
  const modalClose = document.getElementById('modal-close');
  const modalCancel = document.getElementById('btn-modal-cancel');
  const newChatForm = document.getElementById('new-chat-form');

  newChatBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      newChatModal.style.display = 'flex';
      if (nameInput) {
        nameInput.focus();
        triggerUserSearch();
      }
    });
  });

  const closeModal = () => {
    newChatModal.style.display = 'none';
    newChatForm.reset();
    newChatForm.querySelectorAll('.type-option').forEach((opt, idx) => {
      opt.classList.toggle('active', idx === 0);
    });
    newChatForm.querySelectorAll('.avatar-color-option').forEach((opt, idx) => {
      opt.classList.toggle('active', idx === 0);
    });
    if (searchDropdown) searchDropdown.style.display = 'none';
  };

  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modalCancel) modalCancel.addEventListener('click', closeModal);

  // New Chat Modal Radio toggles (styling only since browser radios are hidden)
  newChatForm.querySelectorAll('.type-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      newChatForm.querySelectorAll('.type-option').forEach(o => o.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const radio = e.currentTarget.querySelector('input[type="radio"]');
      radio.checked = true;

      // Update name input placeholder
      const labelName = document.getElementById('label-chat-name');
      if (radio.value === 'space') {
        if (nameInput) {
          nameInput.placeholder = 'e.g. Design Sync, Marketing Campaign...';
        }
        if (labelName) {
          labelName.textContent = 'Space Name';
        }
        if (searchDropdown) searchDropdown.style.display = 'none';
      } else {
        if (nameInput) {
          nameInput.placeholder = 'e.g. John Doe...';
        }
        if (labelName) {
          labelName.textContent = 'Contact Name';
        }
        triggerUserSearch();
      }
    });
  });

  newChatForm.querySelectorAll('.avatar-color-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      newChatForm.querySelectorAll('.avatar-color-option').forEach(o => o.classList.remove('active'));
      e.currentTarget.classList.add('active');
      e.currentTarget.querySelector('input[type="radio"]').checked = true;
    });
  });

  // User directory search for DM type
  if (nameInput && searchDropdown) {
    nameInput.addEventListener('input', triggerUserSearch);
    nameInput.addEventListener('focus', triggerUserSearch);
    nameInput.addEventListener('click', triggerUserSearch);

    document.addEventListener('click', (e) => {
      if (!nameInput.contains(e.target) && !searchDropdown.contains(e.target)) {
        searchDropdown.style.display = 'none';
      }
    });
  }

  // Modal Submit (handles space creation and fallback DM resolution)
  newChatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-chat-name').value.trim();
    const type = newChatForm.querySelector('input[name="chat-type"]:checked').value;
    const color = newChatForm.querySelector('input[name="avatar-color"]:checked').value;

    if (!name) return;

    if (type === 'space') {
      const myUser = auth.currentUser;
      if (!myUser) return;

      const spaceId = 'space_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

      try {
        const docRef = doc(db, 'chat_conversations', spaceId);
        await setDoc(docRef, {
          id: spaceId,
          type: 'space',
          participants: [myUser.uid],
          participantDetails: {
            [myUser.uid]: {
              displayName: myUser.displayName || myUser.email.split('@')[0],
              email: myUser.email,
              avatarColor: 'yellow'
            }
          },
          name: name,
          avatarColor: color,
          lastMessage: 'Space created',
          lastMessageTime: serverTimestamp(),
          createdTime: serverTimestamp()
        });

        closeModal();
        switchActiveChat(spaceId);
        showToast(`Created space "${name}"`);
      } catch (err) {
        console.error("Error creating space:", err);
        showToast("Failed to create space.");
      }
    } else if (type === 'dm') {
      const myUser = auth.currentUser;
      if (!myUser) return;

      try {
        const usersSnap = await getDocs(collection(db, 'users'));
        let matchedUser = null;

        usersSnap.forEach(docSnap => {
          const u = docSnap.data();
          if (u.uid === myUser.uid) return;
          if (u.email?.toLowerCase() === name.toLowerCase() || u.displayName?.toLowerCase() === name.toLowerCase()) {
            matchedUser = u;
          }
        });

        if (matchedUser) {
          startDirectMessage(matchedUser);
        } else {
          const matches = [];
          usersSnap.forEach(docSnap => {
            const u = docSnap.data();
            if (u.uid === myUser.uid) return;
            if (u.email?.toLowerCase().includes(name.toLowerCase()) || u.displayName?.toLowerCase().includes(name.toLowerCase())) {
              matches.push(u);
            }
          });

          if (matches.length === 1) {
            startDirectMessage(matches[0]);
          } else {
            showToast("Please select a user from the dropdown search results.");
          }
        }
      } catch (err) {
        console.error("Error submitting DM:", err);
        showToast("Error starting chat.");
      }
    }
  });

  // Quick close expand chat, exit placeholder action, etc.
  const closeChatBtn = document.getElementById('btn-close-chat');
  if (closeChatBtn) {
    closeChatBtn.addEventListener('click', () => {
      document.getElementById('chat-active-container').style.display = 'none';
      document.getElementById('chat-empty-state').style.display = 'flex';
    });
  }

  const expandChatBtn = document.getElementById('btn-expand-chat');
  if (expandChatBtn) {
    expandChatBtn.addEventListener('click', () => {
      showToast("Fullscreen mode activated");
    });
  }

  // Shortcut items click listeners
  const shortcutHome = document.getElementById('shortcut-home');
  const shortcutMentions = document.getElementById('shortcut-mentions');
  const shortcutStarred = document.getElementById('shortcut-starred');

  if (shortcutHome) {
    shortcutHome.addEventListener('click', () => {
      state.activeShortcut = 'home';
      document.querySelector('.center-header h2').textContent = 'Home';
      renderSidebar();
      renderHomeFeed();
    });
  }

  if (shortcutMentions) {
    shortcutMentions.addEventListener('click', () => {
      state.activeShortcut = 'mentions';
      document.querySelector('.center-header h2').textContent = 'Mentions';
      renderSidebar();
      renderHomeFeed();
    });
  }

  if (shortcutStarred) {
    shortcutStarred.addEventListener('click', () => {
      state.activeShortcut = 'starred';
      document.querySelector('.center-header h2').textContent = 'Starred';
      renderSidebar();
      renderHomeFeed();
    });
  }

  const shortcutSupport = document.getElementById('shortcut-support');
  if (shortcutSupport) {
    shortcutSupport.addEventListener('click', async () => {
      state.activeShortcut = 'support';
      document.querySelector('.center-header h2').textContent = 'Support Chat';
      renderSidebar();

      const myUser = auth.currentUser;
      if (!myUser) return;

      const supportId = `support_${myUser.uid}`;

      if (!state.chats[supportId]) {
        try {
          const docRef = doc(db, 'chat_conversations', supportId);
          const docSnap = await getDoc(docRef);

          if (docSnap.exists()) {
            const data = docSnap.data();
            const timeString = formatTimestamp(data.lastMessageTime);
            state.chats[supportId] = {
              id: supportId,
              type: 'support',
              name: 'Support Chat',
              avatarColor: 'teal',
              lastMessage: data.lastMessage || 'Opening support channel...',
              lastMessageTime: timeString,
              status: data.status || 'open',
              ticketExists: true,
              history: []
            };
          } else {
            state.chats[supportId] = {
              id: supportId,
              type: 'support',
              name: 'Support Chat',
              avatarColor: 'teal',
              lastMessage: 'Ticket is closed. Click Open Ticket to start.',
              lastMessageTime: 'Now',
              status: 'closed',
              ticketExists: false,
              history: []
            };
          }
        } catch (err) {
          console.error("Error checking support chat:", err);
          state.chats[supportId] = {
            id: supportId,
            type: 'support',
            name: 'Support Chat',
            avatarColor: 'teal',
            lastMessage: 'Ticket is closed. Click Open Ticket to start.',
            lastMessageTime: 'Now',
            status: 'closed',
            ticketExists: false,
            history: []
          };
        }
      }

      switchActiveChat(supportId);
    });
  }

  // Open Ticket Button listener
  const btnOpenTicket = document.getElementById('btn-open-ticket');
  if (btnOpenTicket) {
    btnOpenTicket.addEventListener('click', async () => {
      const myUser = auth.currentUser;
      if (!myUser) return;

      const supportId = `support_${myUser.uid}`;
      const chat = state.chats[supportId];
      if (!chat) return;

      btnOpenTicket.disabled = true;
      btnOpenTicket.innerHTML = `<span>Opening ticket...</span>`;

      try {
        const docRef = doc(db, 'chat_conversations', supportId);
        
        await setDoc(docRef, {
          id: supportId,
          type: 'support',
          name: 'Support Chat',
          avatarColor: 'teal',
          participants: [myUser.uid, 'support-admin'],
          participantDetails: {
            [myUser.uid]: {
              displayName: myUser.displayName || myUser.email.split('@')[0],
              email: myUser.email,
              photoURL: myUser.photoURL || null,
              avatarColor: 'teal'
            }
          },
          lastMessage: 'Welcome to Calyx Support! A member of our team will assist you shortly.',
          lastMessageTime: serverTimestamp(),
          createdTime: serverTimestamp(),
          status: 'open'
        });

        const msgColl = collection(db, `chat_conversations/${supportId}/messages`);
        await addDoc(msgColl, {
          senderUid: 'support-admin',
          senderName: 'Calyx Support',
          text: 'Welcome to Calyx Support! A member of our team will assist you shortly.',
          time: serverTimestamp()
        });

        chat.ticketExists = true;
        chat.status = 'open';
        chat.lastMessage = 'Welcome to Calyx Support! A member of our team will assist you shortly.';
        
        btnOpenTicket.disabled = false;
        btnOpenTicket.innerHTML = `<i data-lucide="ticket"></i><span>Open Ticket</span>`;
        lucide.createIcons();

        switchActiveChat(supportId);
        showToast("Ticket opened successfully!");
      } catch (err) {
        console.error("Error opening support ticket:", err);
        showToast("Failed to open ticket.");
        btnOpenTicket.disabled = false;
        btnOpenTicket.innerHTML = `<i data-lucide="ticket"></i><span>Open Ticket</span>`;
        lucide.createIcons();
      }
    });
  }

  // Star Chat Button listener
  const starChatBtn = document.getElementById('btn-star-chat');
  if (starChatBtn) {
    starChatBtn.addEventListener('click', () => {
      if (state.activeChatId) {
        toggleChatStarred(state.activeChatId);
      }
    });
  }

  // Add Members (spaces only)
  const addMemberBtn = document.getElementById('btn-add-member');
  const addMemberModal = document.getElementById('add-member-modal');
  const addMemberInput = document.getElementById('add-member-input');
  if (addMemberBtn && addMemberModal && addMemberInput) {
    const searchMembers = async () => {
      const chat = state.chats[state.activeChatId];
      if (!chat || chat.type !== 'space') return;
      try {
        const matches = await findUsers(addMemberInput.value, chat.participants);
        renderSearchResults(matches, 'add-member-results', async (user) => {
          if (await addMemberToSpace(chat.id, user)) closeAddMember();
        });
      } catch (err) {
        console.error('Error searching users to add:', err);
      }
    };
    const closeAddMember = () => {
      addMemberModal.style.display = 'none';
      addMemberInput.value = '';
      document.getElementById('add-member-results').style.display = 'none';
    };

    addMemberBtn.addEventListener('click', () => {
      if (state.chats[state.activeChatId]?.type !== 'space') return;
      addMemberModal.style.display = 'flex';
      addMemberInput.focus();
      searchMembers();
    });
    addMemberInput.addEventListener('input', searchMembers);
    document.getElementById('add-member-close').addEventListener('click', closeAddMember);
    addMemberModal.addEventListener('click', (e) => {
      if (e.target === addMemberModal) closeAddMember();
    });
  }

  // Bot option buttons event listeners
  const botOptionsWrapper = document.getElementById('bot-options-wrapper');
  if (botOptionsWrapper) {
    botOptionsWrapper.querySelectorAll('.bot-option-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const question = btn.getAttribute('data-question');
        if (!question) return;

        const activeChatId = 'calyx-bot';
        const activeChat = state.chats[activeChatId];
        if (!activeChat) return;

        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Add user message to history
        activeChat.history.push({
          id: 'msg-' + Date.now(),
          senderName: getCurrentUserName(),
          isMe: true,
          text: question,
          time: timeString
        });

        // Update last message preview
        activeChat.lastMessage = `You: ${question}`;
        activeChat.lastMessageTime = timeString;

        // Render updates
        renderHomeFeed();
        renderChatActiveWindow(activeChatId);

        // Trigger simulated response
        setTimeout(() => {
          simulateBotResponse(activeChatId, question);
        }, 1000);
      });
    });
  }

  // Preview bar close button
  const previewCloseBtn = document.getElementById('preview-bar-close-btn');
  if (previewCloseBtn) {
    previewCloseBtn.addEventListener('click', cancelInputMode);
  }

  // Setup message-level interactions (clicks, touch gestures, right-click, context menu)
  setupMessageInteractions();

  // Profile settings modal triggers
  const profileSettingsModal = document.getElementById('profile-settings-modal');
  const profileModalClose = document.getElementById('profile-modal-close');
  const profileCancelBtn = document.getElementById('btn-profile-cancel');

  const openProfileSettings = () => {
    if (profileSettingsModal) {
      const user = auth.currentUser;
      if (!user) return;

      const displayNameInput = document.getElementById('profile-display-name');
      const emailInput = document.getElementById('profile-email-readonly');
      const pfpImg = document.getElementById('profile-pfp-img');
      const pfpFallback = document.getElementById('profile-pfp-fallback');
      const removePhotoBtn = document.getElementById('btn-remove-photo');
      const previewContainer = document.getElementById('profile-pfp-preview-container');

      if (displayNameInput) displayNameInput.value = user.displayName || user.email.split('@')[0];
      if (emailInput) emailInput.value = user.email;

      const initials = getCurrentUserInitials();
      if (pfpFallback) pfpFallback.textContent = initials;

      if (user.photoURL) {
        if (pfpImg) {
          pfpImg.src = user.photoURL;
          pfpImg.style.display = 'block';
        }
        if (pfpFallback) pfpFallback.style.display = 'none';
        if (removePhotoBtn) removePhotoBtn.style.display = 'inline-block';
        if (previewContainer) previewContainer.dataset.photoUrl = user.photoURL;
      } else {
        if (pfpImg) {
          pfpImg.src = '';
          pfpImg.style.display = 'none';
        }
        if (pfpFallback) pfpFallback.style.display = 'block';
        if (removePhotoBtn) removePhotoBtn.style.display = 'none';
        if (previewContainer) previewContainer.dataset.photoUrl = '';
      }

      profileSettingsModal.style.display = 'flex';
      lucide.createIcons();
    }
  };

  window.addEventListener('open-profile-settings', openProfileSettings);

  // Bind settings icon in header to open profile modal too!
  const settingsBtn = document.querySelector('[title="Settings"]');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', openProfileSettings);
  }

  const closeProfileSettings = () => {
    if (profileSettingsModal) profileSettingsModal.style.display = 'none';
  };

  if (profileModalClose) profileModalClose.addEventListener('click', closeProfileSettings);
  if (profileCancelBtn) profileCancelBtn.addEventListener('click', closeProfileSettings);

  // Photo Uploader actions
  const uploadPhotoBtn = document.getElementById('btn-upload-photo');
  const removePhotoBtn = document.getElementById('btn-remove-photo');
  const pfpInput = document.getElementById('profile-pfp-input');
  const previewContainer = document.getElementById('profile-pfp-preview-container');

  if (uploadPhotoBtn && pfpInput) {
    uploadPhotoBtn.addEventListener('click', () => pfpInput.click());
  }
  if (previewContainer && pfpInput) {
    previewContainer.addEventListener('click', () => pfpInput.click());
  }

  if (pfpInput) {
    pfpInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          // Resize client-side using canvas
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const maxDim = 128;
          let w = img.width;
          let h = img.height;
          if (w > h) {
            if (w > maxDim) {
              h = Math.round(h * maxDim / w);
              w = maxDim;
            }
          } else {
            if (h > maxDim) {
              w = Math.round(w * maxDim / h);
              h = maxDim;
            }
          }
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(img, 0, 0, w, h);
          const resizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

          const pfpImg = document.getElementById('profile-pfp-img');
          const pfpFallback = document.getElementById('profile-pfp-fallback');

          if (pfpImg) {
            pfpImg.src = resizedDataUrl;
            pfpImg.style.display = 'block';
          }
          if (pfpFallback) pfpFallback.style.display = 'none';
          if (removePhotoBtn) removePhotoBtn.style.display = 'inline-block';
          if (previewContainer) previewContainer.dataset.photoUrl = resizedDataUrl;
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  if (removePhotoBtn) {
    removePhotoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pfpImg = document.getElementById('profile-pfp-img');
      const pfpFallback = document.getElementById('profile-pfp-fallback');

      if (pfpImg) {
        pfpImg.src = '';
        pfpImg.style.display = 'none';
      }
      if (pfpFallback) {
        pfpFallback.style.display = 'block';
        pfpFallback.textContent = getCurrentUserInitials();
      }
      removePhotoBtn.style.display = 'none';
      if (previewContainer) previewContainer.dataset.photoUrl = '';
      if (pfpInput) pfpInput.value = '';
    });
  }

  // Profile Form Submit
  const profileForm = document.getElementById('profile-settings-form');
  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('btn-profile-submit');
      const prevSubmitText = submitBtn ? submitBtn.textContent : 'Save Changes';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
      }

      const displayName = document.getElementById('profile-display-name').value.trim();
      const photoUrl = previewContainer ? (previewContainer.dataset.photoUrl || '') : '';

      try {
        const user = auth.currentUser;
        if (user) {
          // 1. Update Firebase Auth Profile
          await updateProfile(user, {
            displayName: displayName,
            photoURL: photoUrl || null
          });

           // 2. Update Firestore Doc
          const userDocRef = doc(db, 'users', user.uid);
          await setDoc(userDocRef, {
            displayName: displayName,
            photoURL: photoUrl || null,
            lastActive: serverTimestamp()
          }, { merge: true });

          await updateParticipantDetailsInAllConversations(user.uid, displayName, photoUrl);

          // 3. Update top-right avatar UI
          const profileBtn = document.getElementById('user-profile-btn');
          if (profileBtn) {
            if (photoUrl) {
              profileBtn.innerHTML = `<img src="${esc(photoUrl)}" alt="User Profile Picture" referrerpolicy="no-referrer" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
              profileBtn.style.padding = '0';
              profileBtn.style.background = 'transparent';
              profileBtn.style.border = 'none';
            } else {
              const initials = getCurrentUserInitials();
              profileBtn.innerHTML = `<span aria-hidden="true">${esc(initials)}</span>`;
              profileBtn.removeAttribute('style'); // reset style changes
            }
          }

          // 4. Update conversation states & render chat window
          if (state.activeChatId) {
            renderChatActiveWindow(state.activeChatId);
          }
          renderSidebar();
          renderHomeFeed();

          showToast("Profile updated successfully!");
          closeProfileSettings();
        }
      } catch (err) {
        console.error("Error updating profile:", err);
        showToast("Failed to update profile.");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = prevSubmitText;
        }
      }
    });
  }

  // Profile signout button
  const profileSignoutBtn = document.getElementById('btn-profile-signout');
  if (profileSignoutBtn) {
    profileSignoutBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to sign out?')) {
        signOut(auth).then(() => location.reload());
      }
    });
  }
}

// Setup Message Interactions (Right-click, click delegation, touch swipes)
function setupMessageInteractions() {
  const wrapper = document.getElementById('messages-list-wrapper');
  if (!wrapper) return;

  // Click delegation
  wrapper.addEventListener('click', (e) => {
    // Desktop reply button
    const replyBtn = e.target.closest('.btn-msg-reply');
    if (replyBtn) {
      e.stopPropagation();
      const container = replyBtn.closest('.message-item-container');
      if (container) {
        triggerReply({
          id: container.getAttribute('data-msg-id'),
          sender: container.getAttribute('data-sender'),
          text: container.getAttribute('data-text')
        });
      }
      return;
    }

    // Quoted reply navigation
    const replyRef = e.target.closest('.message-bubble-reply-ref');
    if (replyRef) {
      e.stopPropagation();
      const targetId = replyRef.getAttribute('data-target-id');
      if (targetId) {
        const targetEl = wrapper.querySelector(`[data-msg-id="${targetId}"]`);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetEl.classList.add('highlight-flash');
          setTimeout(() => {
            targetEl.classList.remove('highlight-flash');
          }, 1200);
        }
      }
    }
  });

  // Right-click contextmenu delegation (Desktop)
  wrapper.addEventListener('contextmenu', (e) => {
    const container = e.target.closest('.message-item-container');
    if (!container || container.querySelector('.message-item.system')) return;

    e.preventDefault();

    const msgId = container.getAttribute('data-msg-id');
    const sender = container.getAttribute('data-sender');
    const text = container.getAttribute('data-text');
    const isMe = container.getAttribute('data-is-me');

    showContextMenu(e.clientX, e.clientY, { msgId, sender, text, isMe });
  });

  // Mobile Touch Gestures (Long hold & Swipe-left reply)
  let touchTimer = null;
  let touchStartPos = { x: 0, y: 0 };
  let isSwiping = false;
  let swipedElement = null;

  wrapper.addEventListener('touchstart', (e) => {
    const container = e.target.closest('.message-item-container');
    if (!container || container.querySelector('.message-item.system')) return;

    const item = container.querySelector('.message-item');
    if (!item) return;

    const touch = e.touches[0];
    touchStartPos = { x: touch.clientX, y: touch.clientY };
    isSwiping = false;
    swipedElement = item;

    if (touchTimer) clearTimeout(touchTimer);

    touchTimer = setTimeout(() => {
      if (!isSwiping) {
        if (navigator.vibrate) navigator.vibrate(50);
        
        const msgId = container.getAttribute('data-msg-id');
        const sender = container.getAttribute('data-sender');
        const text = container.getAttribute('data-text');
        const isMe = container.getAttribute('data-is-me');

        showContextMenu(touch.clientX, touch.clientY, { msgId, sender, text, isMe });
      }
    }, 600); // 600ms long hold
  }, { passive: true });

  wrapper.addEventListener('touchmove', (e) => {
    if (!swipedElement) return;

    const touch = e.touches[0];
    const diffX = touchStartPos.x - touch.clientX;
    const diffY = touchStartPos.y - touch.clientY;

    if (!isSwiping && Math.abs(diffX) > 10 && Math.abs(diffX) > Math.abs(diffY)) {
      isSwiping = true;
      if (touchTimer) clearTimeout(touchTimer);
    }

    if (isSwiping) {
      if (diffX > 0) {
        const translateVal = Math.min(diffX, 80);
        swipedElement.style.transform = `translateX(-${translateVal}px)`;
        swipedElement.style.transition = 'none';

        const indicator = swipedElement.querySelector('.swipe-reply-indicator');
        if (indicator) {
          indicator.style.opacity = Math.min(diffX / 60, 1);
          indicator.style.right = `${-30 + Math.min(diffX, 60)}px`;
        }

        if (e.cancelable) e.preventDefault();
      }
    } else {
      if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
        if (touchTimer) clearTimeout(touchTimer);
      }
    }
  }, { passive: false });

  wrapper.addEventListener('touchend', (e) => {
    if (touchTimer) clearTimeout(touchTimer);

    if (swipedElement && isSwiping) {
      const touch = e.changedTouches[0];
      const diffX = touchStartPos.x - touch.clientX;

      swipedElement.style.transition = 'transform 0.15s ease-out';
      swipedElement.style.transform = 'translateX(0)';

      const indicator = swipedElement.querySelector('.swipe-reply-indicator');
      if (indicator) {
        indicator.style.opacity = '0';
        indicator.style.right = '-30px';
      }

      if (diffX >= 60) {
        const container = swipedElement.closest('.message-item-container');
        if (container) {
          if (navigator.vibrate) navigator.vibrate(30);
          triggerReply({
            id: container.getAttribute('data-msg-id'),
            sender: container.getAttribute('data-sender'),
            text: container.getAttribute('data-text')
          });
        }
      }
    }

    swipedElement = null;
    isSwiping = false;
  });

  // Global menu dismisses
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('message-context-menu');
    if (menu && !menu.contains(e.target)) {
      menu.style.display = 'none';
    }
  });

  document.addEventListener('contextmenu', (e) => {
    const menu = document.getElementById('message-context-menu');
    if (menu && !e.target.closest('#messages-list-wrapper')) {
      menu.style.display = 'none';
    }
  });

  // Context Menu Item Listeners
  const ctxReply = document.getElementById('ctx-reply');
  if (ctxReply) {
    ctxReply.addEventListener('click', () => {
      const menu = document.getElementById('message-context-menu');
      if (menu) {
        triggerReply({
          id: menu.dataset.msgId,
          sender: menu.dataset.sender,
          text: menu.dataset.text
        });
        menu.style.display = 'none';
      }
    });
  }

  const ctxEdit = document.getElementById('ctx-edit');
  if (ctxEdit) {
    ctxEdit.addEventListener('click', () => {
      const menu = document.getElementById('message-context-menu');
      if (menu) {
        triggerEdit({
          id: menu.dataset.msgId,
          text: menu.dataset.text
        });
        menu.style.display = 'none';
      }
    });
  }

  const ctxDelete = document.getElementById('ctx-delete');
  if (ctxDelete) {
    ctxDelete.addEventListener('click', () => {
      const menu = document.getElementById('message-context-menu');
      if (menu) {
        handleDeleteMessage(menu.dataset.msgId);
        menu.style.display = 'none';
      }
    });
  }
}

// Show Custom Message Context Menu positioned perfectly within the viewport bounds
function showContextMenu(x, y, msgData) {
  const menu = document.getElementById('message-context-menu');
  if (!menu) return;

  menu.style.display = 'flex';

  const menuWidth = menu.offsetWidth || 150;
  const menuHeight = menu.offsetHeight || 110;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let posX = x;
  let posY = y;

  if (x + menuWidth > vw) {
    posX = vw - menuWidth - 10;
  }
  if (y + menuHeight > vh) {
    posY = vh - menuHeight - 10;
  }

  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;

  menu.dataset.msgId = msgData.msgId;
  menu.dataset.sender = msgData.sender;
  menu.dataset.text = msgData.text;
  menu.dataset.isMe = msgData.isMe;

  const isMe = msgData.isMe === 'true';
  const editBtn = document.getElementById('ctx-edit');
  const deleteBtn = document.getElementById('ctx-delete');

  if (editBtn) editBtn.style.display = isMe ? 'flex' : 'none';
  if (deleteBtn) deleteBtn.style.display = isMe ? 'flex' : 'none';
}

// Enter Message Reply Mode
function triggerReply(msg) {
  state.replyingToMsg = msg;
  state.editingMsg = null;

  const previewBar = document.getElementById('input-action-preview-bar');
  const previewTitle = document.getElementById('preview-bar-title');
  const previewText = document.getElementById('preview-bar-text');
  const previewIcon = document.getElementById('preview-bar-icon');

  if (previewBar && previewTitle && previewText) {
    previewTitle.textContent = `Replying to ${msg.sender}`;
    previewText.textContent = msg.text;

    if (previewIcon) {
      previewIcon.setAttribute('data-lucide', 'corner-up-left');
      lucide.createIcons();
    }

    previewBar.style.display = 'flex';
  }

  const textarea = document.getElementById('message-textarea');
  if (textarea) {
    textarea.focus();
  }
}

// Enter Message Edit Mode
function triggerEdit(msg) {
  state.editingMsg = msg;
  state.replyingToMsg = null;

  const previewBar = document.getElementById('input-action-preview-bar');
  const previewTitle = document.getElementById('preview-bar-title');
  const previewText = document.getElementById('preview-bar-text');
  const previewIcon = document.getElementById('preview-bar-icon');

  if (previewBar && previewTitle && previewText) {
    previewTitle.textContent = `Editing Message`;
    previewText.textContent = msg.text;

    if (previewIcon) {
      previewIcon.setAttribute('data-lucide', 'edit-3');
      lucide.createIcons();
    }

    previewBar.style.display = 'flex';
  }

  const textarea = document.getElementById('message-textarea');
  if (textarea) {
    textarea.value = msg.text;
    textarea.focus();
    // Auto-grow heights
    textarea.dispatchEvent(new Event('input'));
  }
}

// Handle Message Deletion (local or Firestore)
function handleDeleteMessage(msgId) {
  if (confirm("Are you sure you want to delete this message?")) {
    const activeChatId = state.activeChatId;
    if (activeChatId === 'calyx-bot') {
      const activeChat = state.chats[activeChatId];
      if (activeChat) {
        const msg = activeChat.history.find(m => m.id === msgId);
        if (msg) {
          msg.isDeleted = true;
        }
        renderChatActiveWindow(activeChatId);
      }
    } else {
      deleteMessageInFirestore(activeChatId, msgId);
    }
  }
}

// Cancel edit or reply mode and clear state
function cancelInputMode() {
  const textarea = document.getElementById('message-textarea');
  if (state.editingMsg && textarea) {
    textarea.value = '';
  }
  state.replyingToMsg = null;
  state.editingMsg = null;

  const previewBar = document.getElementById('input-action-preview-bar');
  if (previewBar) {
    previewBar.style.display = 'none';
  }

  if (textarea) {
    textarea.style.height = 'auto';
    const sendBtn = document.getElementById('btn-send-message');
    if (sendBtn) {
      sendBtn.disabled = textarea.value.trim() === '';
    }
  }
}

// Edit message inside Firestore conversation
async function editMessageInFirestore(conversationId, messageId, newText) {
  try {
    const msgDocRef = doc(db, `chat_conversations/${conversationId}/messages/${messageId}`);
    await updateDoc(msgDocRef, {
      text: newText,
      isEdited: true
    });
  } catch (err) {
    console.error("Error editing message in Firestore:", err);
    showToast("Failed to edit message.");
  }
}

// Mark message as deleted inside Firestore conversation
async function deleteMessageInFirestore(conversationId, messageId) {
  try {
    const msgDocRef = doc(db, `chat_conversations/${conversationId}/messages/${messageId}`);
    await updateDoc(msgDocRef, {
      isDeleted: true
    });
  } catch (err) {
    console.error("Error deleting message in Firestore:", err);
    showToast("Failed to delete message.");
  }
}


// Render the Left Sidebar Lists
function renderSidebar() {
  const dmsList = document.getElementById('dms-list');
  const spacesList = document.getElementById('spaces-list');
  if (!dmsList || !spacesList) return;

  // Sync shortcuts active state
  const homeBtn = document.getElementById('shortcut-home');
  const mentionsBtn = document.getElementById('shortcut-mentions');
  const starredBtn = document.getElementById('shortcut-starred');
  const supportBtn = document.getElementById('shortcut-support');

  if (homeBtn) homeBtn.classList.toggle('active', state.activeShortcut === 'home');
  if (mentionsBtn) mentionsBtn.classList.toggle('active', state.activeShortcut === 'mentions');
  if (starredBtn) starredBtn.classList.toggle('active', state.activeShortcut === 'starred');
  if (supportBtn) supportBtn.classList.toggle('active', state.activeShortcut === 'support');

  dmsList.innerHTML = '';
  spacesList.innerHTML = '';

  let dmsCount = 0;
  let spacesCount = 0;

  Object.values(state.chats).forEach(chat => {
    if (chat.type === 'app') return; // Apps are handled statically or in a separate block
    if (chat.type === 'support') return; // Support is handled via the Support Chat shortcut

    const li = document.createElement('li');
    li.className = `section-item ${state.activeChatId === chat.id ? 'active' : ''}`;
    li.setAttribute('data-chat-id', chat.id);

    // Space icon logic vs contact icon
    const iconHtml = chat.type === 'space'
      ? `<i data-lucide="hash"></i>`
      : `<i data-lucide="user"></i>`;

    const isStarred = isChatStarred(chat.id);

    li.innerHTML = `
      <div style="position: relative; display: flex; align-items: center;">
        ${iconHtml}
        ${chat.type === 'dm' ? `<span class="feed-status-dot ${esc(chat.status)}" style="bottom:-2px; right:-2px; width:7px; height:7px; border-width:1px;"></span>` : ''}
      </div>
      <span>${esc(chat.name)}</span>
      <div style="display: flex; align-items: center; gap: 6px; margin-left: auto;">
        ${isStarred ? `<i data-lucide="star" style="width: 12px; height: 12px; fill: var(--primary-yellow); stroke: var(--primary-yellow); flex-shrink: 0;"></i>` : ''}
        ${chat.unreadCount > 0 ? `<span class="unread-badge">${chat.unreadCount}</span>` : ''}
      </div>
    `;

    li.addEventListener('click', () => switchActiveChat(chat.id));

    if (chat.type === 'dm') {
      dmsList.appendChild(li);
      dmsCount++;
    } else if (chat.type === 'space') {
      spacesList.appendChild(li);
      spacesCount++;
    }
  });

  // Toggle empty promo screens
  document.getElementById('dms-empty-promo').style.display = dmsCount === 0 ? 'block' : 'none';
  document.getElementById('spaces-empty-promo').style.display = spacesCount === 0 ? 'block' : 'none';

  lucide.createIcons();
}

// Render the Center Home Chat Previews Feed
function renderHomeFeed(searchQuery = '') {
  const feed = document.getElementById('chats-feed');
  if (!feed) return;

  feed.innerHTML = '';
  const query = searchQuery.toLowerCase();
  const filteredChats = Object.values(state.chats).filter(chat => {
    // If the active shortcut is support, we ONLY show support chats.
    // Otherwise, we hide support chats from all other views.
    if (state.activeShortcut === 'support') {
      if (chat.type !== 'support') return false;
    } else {
      if (chat.type === 'support') return false;
    }

    // Filter by Active Shortcut View
    if (state.activeShortcut === 'mentions') {
      if (!hasMention(chat)) return false;
    } else if (state.activeShortcut === 'starred') {
      if (!isChatStarred(chat.id)) return false;
    }

    // Filter by Unread Toggle
    if (state.showUnreadOnly && chat.unreadCount === 0) return false;

    // Filter by Search Query
    if (query) {
      const matchName = chat.name.toLowerCase().includes(query);
      const matchMsg = chat.lastMessage.toLowerCase().includes(query);
      return matchName || matchMsg;
    }

    return true;
  });

  if (filteredChats.length === 0) {
    let emptyIcon = 'message-square-dashed';
    let emptyMsg = 'No conversations found';
    if (state.activeShortcut === 'mentions') {
      emptyIcon = 'at-sign';
      emptyMsg = 'No mentions of you found in conversations';
    } else if (state.activeShortcut === 'starred') {
      emptyIcon = 'star';
      emptyMsg = 'No starred conversations yet. Star a chat to keep track of it!';
    }

    feed.innerHTML = `
      <div class="empty-feed-state" style="padding:40px 16px; text-align:center; color:var(--text-secondary);">
        <i data-lucide="${emptyIcon}" style="width:36px; height:36px; margin-bottom:10px; color:var(--text-secondary);"></i>
        <p style="font-size:13px;">${emptyMsg}</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  filteredChats.forEach(chat => {
    const item = document.createElement('div');
    item.className = `feed-item ${chat.unreadCount > 0 ? 'unread' : ''} ${state.activeChatId === chat.id ? 'active' : ''}`;

    // Get Avatar Initials
    const initials = chat.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

    // App specific avatar template
    let avatarContent = '';
    if (chat.avatarPhotoURL) {
      avatarContent = `<div class="feed-avatar" style="padding: 0; background: transparent; border: none;"><img src="${esc(chat.avatarPhotoURL)}" referrerpolicy="no-referrer" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;"></div>`;
    } else {
      avatarContent = `<div class="feed-avatar ${esc(chat.avatarColor)}">${esc(initials)}</div>`;
    }

    const isStarred = isChatStarred(chat.id);

    item.innerHTML = `
      <div class="feed-avatar-wrap">
        ${avatarContent}
        ${chat.type === 'dm' ? `<span class="feed-status-dot ${esc(chat.status)}"></span>` : ''}
      </div>
      <div class="feed-item-info">
        <div class="feed-item-header">
          <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
            <span class="feed-item-name">${esc(chat.name)}</span>
            ${isStarred ? `<i data-lucide="star" style="width: 13px; height: 13px; fill: var(--primary-yellow); stroke: var(--primary-yellow); flex-shrink: 0;"></i>` : ''}
          </div>
          <span class="feed-item-time">${esc(chat.lastMessageTime)}</span>
        </div>
        <div class="feed-item-msg-row">
          <span class="feed-item-preview">${esc(chat.lastMessage)}</span>
          ${chat.unreadCount > 0 ? `<span class="unread-badge">${chat.unreadCount}</span>` : ''}
        </div>
      </div>
    `;

    item.addEventListener('click', () => switchActiveChat(chat.id));
    feed.appendChild(item);
  });

  lucide.createIcons();
}

// Render the Active Chat Pane (Right side)
function renderChatActiveWindow(chatId) {
  const chat = state.chats[chatId];
  if (!chat) return;

  // Active Pane display check
  document.getElementById('chat-empty-state').style.display = 'none';
  const activeContainer = document.getElementById('chat-active-container');
  activeContainer.style.display = 'flex';

  // Render Header Details
  document.getElementById('active-chat-title').textContent = chat.name;
  const addMemberBtn = document.getElementById('btn-add-member');
  if (addMemberBtn) addMemberBtn.style.display = chat.type === 'space' ? '' : 'none';

  const statusEl = document.getElementById('active-chat-status');
  if (chat.type === 'space') {
    statusEl.textContent = 'Space • Collaborators sync active';
    document.getElementById('active-chat-badge').style.display = 'none';
  } else if (chat.type === 'support') {
    statusEl.textContent = chat.status === 'open' ? 'Support Ticket • Open' : 'Support Ticket • Resolved';
    document.getElementById('active-chat-badge').style.display = 'inline-block';
    document.getElementById('active-chat-badge').textContent = 'Support';
    document.getElementById('active-chat-badge').style.background = 'linear-gradient(135deg, #ef4444, #b91c1c)';
  } else {
    statusEl.textContent = chat.status === 'online' ? 'Active now' : 'Offline';
    document.getElementById('active-chat-badge').style.display = 'none';
  }

  // Active Chat Avatar
  const chatAvatar = document.getElementById('active-chat-avatar');
  const initials = chat.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

  if (chat.avatarPhotoURL) {
    chatAvatar.innerHTML = `<div class="message-avatar" style="width:36px; height:36px; padding:0; background:transparent; border:none;"><img src="${esc(chat.avatarPhotoURL)}" referrerpolicy="no-referrer" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;"></div>`;
  } else {
    chatAvatar.innerHTML = `<div class="message-avatar ${esc(chat.avatarColor)}" style="width:36px; height:36px; font-size:13px">${esc(initials)}</div>`;
  }

  // Update star button active state
  const starChatBtn = document.getElementById('btn-star-chat');
  if (starChatBtn) {
    const isStarred = isChatStarred(chatId);
    starChatBtn.classList.toggle('starred', isStarred);
    const starIcon = starChatBtn.querySelector('i');
    if (starIcon) {
      if (isStarred) {
        starIcon.style.fill = 'var(--primary-yellow)';
        starIcon.style.stroke = 'var(--primary-yellow)';
      } else {
        starIcon.style.fill = 'none';
        starIcon.style.stroke = 'currentColor';
      }
    }
  }

  // Welcome Banner details
  document.getElementById('banner-title').textContent = chat.name;
  const bannerAvatar = document.getElementById('banner-avatar-icon');

  if (chat.avatarPhotoURL) {
    bannerAvatar.className = 'banner-avatar';
    bannerAvatar.style.padding = '0';
    bannerAvatar.style.background = 'transparent';
    bannerAvatar.style.border = 'none';
    bannerAvatar.innerHTML = `<img src="${esc(chat.avatarPhotoURL)}" referrerpolicy="no-referrer" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
  } else {
    bannerAvatar.className = `banner-avatar ${esc(chat.avatarColor)}`;
    bannerAvatar.removeAttribute('style');
    bannerAvatar.textContent = initials;
  }
  if (chat.type === 'support') {
    document.getElementById('banner-subtitle').textContent = chat.ticketExists
      ? `This is the start of your support conversation with our team.`
      : `Your support ticket is closed. Click the button below to open a ticket.`;
  } else {
    document.getElementById('banner-subtitle').textContent = chat.type === 'space'
      ? `This is the start of the ${chat.name} Space.`
      : `This is the start of your secure direct message with ${chat.name}.`;
  }

  // Message history rendering
  const wrapper = document.getElementById('messages-list-wrapper');
  wrapper.innerHTML = '';

  chat.history.forEach(msg => {
    const container = document.createElement('div');
    container.className = `message-item-container ${msg.isMe ? 'sent' : ''}`;
    container.setAttribute('data-msg-id', msg.id);
    container.setAttribute('data-sender', msg.isMe ? 'You' : msg.senderName);
    container.setAttribute('data-text', msg.text || '');
    container.setAttribute('data-is-me', msg.isMe ? 'true' : 'false');

    const item = document.createElement('div');

    if (msg.isDeleted) {
      item.className = 'message-item system';
      const deleterName = msg.isMe ? getCurrentUserName() : (msg.senderName || 'a member of this conversation');
      item.innerHTML = `<div class="message-deleted">Message deleted by ${esc(deleterName)} <span style="font-size:10px; margin-left:8px; font-style:normal; color:var(--text-secondary);">${esc(msg.time.split(',')[1] || msg.time)}</span></div>`;
      container.appendChild(item);
    } else {
      item.className = `message-item ${msg.isMe ? 'sent' : ''}`;

      const user = auth.currentUser;
      let msgAvatarHtml = '';
      const photoURL = msg.isMe ? (user?.photoURL) : msg.senderPhotoURL;
      if (photoURL) {
        msgAvatarHtml = `<div class="message-avatar" style="padding: 0; background: transparent; border: none;"><img src="${esc(photoURL)}" referrerpolicy="no-referrer" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;"></div>`;
      } else {
        const msgInitials = msg.isMe ? getCurrentUserInitials() : msg.senderName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
        const msgAvatarColor = msg.isMe ? 'yellow' : chat.avatarColor;
        msgAvatarHtml = `<div class="message-avatar ${esc(msgAvatarColor)}">${esc(msgInitials)}</div>`;
      }

      // Rich layout card logic (Calyx Meet updates)
      let cardHtml = '';
      if (msg.richCard) {
        cardHtml = `
          <div class="rich-card">
            <div class="rich-card-header">
              <div class="rich-card-icon"><i data-lucide="${esc(msg.richCard.icon)}"></i></div>
              <span class="rich-card-title">${esc(msg.richCard.title)}</span>
            </div>
            <p class="rich-card-desc">${esc(msg.richCard.desc)}</p>
            <button class="rich-card-btn" onclick="alert('Demo feature: Opening pipeline logs.')">${esc(msg.richCard.btnText)}</button>
          </div>
        `;
      }

      // Quoted Reply UI
      let replyRefHtml = '';
      if (msg.replyTo) {
        const replyMsg = chat.history.find(m => m.id === msg.replyTo);
        const replySender = replyMsg ? (replyMsg.isMe ? 'You' : replyMsg.senderName) : 'Message';
        const replyText = replyMsg ? (replyMsg.isDeleted ? 'Deleted message' : replyMsg.text) : 'Original message';
        replyRefHtml = `
          <div class="message-bubble-reply-ref" data-target-id="${esc(msg.replyTo)}" style="cursor: pointer;">
            <span class="reply-ref-name">${esc(replySender)}</span>
            ${esc(replyText)}
          </div>
        `;
      }

      // Edited badge
      const editedHtml = msg.isEdited ? ` <span class="message-edited-badge" style="font-size:10px; color:var(--text-secondary); margin-left:4px;">(edited)</span>` : '';

      item.innerHTML = `
        <div class="message-avatar-wrap">
          ${msgAvatarHtml}
        </div>
        <div class="message-content-wrap">
          <div class="message-sender-row">
            <span class="message-sender-name">${esc(msg.isMe ? getCurrentUserName() : msg.senderName)}</span>
            <span class="message-time">${esc(msg.time)}</span>
            ${editedHtml}
          </div>
          <div class="message-bubble">
            ${replyRefHtml}
            ${esc(msg.text)}
            ${cardHtml}
          </div>
        </div>
      `;

      // Hover actions for desktop (Reply button before message bubble)
      const hoverActions = document.createElement('div');
      hoverActions.className = 'message-hover-actions';
      hoverActions.innerHTML = `
        <button class="btn-msg-reply" title="Reply">
          <i data-lucide="corner-up-left" style="width:14px; height:14px;"></i>
        </button>
      `;

      const contentWrap = item.querySelector('.message-content-wrap');
      if (contentWrap) {
        contentWrap.appendChild(hoverActions);
      }

      // Swipe reply indicator for mobile
      const swipeIndicator = document.createElement('div');
      swipeIndicator.className = 'swipe-reply-indicator';
      swipeIndicator.innerHTML = `<i data-lucide="corner-up-left" style="width:16px; height:16px;"></i>`;
      item.appendChild(swipeIndicator);

      container.appendChild(item);
    }

    wrapper.appendChild(container);
  });

  // Scroll to bottom of message panel
  const msgContainer = document.getElementById('chat-messages');
  setTimeout(() => {
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }, 50);

  // Toggle bot options, support ticket, or normal input
  const botOptionsWrapper = document.getElementById('bot-options-wrapper');
  const normalChatInputWrapper = document.getElementById('normal-chat-input-wrapper');
  const supportTicketWrapper = document.getElementById('support-ticket-wrapper');
  if (botOptionsWrapper && normalChatInputWrapper && supportTicketWrapper) {
    if (chatId === 'calyx-bot') {
      botOptionsWrapper.style.display = 'block';
      normalChatInputWrapper.style.display = 'none';
      supportTicketWrapper.style.display = 'none';
    } else if (chat.type === 'support' && !chat.ticketExists) {
      botOptionsWrapper.style.display = 'none';
      normalChatInputWrapper.style.display = 'none';
      supportTicketWrapper.style.display = 'block';
    } else {
      botOptionsWrapper.style.display = 'none';
      normalChatInputWrapper.style.display = 'flex';
      supportTicketWrapper.style.display = 'none';
    }
  }

  // Setup textarea placeholder
  const textarea = document.getElementById('message-textarea');
  if (textarea) {
    textarea.placeholder = `History is on - Message ${chat.name}...`;
    textarea.value = '';
    textarea.style.height = 'auto';
  }
  const sendBtn = document.getElementById('btn-send-message');
  if (sendBtn) {
    sendBtn.disabled = true;
  }

  lucide.createIcons();
}

// Handle message switching
function switchActiveChat(chatId) {
  state.activeChatId = chatId;

  // Clear unreads
  if (state.chats[chatId] && state.chats[chatId].unreadCount > 0) {
    state.chats[chatId].unreadCount = 0;
  }

  // Clear previous message listener
  if (messagesListener) {
    messagesListener();
    messagesListener = null;
  }

  renderSidebar();
  renderHomeFeed();
  renderChatActiveWindow(chatId);

  // Setup real-time messages listener if it's a Firestore conversation
  if (chatId !== 'calyx-bot') {
    setupMessagesListener(chatId);
  }
}

// Send Message Handler
function handleSendMessage() {
  const textarea = document.getElementById('message-textarea');
  const text = textarea.value.trim();
  if (!text) return;

  const activeChatId = state.activeChatId;
  const activeChat = state.chats[activeChatId];
  if (!activeChat) return;

  if (state.editingMsg) {
    const msgId = state.editingMsg.id;
    if (activeChatId === 'calyx-bot') {
      const msg = activeChat.history.find(m => m.id === msgId);
      if (msg) {
        msg.text = text;
        msg.isEdited = true;
      }
      renderChatActiveWindow(activeChatId);
    } else {
      editMessageInFirestore(activeChatId, msgId, text);
    }
    cancelInputMode();
  } else {
    const replyToId = state.replyingToMsg ? state.replyingToMsg.id : null;

    if (activeChatId === 'calyx-bot') {
      const now = new Date();
      const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const newMsg = {
        id: 'msg-' + Date.now(),
        senderName: getCurrentUserName(),
        isMe: true,
        text: text,
        time: timeString
      };
      if (replyToId) {
        newMsg.replyTo = replyToId;
      }
      activeChat.history.push(newMsg);

      // Update last message preview
      activeChat.lastMessage = `You: ${text}`;
      activeChat.lastMessageTime = timeString;

      // Render updates
      renderHomeFeed();
      renderChatActiveWindow(activeChatId);

      // Trigger simulated response
      setTimeout(() => {
        simulateBotResponse(activeChatId, text);
      }, 1000);
    } else {
      sendMessageToFirestore(activeChatId, text, replyToId);
    }
    cancelInputMode();
  }

  textarea.value = '';
  textarea.style.height = 'auto';
  document.getElementById('btn-send-message').disabled = true;
}

// Bot responses simulation
function simulateBotResponse(chatId, userText) {
  const chat = state.chats[chatId];
  if (!chat) return;

  const now = new Date();
  const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  let replyText = '';
  let replyCard = null;

  const normText = userText.toLowerCase();

  if (chatId === 'calyx-bot') {
    if (normText.includes('what is calyx chat')) {
      replyText = "Calyx Chat is a state-of-the-art secure platform designed for seamless real-time communication and collaboration. Built with a stunning gold and teal visual language, it supports direct messages, team spaces, and custom integrations while keeping your privacy intact!";
    } else if (normText.includes('support chat') || normText.includes('support ticket')) {
      replyText = "Support chat allows you to create direct support tickets inside Calyx Chat. If you encounter any issues or have questions, you can open a ticket, and our support agents (or helper bots) will assist you right away!";
    } else if (normText.includes('support the developer') || normText.includes('support developer')) {
      replyText = "You can support the developer by sharing Calyx Chat with your team, leaving feedback on GitHub, or checking out ZenSensi's developer profile for sponsorship and contributions. Every bit of support helps us improve the platform!";
    } else if (normText.includes('hello') || normText.includes('hi') || normText.includes('hey')) {
      replyText = `Hello ${getCurrentUserName()}! Great to chat. I am Calyx Intro Bot, developed by Arnabh aka ZenSensi. Click one of the pre-built questions below to learn more about Calyx Chat!`;
    } else if (normText.includes('color') || normText.includes('yellow') || normText.includes('blue') || normText.includes('theme') || normText.includes('palette')) {
      replyText = "Per your configuration, the primary theme color is now a vibrant premium gold/yellow (#fbbf24) combined with Calyx's classic cyan/teal (#00d2ff) accents. The standard blues have been completely replaced!";
    } else if (normText.includes('feature') || normText.includes('chat') || normText.includes('workspace')) {
      replyText = "This Calyx Chat application features a fully responsive 4-column layout: collapsible left sidebar, center home chat feed, active message window, and far-right Google add-on utilities.";
    } else if (normText.includes('meeting') || normText.includes('meet')) {
      replyText = "Calyx Chat focuses purely on real-time secure messaging and team spaces. For video conferences, you can use our companion product, Calyx Meet!";
    } else {
      replyText = `I hear you! You said "${userText}". As an AI built into Calyx Chat, I am here to help you get the most out of your collaborative messaging.`;
    }
  } else {
    // DM or Space reply
    replyText = `Thanks for the message! Since this is a simulated sandbox channel, this message represents an automated collaborator reply to: "${userText}".`;
  }

  // Push message
  chat.history.push({
    id: 'reply-' + Date.now(),
    senderName: chat.name,
    isMe: false,
    text: replyText,
    time: timeString,
    richCard: replyCard
  });

  chat.lastMessage = `${chat.name}: ${replyText}`;
  chat.lastMessageTime = timeString;

  // Sound cue / visual alert
  if (state.activeChatId !== chatId) {
    chat.unreadCount++;
    showToast(`New message from ${chat.name}`);
  }

  renderHomeFeed();
  if (state.activeChatId === chatId) {
    renderChatActiveWindow(chatId);
  }
}


// User status selection
function updateUserStatus(status) {
  state.userStatus = status;
  const statusPill = document.getElementById('status-pill');
  if (!statusPill) return;

  const dot = statusPill.querySelector('.status-dot');
  const text = statusPill.querySelector('.status-text');

  dot.className = `status-dot ${status}`;

  let label = 'Active';
  if (status === 'away') label = 'Away';
  else if (status === 'dnd') label = 'Do not disturb';
  else if (status === 'offline') label = 'Invisible';

  text.textContent = label;
  showToast(`Status updated to: ${label}`);
}

// Theme management
function toggleTheme() {
  state.isDarkMode = !state.isDarkMode;
  updateTheme();
}

function updateTheme() {
  const body = document.body;
  const themeToggle = document.getElementById('theme-toggle');
  if (!themeToggle) return;

  const sunIcon = themeToggle.querySelector('.sun-icon');
  const moonIcon = themeToggle.querySelector('.moon-icon');

  if (state.isDarkMode) {
    body.classList.add('dark');
    sunIcon.style.display = 'block';
    moonIcon.style.display = 'none';
  } else {
    body.classList.remove('dark');
    sunIcon.style.display = 'none';
    moonIcon.style.display = 'block';
  }

  showToast(`Switched to ${state.isDarkMode ? 'Dark' : 'Light'} theme`);
}

// Toast indicator
function showToast(message) {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toast-message');
  if (!toast || !msgEl) return;

  msgEl.textContent = message;
  toast.style.display = 'flex';

  // Animate out
  if (window.toastTimeout) clearTimeout(window.toastTimeout);
  window.toastTimeout = setTimeout(() => {
    toast.style.display = 'none';
  }, 2500);
}

// Setup Real-Time Listeners for Conversations
function setupRealtimeListeners() {
  const user = auth.currentUser;
  if (!user) return;

  const conversationsQuery = query(
    collection(db, 'chat_conversations'),
    where('participants', 'array-contains', user.uid)
  );

  conversationsListener = onSnapshot(conversationsQuery, (snapshot) => {
    const newChats = {};

    // Safely copy or initialize Calyx Bot config
    if (state.chats && state.chats['calyx-bot']) {
      newChats['calyx-bot'] = state.chats['calyx-bot'];
    } else {
      newChats['calyx-bot'] = {
        id: 'calyx-bot',
        type: 'app',
        name: 'Calyx Intro Bot',
        lastMessage: 'Welcome to Calyx Chat! How can I help you today?',
        lastMessageTime: 'Now',
        unreadCount: 0,
        avatarColor: 'yellow',
        status: 'online',
        history: [
          {
            id: 'cb1',
            senderName: 'Calyx Intro Bot',
            isMe: false,
            text: 'Hey there! I am the Calyx Intro Bot. I am developed by Arnabh aka ZenSensi',
            time: '12:44 PM'
          },
          {
            id: 'cb2',
            senderName: 'Calyx Intro Bot',
            isMe: false,
            text: 'Welcome to Calyx Chat! Calyx chat is a platform for seamless communication and collaboration. It is a place where you can connect with your friends, family, and colleagues in real-time, without sharing any personal information.',
            time: '12:45 PM'
          }
        ]
      };
    }
    // Preserve optimistic support chat if it exists in state
    const supportId = `support_${user.uid}`;
    if (state.chats && state.chats[supportId]) {
      newChats[supportId] = state.chats[supportId];
    }

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const isDM = data.type === 'dm';
      let chatName = data.name;
      let avatarColor = data.avatarColor || 'yellow';

      let avatarPhotoURL = null;
      if (isDM) {
        const otherUid = data.participants.find(p => p !== user.uid);
        const otherDetails = data.participantDetails?.[otherUid] || {};
        chatName = otherDetails.displayName || otherDetails.email?.split('@')[0] || 'Unknown User';
        avatarColor = otherDetails.avatarColor || 'yellow';
        avatarPhotoURL = otherDetails.photoURL || null;
      }

      const lastMsgTime = formatTimestamp(data.lastMessageTime);

      newChats[docSnap.id] = {
        id: docSnap.id,
        type: data.type,
        name: chatName,
        avatarColor: avatarColor,
        avatarPhotoURL: avatarPhotoURL,
        lastMessage: data.lastMessage || (data.type === 'space' ? 'Space created' : 'Conversation started'),
        lastMessageTime: lastMsgTime,
        unreadCount: 0,
        status: data.status || (isDM ? 'online' : 'offline'),
        participants: data.participants || [],
        ticketExists: true, // doc exists, so a support ticket exists (support UI reads this)
        history: state.chats[docSnap.id]?.history || []
      };
    });

    state.chats = newChats;
    renderSidebar();
    renderHomeFeed();

    if (state.activeChatId && state.chats[state.activeChatId]) {
      renderChatActiveWindow(state.activeChatId);
    }
  }, (error) => {
    console.error("Conversations listener error:", error);
  });
}

// Setup Real-Time Messages Listener
function setupMessagesListener(chatId) {
  const messagesQuery = query(
    collection(db, `chat_conversations/${chatId}/messages`),
    orderBy('time', 'asc')
  );

  messagesListener = onSnapshot(messagesQuery, (snapshot) => {
    const chat = state.chats[chatId];
    if (!chat) return;

    chat.history = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const timeString = formatTimestamp(data.time);

      chat.history.push({
        id: docSnap.id,
        senderName: data.senderName,
        isMe: data.senderUid === auth.currentUser?.uid,
        senderPhotoURL: data.senderPhotoURL || null,
        text: data.text,
        time: timeString,
        isDeleted: data.isDeleted || false,
        isEdited: data.isEdited || false,
        replyTo: data.replyTo || null
      });
    });

    if (state.activeChatId === chatId) {
      renderChatActiveWindow(chatId);
    }
  }, (error) => {
    console.error("Messages listener error:", error);
  });
}

// Add a user to a space; they see it via their participants listener. Returns true on success.
async function addMemberToSpace(spaceId, targetUser) {
  const myUser = auth.currentUser;
  if (!myUser) return false;
  const name = targetUser.displayName || targetUser.email?.split('@')[0] || 'Someone';
  try {
    await updateDoc(doc(db, 'chat_conversations', spaceId), {
      participants: arrayUnion(targetUser.uid),
      [`participantDetails.${targetUser.uid}`]: {
        displayName: name,
        email: targetUser.email || null,
        photoURL: targetUser.photoURL || null,
        avatarColor: targetUser.avatarColor || 'teal'
      },
      lastMessage: `${getCurrentUserName()} added ${name}`,
      lastMessageTime: serverTimestamp()
    });
    showToast(`Added ${name} to the space`);
    return true;
  } catch (err) {
    console.error('Error adding member:', err);
    showToast('Failed to add member.');
    return false;
  }
}

// Search the user directory by name/email, skipping me and anyone in `excludeUids`
async function findUsers(queryText, excludeUids = []) {
  const queryVal = queryText.trim().toLowerCase();
  const skip = new Set([auth.currentUser?.uid, ...excludeUids]);
  const usersSnap = await getDocs(collection(db, 'users'));
  return usersSnap.docs.map(d => d.data()).filter(u =>
    !skip.has(u.uid) && (
      !queryVal ||
      u.displayName?.toLowerCase().includes(queryVal) ||
      u.email?.toLowerCase().includes(queryVal)
    )
  );
}

// Render User Directory Search Results
function renderSearchResults(matches, dropdownId = 'search-results-dropdown', onPick = startDirectMessage) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;

  dropdown.innerHTML = '';
  if (matches.length === 0) {
    dropdown.innerHTML = '<div style="padding: 10px; font-size:12px; color:var(--text-secondary); text-align:center;">No users found</div>';
    dropdown.style.display = 'block';
    return;
  }

  matches.forEach(user => {
    const item = document.createElement('div');
    item.className = 'search-result-item';

    const initials = user.displayName
      ? user.displayName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
      : user.email.slice(0, 2).toUpperCase();

    let avatarHtml = '';
    if (user.photoURL) {
      avatarHtml = `<div class="search-result-avatar" style="padding: 0; background: transparent; border: none;"><img src="${esc(user.photoURL)}" referrerpolicy="no-referrer" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;"></div>`;
    } else {
      avatarHtml = `<div class="search-result-avatar ${esc(user.avatarColor || 'teal')}">${esc(initials)}</div>`;
    }

    item.innerHTML = `
      ${avatarHtml}
      <div class="search-result-info">
        <span class="search-result-name">${esc(user.displayName)}</span>
        <span class="search-result-email">${esc(user.email)}</span>
      </div>
    `;

    item.addEventListener('click', () => {
      onPick(user);
    });

    dropdown.appendChild(item);
  });

  dropdown.style.display = 'block';
}

// Start a direct message with a user
async function startDirectMessage(targetUser) {
  const myUser = auth.currentUser;
  if (!myUser) return;

  const dmId = `dm_${[myUser.uid, targetUser.uid].sort().join('_')}`;

  // Close modal and reset search dropdown
  const newChatModal = document.getElementById('new-chat-modal');
  if (newChatModal) newChatModal.style.display = 'none';

  const newChatForm = document.getElementById('new-chat-form');
  if (newChatForm) newChatForm.reset();

  const searchDropdown = document.getElementById('search-results-dropdown');
  if (searchDropdown) searchDropdown.style.display = 'none';

  try {
    const docRef = doc(db, 'chat_conversations', dmId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      await setDoc(docRef, {
        id: dmId,
        type: 'dm',
        participants: [myUser.uid, targetUser.uid],
        participantDetails: {
          [myUser.uid]: {
            displayName: myUser.displayName || myUser.email.split('@')[0],
            email: myUser.email,
            photoURL: myUser.photoURL || null,
            avatarColor: 'yellow'
          },
          [targetUser.uid]: {
            displayName: targetUser.displayName,
            email: targetUser.email,
            photoURL: targetUser.photoURL || null,
            avatarColor: targetUser.avatarColor || 'teal'
          }
        },
        lastMessage: 'Conversation started',
        lastMessageTime: serverTimestamp(),
        createdTime: serverTimestamp()
      });
    }

    switchActiveChat(dmId);
    showToast(`Chat started with ${targetUser.displayName}`);
  } catch (err) {
    console.error("Error starting direct message:", err);
    showToast("Failed to start chat.");
  }
}

// Send Message to Firestore Database
async function sendMessageToFirestore(conversationId, text, replyTo = null) {
  const myUser = auth.currentUser;
  if (!myUser) return;

  try {
    const messagesColl = collection(db, `chat_conversations/${conversationId}/messages`);
    const messageObj = {
      senderUid: myUser.uid,
      senderName: myUser.displayName || myUser.email.split('@')[0],
      senderPhotoURL: myUser.photoURL || null,
      text: text,
      time: serverTimestamp()
    };
    if (replyTo) {
      messageObj.replyTo = replyTo;
    }
    await addDoc(messagesColl, messageObj);

    const convDocRef = doc(db, 'chat_conversations', conversationId);
    const updateData = {
      lastMessage: `${myUser.displayName || myUser.email.split('@')[0]}: ${text}`,
      lastMessageTime: serverTimestamp()
    };

    // If it's a support chat, ensure the parent document has the required fields
    if (conversationId.startsWith('support_')) {
      updateData.type = 'support';
      updateData.name = 'Support Chat';
      updateData.avatarColor = 'teal';
      updateData.status = 'open'; // Force status to 'open' when client sends a message
      updateData.participants = [myUser.uid, 'support-admin'];
      updateData.participantDetails = {
        [myUser.uid]: {
          displayName: myUser.displayName || myUser.email.split('@')[0],
          email: myUser.email,
          avatarColor: 'teal'
        }
      };
    }

    await setDoc(convDocRef, updateData, { merge: true });
  } catch (err) {
    console.error("Error sending message to Firestore:", err);
    showToast("Failed to send message.");
  }
}

