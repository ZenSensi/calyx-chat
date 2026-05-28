
// Calyx Chat Application Logic
import { auth } from './firebase.js';

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

// Initial Application State
const state = {
  activeChatId: 'calyx-bot', // Default chat
  userStatus: 'active',  // active, away, dnd, offline
  isDarkMode: true,      // Default dark mode
  showUnreadOnly: false,
  collapsedSidebar: false,
  collapsedUtility: false,
  chats: {
    'calyx-bot': {
      id: 'calyx-bot',
      type: 'dm',
      name: 'Calyx AI Bot',
      avatarColor: 'yellow',
      lastMessage: 'Welcome to Calyx Chat! How can I help you today?',
      lastMessageTime: '12:45 PM',
      unreadCount: 1,
      status: 'online',
      history: [
        {
          id: 'cb1',
          senderName: 'Calyx AI Bot',
          isMe: false,
          text: 'Hey there! I am the Calyx Assistant. I have been styled with the premium Calyx Sigma design language, complete with gold and teal glows.',
          time: '12:44 PM'
        },
        {
          id: 'cb2',
          senderName: 'Calyx AI Bot',
          isMe: false,
          text: 'Welcome to Calyx Chat! Ask me about Calyx Meet, our new colors, or type a request to test my interactive chat capabilities.',
          time: '12:45 PM'
        }
      ]
    },
    'support-team': {
      id: 'support-team',
      type: 'space',
      name: 'Support Team Space',
      avatarColor: 'teal',
      lastMessage: 'John: We updated the deployment plan.',
      lastMessageTime: 'Yesterday',
      unreadCount: 0,
      status: 'online',
      history: [
        {
          id: 'st1',
          senderName: 'Sarah',
          isMe: false,
          text: 'Welcome to the Calyx Support channel! Let us know if you run into any issues.',
          time: 'Yesterday, 9:30 AM'
        },
        {
          id: 'st2',
          senderName: 'John',
          isMe: false,
          text: 'We updated the deployment plan. Check it out here!',
          time: 'Yesterday, 4:12 PM',
          richCard: {
            title: 'Deployment Plan Update',
            desc: 'Staging deployment workflow completed successfully. Check the pipeline logs for details.',
            icon: 'sparkles',
            btnText: 'View Pipeline'
          }
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

  // New Chat Modal Triggers
  const newChatBtns = document.querySelectorAll('.trigger-new-chat, #btn-new-chat');
  const newChatModal = document.getElementById('new-chat-modal');
  const modalClose = document.getElementById('modal-close');
  const modalCancel = document.getElementById('btn-modal-cancel');
  const newChatForm = document.getElementById('new-chat-form');

  newChatBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      newChatModal.style.display = 'flex';
      document.getElementById('new-chat-name').focus();
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
    const searchDropdown = document.getElementById('search-results-dropdown');
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
      const nameInput = document.getElementById('new-chat-name');
      const labelName = document.getElementById('label-chat-name');
      const searchDropdown = document.getElementById('search-results-dropdown');
      if (radio.value === 'space') {
        nameInput.placeholder = 'e.g. Design Sync, Marketing Campaign...';
        labelName.textContent = 'Space Name';
        if (searchDropdown) searchDropdown.style.display = 'none';
      } else {
        nameInput.placeholder = 'e.g. John Doe...';
        labelName.textContent = 'Contact Name';
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
  const nameInput = document.getElementById('new-chat-name');
  const searchDropdown = document.getElementById('search-results-dropdown');
  if (nameInput && searchDropdown) {
    nameInput.addEventListener('input', async () => {
      const queryVal = nameInput.value.trim().toLowerCase();
      const typeRadio = newChatForm.querySelector('input[name="chat-type"]:checked');
      const type = typeRadio ? typeRadio.value : 'dm';

      if (type !== 'dm' || queryVal.length < 1) {
        searchDropdown.style.display = 'none';
        return;
      }

      try {
        const usersSnap = await getDocs(collection(db, 'users'));
        const matches = [];
        const myUid = auth.currentUser?.uid;

        usersSnap.forEach(docSnap => {
          const u = docSnap.data();
          if (u.uid === myUid) return;

          const nameMatch = u.displayName?.toLowerCase().includes(queryVal);
          const emailMatch = u.email?.toLowerCase().includes(queryVal);

          if (nameMatch || emailMatch) {
            matches.push(u);
          }
        });

        renderSearchResults(matches);
      } catch (err) {
        console.error("Error querying users collection:", err);
      }
    });

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
}

// Render the Left Sidebar Lists
function renderSidebar() {
  const dmsList = document.getElementById('dms-list');
  const spacesList = document.getElementById('spaces-list');
  if (!dmsList || !spacesList) return;

  dmsList.innerHTML = '';
  spacesList.innerHTML = '';

  let dmsCount = 0;
  let spacesCount = 0;

  Object.values(state.chats).forEach(chat => {
    if (chat.type === 'app') return; // Apps are handled statically or in a separate block

    const li = document.createElement('li');
    li.className = `section-item ${state.activeChatId === chat.id ? 'active' : ''}`;
    li.setAttribute('data-chat-id', chat.id);

    // Status dot logic for DMs
    let statusDotHtml = '';
    if (chat.type === 'dm') {
      statusDotHtml = `<span class="status-dot ${chat.status}"></span>`;
    }

    // Space icon logic vs contact icon
    const iconHtml = chat.type === 'space'
      ? `<i data-lucide="hash"></i>`
      : `<i data-lucide="user"></i>`;

    li.innerHTML = `
      <div style="position: relative; display: flex; align-items: center;">
        ${iconHtml}
        ${chat.type === 'dm' ? `<span class="feed-status-dot ${chat.status}" style="bottom:-2px; right:-2px; width:7px; height:7px; border-width:1px;"></span>` : ''}
      </div>
      <span>${chat.name}</span>
      ${chat.unreadCount > 0 ? `<span class="unread-badge" style="margin-left:auto">${chat.unreadCount}</span>` : ''}
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
    feed.innerHTML = `
      <div class="empty-feed-state" style="padding:40px 16px; text-align:center; color:var(--text-secondary);">
        <i data-lucide="message-square-dashed" style="width:36px; height:36px; margin-bottom:10px; color:var(--text-secondary);"></i>
        <p style="font-size:13px;">No conversations found</p>
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
    let avatarContent = `<div class="feed-avatar ${chat.avatarColor}">${initials}</div>`;

    item.innerHTML = `
      <div class="feed-avatar-wrap">
        ${avatarContent}
        ${chat.type === 'dm' ? `<span class="feed-status-dot ${chat.status}"></span>` : ''}
      </div>
      <div class="feed-item-info">
        <div class="feed-item-header">
          <span class="feed-item-name">${chat.name}</span>
          <span class="feed-item-time">${chat.lastMessageTime}</span>
        </div>
        <div class="feed-item-msg-row">
          <span class="feed-item-preview">${chat.lastMessage}</span>
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

  const statusEl = document.getElementById('active-chat-status');
  if (chat.type === 'space') {
    statusEl.textContent = 'Space • Collaborators sync active';
    document.getElementById('active-chat-badge').style.display = 'none';
  } else {
    statusEl.textContent = chat.status === 'online' ? 'Active now' : 'Offline';
    document.getElementById('active-chat-badge').style.display = 'none';
  }

  // Active Chat Avatar
  const chatAvatar = document.getElementById('active-chat-avatar');
  const initials = chat.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

  chatAvatar.innerHTML = `<div class="message-avatar ${chat.avatarColor}" style="width:36px; height:36px; font-size:13px">${initials}</div>`;

  // Welcome Banner details
  document.getElementById('banner-title').textContent = chat.name;
  const bannerAvatar = document.getElementById('banner-avatar-icon');

  bannerAvatar.className = `banner-avatar ${chat.avatarColor}`;
  bannerAvatar.innerHTML = initials;
  document.getElementById('banner-subtitle').textContent = chat.type === 'space'
    ? `This is the start of the ${chat.name} Space. Created by Sarah.`
    : `This is the start of your secure direct message with ${chat.name}.`;

  // Message history rendering
  const wrapper = document.getElementById('messages-list-wrapper');
  wrapper.innerHTML = '';

  chat.history.forEach(msg => {
    const item = document.createElement('div');

    if (msg.isDeleted) {
      item.className = 'message-item system';
      item.innerHTML = `<div class="message-deleted">Message deleted by a member of this conversation <span style="font-size:10px; margin-left:8px; font-style:normal; color:var(--text-secondary);">${msg.time.split(',')[1] || msg.time}</span></div>`;
    } else {
      item.className = `message-item ${msg.isMe ? 'sent' : ''}`;

      const msgInitials = msg.isMe ? getCurrentUserInitials() : msg.senderName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
      const msgAvatarColor = msg.isMe ? 'yellow' : chat.avatarColor;

      let msgAvatarHtml = `<div class="message-avatar ${msgAvatarColor}">${msgInitials}</div>`;

      // Rich layout card logic (Calyx Meet updates)
      let cardHtml = '';
      if (msg.richCard) {
        cardHtml = `
          <div class="rich-card">
            <div class="rich-card-header">
              <div class="rich-card-icon"><i data-lucide="${msg.richCard.icon}"></i></div>
              <span class="rich-card-title">${msg.richCard.title}</span>
            </div>
            <p class="rich-card-desc">${msg.richCard.desc}</p>
            <button class="rich-card-btn" onclick="alert('Demo feature: Opening pipeline logs.')">${msg.richCard.btnText}</button>
          </div>
        `;
      }

      item.innerHTML = `
        <div class="message-avatar-wrap">
          ${msgAvatarHtml}
        </div>
        <div class="message-content-wrap">
          <div class="message-sender-row">
            <span class="message-sender-name">${msg.isMe ? getCurrentUserName() : msg.senderName}</span>
            <span class="message-time">${msg.time}</span>
          </div>
          <div class="message-bubble">
            ${msg.text}
            ${cardHtml}
          </div>
        </div>
      `;
    }

    wrapper.appendChild(item);
  });

  // Scroll to bottom of message panel
  const msgContainer = document.getElementById('chat-messages');
  setTimeout(() => {
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }, 50);

  // Setup textarea placeholder
  const textarea = document.getElementById('message-textarea');
  textarea.placeholder = `History is on - Message ${chat.name}...`;
  textarea.value = '';
  textarea.style.height = 'auto';
  document.getElementById('btn-send-message').disabled = true;

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

  if (activeChatId === 'calyx-bot') {
    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Add user message to history
    activeChat.history.push({
      id: 'msg-' + Date.now(),
      senderName: getCurrentUserName(),
      isMe: true,
      text: text,
      time: timeString
    });

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
    // Send to Firestore
    sendMessageToFirestore(activeChatId, text);
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
    if (normText.includes('hello') || normText.includes('hi') || normText.includes('hey')) {
      replyText = `Hello ${getCurrentUserName()}! Great to chat. I am fully customized with the yellow and teal Calyx Sigma styling. Try asking me about 'colors' or 'features'!`;
    } else if (normText.includes('color') || normText.includes('yellow') || normText.includes('blue')) {
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
    const newChats = {
      'calyx-bot': state.chats['calyx-bot']
    };

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const isDM = data.type === 'dm';
      let chatName = data.name;
      let avatarColor = data.avatarColor || 'yellow';

      if (isDM) {
        const otherUid = data.participants.find(p => p !== user.uid);
        const otherDetails = data.participantDetails?.[otherUid] || {};
        chatName = otherDetails.displayName || otherDetails.email?.split('@')[0] || 'Unknown User';
        avatarColor = otherDetails.avatarColor || 'yellow';
      }

      let lastMsgTime = 'Now';
      if (data.lastMessageTime) {
        const date = data.lastMessageTime.toDate ? data.lastMessageTime.toDate() : new Date(data.lastMessageTime);
        lastMsgTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      newChats[docSnap.id] = {
        id: docSnap.id,
        type: data.type,
        name: chatName,
        avatarColor: avatarColor,
        lastMessage: data.lastMessage || (data.type === 'space' ? 'Space created' : 'Conversation started'),
        lastMessageTime: lastMsgTime,
        unreadCount: 0,
        status: isDM ? 'online' : 'offline',
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
      let timeString = 'Now';
      if (data.time) {
        const date = data.time.toDate ? data.time.toDate() : new Date(data.time);
        timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      chat.history.push({
        id: docSnap.id,
        senderName: data.senderName,
        isMe: data.senderUid === auth.currentUser?.uid,
        text: data.text,
        time: timeString
      });
    });

    if (state.activeChatId === chatId) {
      renderChatActiveWindow(chatId);
    }
  }, (error) => {
    console.error("Messages listener error:", error);
  });
}

// Render User Directory Search Results
function renderSearchResults(matches) {
  const dropdown = document.getElementById('search-results-dropdown');
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

    item.innerHTML = `
      <div class="search-result-avatar ${user.avatarColor || 'teal'}">${initials}</div>
      <div class="search-result-info">
        <span class="search-result-name">${user.displayName}</span>
        <span class="search-result-email">${user.email}</span>
      </div>
    `;

    item.addEventListener('click', () => {
      startDirectMessage(user);
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
            avatarColor: 'yellow'
          },
          [targetUser.uid]: {
            displayName: targetUser.displayName,
            email: targetUser.email,
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
async function sendMessageToFirestore(conversationId, text) {
  const myUser = auth.currentUser;
  if (!myUser) return;

  try {
    const messagesColl = collection(db, `chat_conversations/${conversationId}/messages`);
    await addDoc(messagesColl, {
      senderUid: myUser.uid,
      senderName: myUser.displayName || myUser.email.split('@')[0],
      text: text,
      time: serverTimestamp()
    });

    const convDocRef = doc(db, 'chat_conversations', conversationId);
    await setDoc(convDocRef, {
      lastMessage: `${myUser.displayName || myUser.email.split('@')[0]}: ${text}`,
      lastMessageTime: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.error("Error sending message to Firestore:", err);
    showToast("Failed to send message.");
  }
}

