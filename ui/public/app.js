// ==============================================================================
// Mattermost Agent — High-Agency Anti-Slop Frontend Controller (Taste Skill)
// ==============================================================================

const state = {
  authenticated: false,
  isLoggingIn: false,
  user: null,
  channels: [],
  currentChannel: 'town-square',
  messages: [],
  threads: [],
  cronJobs: [],
  activeCodeLang: 'curl',
  theme: 'dark',
  currentChatView: 'chat', // 'chat' or 'threads'
};

// --- Lifecycle Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNavigation();
  initKeyboardShortcuts();
  initSSE();
  fetchStatus();
  fetchChannels();
  fetchCronJobs();
  initForms();
  initChatView();
  initCronModal();
  initApiPlayground();
});

// --- Theme Management ---
function initTheme() {
  const savedTheme = localStorage.getItem('mm_agent_theme') || 'dark';
  setTheme(savedTheme);

  document.getElementById('btn-theme-toggle').addEventListener('click', () => {
    const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
  });
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('mm_agent_theme', theme);
}

// --- Navigation Tabs & Deep Links ---
function initNavigation() {
  const navButtons = document.querySelectorAll('.nav-button');
  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  if (window.location.hash) {
    const hashTab = window.location.hash.replace('#', '');
    if (document.getElementById(`view-${hashTab}`)) {
      switchTab(hashTab);
    }
  }
}

function switchTab(tabId) {
  document.querySelectorAll('.nav-button').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });

  document.querySelectorAll('.view-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `view-${tabId}`);
  });

  window.location.hash = tabId;

  if (tabId === 'channels') {
    loadChannelContent(state.currentChannel);
  } else if (tabId === 'cron') {
    fetchCronJobs();
  }
}

function initKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    // Switch tabs with numbers 1..5 if not focused in an input
    const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (!isInput && !e.metaKey && !e.ctrlKey) {
      if (e.key === '1') switchTab('overview');
      if (e.key === '2') switchTab('channels');
      if (e.key === '3') switchTab('cron');
      if (e.key === '4') switchTab('api');
      if (e.key === '5') switchTab('logs');
    }

    if (e.key === 'Escape') {
      const modal = document.getElementById('modal-cron');
      if (modal && modal.style.display !== 'none') {
        modal.style.display = 'none';
      }
    }
  });
}

// --- Server-Sent Events (SSE) Stream ---
function initSSE() {
  const eventSource = new EventSource('/api/events');

  eventSource.addEventListener('auth:starting', (e) => {
    const data = JSON.parse(e.data);
    addLog(`[AUTH] ${data.message}`, 'log-system');
    updateConnectionBadge('logging-in', 'Opening Browser...');
  });

  eventSource.addEventListener('auth:success', (e) => {
    const data = JSON.parse(e.data);
    addLog(`[AUTH] Authenticated as @${data.username}`, 'log-sent');
    showToast(data.message);
    fetchStatus();
    fetchChannels();
  });

  eventSource.addEventListener('auth:failed', (e) => {
    const data = JSON.parse(e.data);
    addLog(`[ERROR] Auth failed: ${data.message}`, 'log-error');
    showToast(`Authentication failed: ${data.message}`);
    fetchStatus();
  });

  eventSource.addEventListener('message:sent', (e) => {
    const data = JSON.parse(e.data);
    addLog(`[MSG] #${data.channel}: "${data.message.slice(0, 35)}"`, 'log-sent');
    if (state.currentChannel === data.channel) {
      loadChannelContent(state.currentChannel);
    }
  });

  eventSource.addEventListener('message:replied', (e) => {
    const data = JSON.parse(e.data);
    addLog(`[REPLY] #${data.channel} [${data.rootId}]: "${data.message.slice(0, 35)}"`, 'log-sent');
    if (state.currentChannel === data.channel) {
      loadChannelContent(state.currentChannel);
    }
  });

  eventSource.addEventListener('cron:executed', (e) => {
    const data = JSON.parse(e.data);
    addLog(`[CRON] Scheduled job '${data.jobName}' executed`, 'log-sent');
    fetchCronJobs();
  });

  eventSource.addEventListener('cron:saved', (e) => {
    const data = JSON.parse(e.data);
    addLog(`[CONFIG] Cron job '${data.jobName}' updated`, 'log-system');
    fetchCronJobs();
  });
}

// --- Status & Authentication ---
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    state.authenticated = data.authenticated;
    state.isLoggingIn = data.isLoggingIn;
    state.user = data.user;

    const userAvatar = document.getElementById('user-avatar');
    const userDisplayName = document.getElementById('user-display-name');
    const userHandle = document.getElementById('user-handle');
    const metricUsername = document.getElementById('metric-username');
    const metricRoles = document.getElementById('metric-roles');
    const metricProvider = document.getElementById('metric-provider');
    const metricServerUrl = document.getElementById('metric-server-url');

    metricProvider.textContent = data.provider || 'playwright';
    metricServerUrl.textContent = data.mattermostUrl || '-';

    if (data.authenticated && data.user) {
      updateConnectionBadge('connected', `@${data.user.username}`);
      const initials = (data.user.firstName?.[0] || data.user.username[0] || 'U').toUpperCase();
      userAvatar.textContent = initials;
      userDisplayName.textContent = `${data.user.firstName || ''} ${data.user.lastName || ''}`.trim() || data.user.username;
      userHandle.textContent = `@${data.user.username}`;
      metricUsername.textContent = `@${data.user.username}`;
      metricRoles.textContent = data.user.roles || 'system_user';
    } else if (data.isLoggingIn) {
      updateConnectionBadge('logging-in', 'Authenticating in browser...');
      userAvatar.textContent = '...';
      userDisplayName.textContent = 'Authenticating';
      userHandle.textContent = 'Complete in Playwright';
      metricUsername.textContent = 'Logging In...';
    } else {
      updateConnectionBadge('disconnected', 'Disconnected');
      userAvatar.textContent = '?';
      userDisplayName.textContent = 'Not Authenticated';
      userHandle.textContent = '@offline';
      metricUsername.textContent = 'Disconnected';
      metricRoles.textContent = 'Click 1-Click Login';
    }
  } catch (err) {
    updateConnectionBadge('disconnected', 'Server Offline');
  }
}

function updateConnectionBadge(status, text) {
  const badge = document.getElementById('connection-badge');
  const badgeText = document.getElementById('connection-text');
  badge.className = `status-indicator-pill status-${status}`;
  badgeText.textContent = text;
}

// 1-Click Auto Login Action
document.getElementById('btn-auto-login').addEventListener('click', async () => {
  showToast('Launching interactive Playwright browser window...');
  updateConnectionBadge('logging-in', 'Opening Browser...');

  try {
    const res = await fetch('/api/auth/login', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message);
      addLog('[AUTH] Interactive browser window opened.', 'log-system');
    } else {
      showToast(data.message || 'Login request rejected');
    }
  } catch {
    showToast('Failed to connect to login endpoint');
  }
});

// --- Channels Management ---
async function fetchChannels() {
  try {
    const res = await fetch('/api/channels');
    const data = await res.json();
    state.channels = data.channels || [];

    document.getElementById('metric-channels-count').textContent = state.channels.length;
    const enabledCount = state.channels.filter((c) => c.enabled).length;
    document.getElementById('metric-channels-enabled').textContent = `${enabledCount} enabled`;

    populateChannelSelects();
    renderChannelList();
  } catch (err) {
    console.error('Failed to load channels:', err);
  }
}

function populateChannelSelects() {
  const selects = [
    document.getElementById('quick-send-channel'),
    document.getElementById('cron-modal-channel'),
  ];

  selects.forEach((select) => {
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '';

    state.channels.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.alias || c.channel;
      opt.textContent = `#${c.alias} (${c.displayName || c.channel})`;
      if (c.alias === currentVal || (!currentVal && c.alias === 'town-square')) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  });

  renderApiParams();
}

function renderChannelList() {
  const container = document.getElementById('channels-list');
  const searchInput = document.getElementById('channel-search-input');
  const query = searchInput.value.toLowerCase();

  const filtered = state.channels.filter(
    (c) =>
      c.alias.toLowerCase().includes(query) ||
      c.channel.toLowerCase().includes(query) ||
      (c.displayName && c.displayName.toLowerCase().includes(query))
  );

  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">No matching channels.</div>';
    return;
  }

  filtered.forEach((c) => {
    const item = document.createElement('div');
    item.className = `channel-row-item ${c.alias === state.currentChannel ? 'active' : ''}`;
    const dotClass = c.enabled ? 'channel-dot-enabled' : 'channel-dot-disabled';
    item.innerHTML = `
      <div style="display:flex;align-items:center;min-width:0;">
        <span class="channel-status-dot ${dotClass}"></span>
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">#${c.alias}</span>
      </div>
      <span style="font-size:0.68rem;color:var(--text-muted);">${c.displayName ? c.displayName.slice(0, 14) : ''}</span>
    `;
    item.addEventListener('click', () => {
      state.currentChannel = c.alias;
      renderChannelList();
      loadChannelContent(c.alias);
    });
    container.appendChild(item);
  });
}

document.getElementById('channel-search-input').addEventListener('input', renderChannelList);

document.getElementById('btn-sync-channels').addEventListener('click', async () => {
  showToast('Syncing channels from Mattermost server...');
  try {
    const res = await fetch('/api/channels/sync', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast(`Synced ${data.data.totalDiscovered} channels.`);
      fetchChannels();
    }
  } catch {
    showToast('Failed to sync channels');
  }
});

// --- Chat & Thread Explorer ---
function initChatView() {
  const btnChat = document.getElementById('btn-view-chat');
  const btnThreads = document.getElementById('btn-view-threads');
  const chatContainer = document.getElementById('chat-messages-container');
  const threadsContainer = document.getElementById('threads-container');

  btnChat.addEventListener('click', () => {
    state.currentChatView = 'chat';
    btnChat.classList.add('active');
    btnThreads.classList.remove('active');
    chatContainer.style.display = 'flex';
    threadsContainer.style.display = 'none';
    loadChannelMessages(state.currentChannel);
  });

  btnThreads.addEventListener('click', () => {
    state.currentChatView = 'threads';
    btnThreads.classList.add('active');
    btnChat.classList.remove('active');
    chatContainer.style.display = 'none';
    threadsContainer.style.display = 'flex';
    loadChannelThreads(state.currentChannel);
  });

  document.getElementById('btn-refresh-chat').addEventListener('click', () => {
    loadChannelContent(state.currentChannel);
  });

  document.getElementById('chat-search-input').addEventListener('input', () => {
    if (state.currentChatView === 'chat') {
      renderChatBubbles();
    } else {
      renderThreadCards();
    }
  });

  document.getElementById('btn-cancel-thread-reply').addEventListener('click', () => {
    document.getElementById('chat-target-root-id').value = '';
    document.getElementById('thread-reply-indicator').style.display = 'none';
  });

  // Enter to send, Shift+Enter for newline
  const chatInput = document.getElementById('chat-input-message');
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('form-chat-send').dispatchEvent(new Event('submit'));
    }
  });

  // Chat send form
  document.getElementById('form-chat-send').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rootId = document.getElementById('chat-target-root-id').value;
    const message = document.getElementById('chat-input-message').value.trim();
    const from = document.getElementById('chat-input-from').value.trim();

    if (!message) return;

    try {
      let res;
      if (rootId) {
        res = await fetch('/api/messages/reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: state.currentChannel, rootId, message, from }),
        });
      } else {
        res = await fetch('/api/messages/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: state.currentChannel, message, from }),
        });
      }

      const data = await res.json();
      if (res.ok) {
        showToast(rootId ? 'Thread reply dispatched.' : 'Message dispatched.');
        document.getElementById('chat-input-message').value = '';
        document.getElementById('chat-target-root-id').value = '';
        document.getElementById('thread-reply-indicator').style.display = 'none';
        loadChannelContent(state.currentChannel);
      } else {
        showToast(`Send failed: ${data.error}`);
      }
    } catch {
      showToast('Network error while dispatching message.');
    }
  });
}

function loadChannelContent(channelName) {
  const currentCh = state.channels.find((c) => c.alias === channelName || c.channel === channelName);
  document.getElementById('current-channel-name').textContent = `#${channelName}`;
  document.getElementById('current-channel-desc').textContent = currentCh?.displayName || `${channelName} channel`;

  if (state.currentChatView === 'chat') {
    loadChannelMessages(channelName);
  } else {
    loadChannelThreads(channelName);
  }
}

async function loadChannelMessages(channelName) {
  const container = document.getElementById('chat-messages-container');
  container.innerHTML = '<div class="loading-state">Loading chat history...</div>';

  try {
    const res = await fetch(`/api/messages/history?channel=${encodeURIComponent(channelName)}&limit=40`);
    const data = await res.json();
    state.messages = (data.posts || []).reverse();
    renderChatBubbles();
  } catch {
    container.innerHTML = '<div class="empty-state">Failed to load chat messages.</div>';
  }
}

function renderChatBubbles() {
  const container = document.getElementById('chat-messages-container');
  const searchInput = document.getElementById('chat-search-input');
  const query = searchInput.value.toLowerCase();

  const filtered = state.messages.filter((m) => (m.message || '').toLowerCase().includes(query));

  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">No messages recorded in this channel.</div>';
    return;
  }

  filtered.forEach((msg) => {
    const isMe = state.user && (msg.userId === state.user.id || msg.username === state.user.username);
    const timeStr = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const username = msg.username || (isMe ? `@${state.user.username}` : `@${msg.userId ? msg.userId.slice(0, 8) : 'user'}`);
    const initials = (username.replace('@', '')[0] || 'U').toUpperCase();

    let displayMessage = msg.message || '';
    let fromAttribution = '';
    const fromMatch = displayMessage.match(/\n\n_~ from ([^_]+)_$/);
    if (fromMatch) {
      fromAttribution = fromMatch[1];
      displayMessage = displayMessage.replace(/\n\n_~ from [^_]+_$/, '');
    }

    const row = document.createElement('div');
    row.className = `bubble-row ${isMe ? 'outgoing' : 'incoming'}`;
    row.innerHTML = `
      <div class="bubble-avatar">${initials}</div>
      <div class="bubble-payload">
        <div class="bubble-meta-row">
          <span class="bubble-author">${escapeHtml(username)}</span>
          <span class="bubble-timestamp">${timeStr}</span>
        </div>
        <div class="bubble-body">${escapeHtml(displayMessage)}</div>
        <div class="bubble-footer-row">
          ${fromAttribution ? `<span class="bubble-attribution-badge">~ from ${escapeHtml(fromAttribution)}</span>` : '<span></span>'}
          <button class="btn-inline-reply" data-id="${msg.id}">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>
            <span>Reply in thread</span>
          </button>
        </div>
      </div>
    `;

    row.querySelector('.btn-inline-reply').addEventListener('click', () => {
      document.getElementById('chat-target-root-id').value = msg.id;
      document.getElementById('reply-indicator-text').textContent = `Replying to message by ${username}`;
      document.getElementById('thread-reply-indicator').style.display = 'flex';
      document.getElementById('chat-input-message').focus();
    });

    container.appendChild(row);
  });

  container.scrollTop = container.scrollHeight;
}

async function loadChannelThreads(channelName) {
  const container = document.getElementById('threads-container');
  container.innerHTML = '<div class="loading-state">Loading active threads...</div>';

  try {
    const res = await fetch(`/api/threads?channel=${encodeURIComponent(channelName)}&limit=30`);
    const data = await res.json();
    state.threads = data.threads || [];
    renderThreadCards();
  } catch {
    container.innerHTML = '<div class="empty-state">Failed to load active threads.</div>';
  }
}

function renderThreadCards() {
  const container = document.getElementById('threads-container');
  const searchInput = document.getElementById('chat-search-input');
  const query = searchInput.value.toLowerCase();

  const filtered = state.threads.filter((t) => (t.messagePreview || '').toLowerCase().includes(query));

  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">No active threads in this channel.</div>';
    return;
  }

  filtered.forEach((t, idx) => {
    const card = document.createElement('div');
    card.className = 'thread-summary-card';
    const badgeText = t.shortcut || `:${idx + 1}`;
    card.innerHTML = `
      <div class="thread-card-header">
        <span class="thread-id-pill">${badgeText}</span>
        <span>${t.relativeTime || ''} • ${t.replyCount} replies</span>
      </div>
      <div class="thread-card-preview">${escapeHtml(t.messagePreview)}</div>
    `;

    card.addEventListener('click', () => {
      document.getElementById('chat-target-root-id').value = badgeText;
      document.getElementById('reply-indicator-text').textContent = `Replying to thread ${badgeText}`;
      document.getElementById('thread-reply-indicator').style.display = 'flex';
      document.getElementById('chat-input-message').focus();
      showToast(`Targeted thread ${badgeText}`);
    });

    container.appendChild(card);
  });
}

// --- Cron Modal & Scheduler ---
function initCronModal() {
  const modal = document.getElementById('modal-cron');
  const btnNew = document.getElementById('btn-new-cron');
  const btnClose = document.getElementById('btn-close-modal-cron');
  const btnCancel = document.getElementById('btn-cancel-modal-cron');
  const presetSelect = document.getElementById('cron-modal-preset');
  const scheduleInput = document.getElementById('cron-modal-schedule');
  const form = document.getElementById('form-modal-cron');

  btnNew.addEventListener('click', () => {
    document.getElementById('modal-cron-title').textContent = 'Configure New Cron Job';
    form.reset();
    document.getElementById('cron-modal-schedule').value = '0 9 * * 1-5';
    document.getElementById('cron-modal-from').value = 'Daily Reminder';
    document.getElementById('cron-modal-enabled').checked = true;
    modal.style.display = 'flex';
  });

  const closeModal = () => (modal.style.display = 'none');
  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);

  presetSelect.addEventListener('change', () => {
    if (presetSelect.value !== 'custom') {
      scheduleInput.value = presetSelect.value;
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('cron-modal-name').value.trim(),
      schedule: document.getElementById('cron-modal-schedule').value.trim(),
      channel: document.getElementById('cron-modal-channel').value,
      message: document.getElementById('cron-modal-message').value,
      from: document.getElementById('cron-modal-from').value.trim() || undefined,
      timezone: document.getElementById('cron-modal-timezone').value,
      enabled: document.getElementById('cron-modal-enabled').checked,
      description: document.getElementById('cron-modal-desc').value.trim() || undefined,
    };

    try {
      const res = await fetch('/api/cron/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Cron job '${payload.name}' saved.`);
        closeModal();
        fetchCronJobs();
      } else {
        showToast(`Save failed: ${data.error}`);
      }
    } catch {
      showToast('Network error while saving cron job.');
    }
  });
}

async function fetchCronJobs() {
  try {
    const res = await fetch('/api/cron');
    const data = await res.json();
    state.cronJobs = data.jobs || [];

    document.getElementById('metric-cron-count').textContent = state.cronJobs.filter((j) => j.enabled).length;

    const nextJobs = state.cronJobs.filter((j) => j.nextRunAt).sort((a, b) => new Date(a.nextRunAt) - new Date(b.nextRunAt));
    if (nextJobs.length > 0) {
      document.getElementById('metric-cron-next').textContent = `Next: ${new Date(nextJobs[0].nextRunAt).toLocaleTimeString()}`;
    }

    renderCronTable();
  } catch (err) {
    console.error('Failed to fetch cron jobs:', err);
  }
}

function renderCronTable() {
  const tbody = document.getElementById('cron-table-body');
  tbody.innerHTML = '';

  if (state.cronJobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No scheduled cron jobs configured. Click <strong>New Cron Job</strong> above.</td></tr>';
    return;
  }

  state.cronJobs.forEach((job) => {
    const tr = document.createElement('tr');
    const statusPill = job.enabled
      ? '<span class="status-indicator-pill status-connected">Enabled</span>'
      : '<span class="status-indicator-pill status-idle">Disabled</span>';
    const nextRun = job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : (job.enabled ? 'Pending' : '-');
    const lastStatus = job.lastStatus === 'success' ? '✓ success' : job.lastStatus === 'failed' ? '✕ failed' : '— never';

    tr.innerHTML = `
      <td>${statusPill}</td>
      <td><strong>${escapeHtml(job.name)}</strong></td>
      <td><code>${escapeHtml(job.schedule)}</code> (${escapeHtml(job.timezone)})</td>
      <td>#${escapeHtml(job.channel)}</td>
      <td>${escapeHtml(job.from || 'default')}</td>
      <td style="font-family:var(--font-mono);font-size:0.75rem;">${nextRun}</td>
      <td style="font-size:0.75rem;">${lastStatus} (${job.executionCount || 0} runs)</td>
      <td>
        <div style="display:flex;gap:4px;">
          <button class="btn btn-sm btn-secondary btn-run-cron" data-name="${job.name}">Run</button>
          <button class="btn btn-sm btn-secondary btn-edit-cron" data-name="${job.name}">Edit</button>
          <button class="btn btn-sm btn-ghost btn-toggle-cron" data-name="${job.name}" data-enabled="${!job.enabled}">
            ${job.enabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      </td>
    `;

    tr.querySelector('.btn-run-cron').addEventListener('click', () => triggerCronJob(job.name));
    tr.querySelector('.btn-toggle-cron').addEventListener('click', () => toggleCronJob(job.name, !job.enabled));
    tr.querySelector('.btn-edit-cron').addEventListener('click', () => openEditCronModal(job));

    tbody.appendChild(tr);
  });
}

function openEditCronModal(job) {
  document.getElementById('modal-cron-title').textContent = `Edit Cron Job: ${job.name}`;
  document.getElementById('cron-modal-name').value = job.name;
  document.getElementById('cron-modal-schedule').value = job.schedule;
  document.getElementById('cron-modal-channel').value = job.channel;
  document.getElementById('cron-modal-message').value = job.message;
  document.getElementById('cron-modal-from').value = job.from || '';
  document.getElementById('cron-modal-timezone').value = job.timezone || 'Asia/Jakarta';
  document.getElementById('cron-modal-enabled').checked = job.enabled;
  document.getElementById('cron-modal-desc').value = job.description || '';
  document.getElementById('modal-cron').style.display = 'flex';
}

async function triggerCronJob(jobName) {
  showToast(`Executing cron job '${jobName}'...`);
  try {
    const res = await fetch('/api/cron/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobName }),
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Cron job '${jobName}' executed.`);
      fetchCronJobs();
    } else {
      showToast(`Execution failed: ${data.error}`);
    }
  } catch {
    showToast('Failed to trigger cron job');
  }
}

async function toggleCronJob(jobName, enabled) {
  try {
    const res = await fetch('/api/cron/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobName, enabled }),
    });
    if (res.ok) {
      showToast(`Cron job '${jobName}' ${enabled ? 'enabled' : 'disabled'}.`);
      fetchCronJobs();
    }
  } catch {
    showToast('Failed to toggle cron job');
  }
}

document.getElementById('btn-refresh-cron').addEventListener('click', fetchCronJobs);

// --- Quick Forms ---
function initForms() {
  document.getElementById('form-quick-send').addEventListener('submit', async (e) => {
    e.preventDefault();
    const channel = document.getElementById('quick-send-channel').value;
    const message = document.getElementById('quick-send-message').value;
    const from = document.getElementById('quick-send-from').value;

    try {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, message, from }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Message sent successfully.');
        document.getElementById('quick-send-message').value = '';
      } else {
        showToast(`Send failed: ${data.error}`);
      }
    } catch {
      showToast('Network error while dispatching message.');
    }
  });

  document.getElementById('btn-quick-send').addEventListener('click', () => {
    switchTab('overview');
    document.getElementById('quick-send-message').focus();
  });
}

// --- Interactive API Playground ---
const API_ENDPOINTS = {
  send_message: {
    method: 'POST',
    path: '/api/messages/send',
    params: [
      { name: 'channel', type: 'channel_select', default: 'town-square', required: true },
      { name: 'message', type: 'string', default: 'Hello from REST API!', required: true },
      { name: 'from', type: 'string', default: 'Google Antigravity', required: false },
    ],
  },
  reply_thread: {
    method: 'POST',
    path: '/api/messages/reply',
    params: [
      { name: 'channel', type: 'channel_select', default: 'town-square', required: true },
      { name: 'rootId', type: 'string', default: ':1', required: true },
      { name: 'message', type: 'string', default: 'Approved and merged.', required: true },
      { name: 'from', type: 'string', default: 'AI Agent', required: false },
    ],
  },
  get_channels: {
    method: 'GET',
    path: '/api/channels',
    params: [],
  },
  get_threads: {
    method: 'GET',
    path: '/api/threads',
    params: [
      { name: 'channel', type: 'channel_select', default: 'town-square', required: true },
      { name: 'limit', type: 'number', default: '20', required: false },
    ],
  },
  get_history: {
    method: 'GET',
    path: '/api/messages/history',
    params: [
      { name: 'channel', type: 'channel_select', default: 'town-square', required: true },
      { name: 'limit', type: 'number', default: '10', required: false },
    ],
  },
  get_cron: {
    method: 'GET',
    path: '/api/cron',
    params: [],
  },
  run_cron: {
    method: 'POST',
    path: '/api/cron/run',
    params: [{ name: 'jobName', type: 'string', default: 'daily-standup', required: true }],
  },
  save_cron: {
    method: 'POST',
    path: '/api/cron/save',
    params: [
      { name: 'name', type: 'string', default: 'daily-standup', required: true },
      { name: 'schedule', type: 'string', default: '0 9 * * 1-5', required: true },
      { name: 'channel', type: 'channel_select', default: 'town-square', required: true },
      { name: 'message', type: 'string', default: 'Daily standup reminder', required: true },
      { name: 'from', type: 'string', default: 'Daily Bot', required: false },
    ],
  },
  get_status: {
    method: 'GET',
    path: '/api/status',
    params: [],
  },
  auto_login: {
    method: 'POST',
    path: '/api/auth/login',
    params: [],
  },
};

function initApiPlayground() {
  const select = document.getElementById('api-endpoint-select');
  select.addEventListener('change', renderApiParams);

  document.querySelectorAll('.code-tab-btn').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.code-tab-btn').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.activeCodeLang = tab.getAttribute('data-lang');
      updateGeneratedCode();
    });
  });

  document.getElementById('btn-api-execute').addEventListener('click', executeApiRequest);

  renderApiParams();
}

function renderApiParams() {
  const select = document.getElementById('api-endpoint-select');
  if (!select) return;
  const endpointKey = select.value;
  const def = API_ENDPOINTS[endpointKey];
  const container = document.getElementById('api-params-container');

  container.innerHTML = '';

  if (def.params.length === 0) {
    container.innerHTML = '<p style="font-size:0.78rem;color:var(--text-muted);padding:8px 0;">No parameters required for this endpoint.</p>';
  } else {
    def.params.forEach((param) => {
      const group = document.createElement('div');
      group.className = 'form-field';

      if (param.type === 'channel_select') {
        let optionsHtml = '';
        state.channels.forEach((c) => {
          optionsHtml += `<option value="${c.alias}" ${c.alias === param.default ? 'selected' : ''}>#${c.alias} (${c.displayName || c.channel})</option>`;
        });

        group.innerHTML = `
          <label class="field-label">${param.name} (Searchable Channel) ${param.required ? '<span style="color:var(--status-danger)">*</span>' : ''}</label>
          <select class="field-input api-input" data-param="${param.name}">
            ${optionsHtml || `<option value="${param.default}">${param.default}</option>`}
          </select>
        `;
        group.querySelector('select').addEventListener('change', updateGeneratedCode);
      } else {
        group.innerHTML = `
          <label class="field-label">${param.name} ${param.required ? '<span style="color:var(--status-danger)">*</span>' : ''}</label>
          <input type="text" class="field-input api-input" data-param="${param.name}" value="${param.default}">
        `;
        group.querySelector('input').addEventListener('input', updateGeneratedCode);
      }

      container.appendChild(group);
    });
  }

  updateGeneratedCode();
}

function getApiFormData() {
  const select = document.getElementById('api-endpoint-select');
  const endpointKey = select.value;
  const def = API_ENDPOINTS[endpointKey];

  const inputs = document.querySelectorAll('.api-input');
  const values = {};
  inputs.forEach((input) => {
    const name = input.getAttribute('data-param');
    values[name] = input.value;
  });

  return { def, values };
}

function updateGeneratedCode() {
  const { def, values } = getApiFormData();
  const lang = state.activeCodeLang;
  const baseUrl = window.location.origin;
  const snippetEl = document.getElementById('api-code-snippet');

  let code = '';

  if (lang === 'curl') {
    if (def.method === 'GET') {
      const queryParams = new URLSearchParams(values).toString();
      const url = queryParams ? `${baseUrl}${def.path}?${queryParams}` : `${baseUrl}${def.path}`;
      code = `curl -X GET "${url}"`;
    } else {
      code = `curl -X POST "${baseUrl}${def.path}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(values, null, 2)}'`;
    }
  } else if (lang === 'typescript') {
    if (def.method === 'GET') {
      code = `// TypeScript / Node.js\nconst res = await fetch('${baseUrl}${def.path}');\nconst data = await res.json();\nconsole.log(data);`;
    } else {
      code = `// TypeScript / Node.js\nconst res = await fetch('${baseUrl}${def.path}', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify(${JSON.stringify(values, null, 4)}),\n});\nconst data = await res.json();\nconsole.log(data);`;
    }
  } else if (lang === 'python') {
    if (def.method === 'GET') {
      code = `# Python (requests)\nimport requests\n\nres = requests.get("${baseUrl}${def.path}", params=${JSON.stringify(values)})\nprint(res.json())`;
    } else {
      code = `# Python (requests)\nimport requests\n\npayload = ${JSON.stringify(values, null, 4)}\nres = requests.post("${baseUrl}${def.path}", json=payload)\nprint(res.json())`;
    }
  } else if (lang === 'go') {
    code = `// Go (net/http)\npackage main\n\nimport (\n    "bytes"\n    "encoding/json"\n    "fmt"\n    "net/http"\n)\n\nfunc main() {\n    // Request to ${def.path}\n    // See full OpenAPI spec at ${baseUrl}/api/openapi.json\n}`;
  } else if (lang === 'php') {
    code = `<?php\n// PHP cURL\n$ch = curl_init("${baseUrl}${def.path}");\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n${def.method === 'POST' ? `curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(${JSON.stringify(values)}));\ncurl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);\n` : ''}$res = curl_exec($ch);\ncurl_close($ch);\necho $res;`;
  }

  snippetEl.textContent = code;
}

async function executeApiRequest() {
  const { def, values } = getApiFormData();
  const statusBadge = document.getElementById('api-response-status');
  const responseBody = document.getElementById('api-response-body');

  statusBadge.className = 'status-pill status-executing';
  statusBadge.textContent = 'Executing...';
  responseBody.textContent = 'Awaiting response...';

  try {
    let url = def.path;
    let options = { method: def.method };

    if (def.method === 'GET') {
      const queryParams = new URLSearchParams(values).toString();
      if (queryParams) url += `?${queryParams}`;
    } else {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(values);
    }

    const startTime = performance.now();
    const res = await fetch(url, options);
    const duration = Math.round(performance.now() - startTime);
    const json = await res.json();

    statusBadge.className = res.ok ? 'status-pill status-success-pill' : 'status-pill status-danger-pill';
    statusBadge.textContent = `${res.status} ${res.statusText} (${duration}ms)`;
    responseBody.textContent = JSON.stringify(json, null, 2);

    addLog(`[API] ${def.method} ${url} -> ${res.status} (${duration}ms)`, res.ok ? 'log-sent' : 'log-error');
  } catch (err) {
    statusBadge.className = 'status-pill status-danger-pill';
    statusBadge.textContent = 'Network Error';
    responseBody.textContent = err.message;
  }
}

function copyApiSnippet() {
  const snippet = document.getElementById('api-code-snippet').textContent;
  navigator.clipboard.writeText(snippet);
  showToast('Code snippet copied to clipboard.');
}

function copySnippet(id) {
  const el = document.getElementById(id);
  navigator.clipboard.writeText(el.innerText);
  showToast('cURL command copied to clipboard.');
}

// --- Live Console Logging ---
function addLog(text, levelClass = 'log-system') {
  const consoleEl = document.getElementById('logs-console');
  if (!consoleEl) return;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = document.createElement('div');
  entry.className = `log-line ${levelClass}`;
  entry.innerHTML = `<span class="log-ts">[${time}]</span> ${escapeHtml(text)}`;
  consoleEl.appendChild(entry);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

document.getElementById('btn-clear-logs').addEventListener('click', () => {
  document.getElementById('logs-console').innerHTML = '<div class="log-line log-system">[00:00:00] Logs cleared.</div>';
});

// --- Toast Notifications ---
function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast-item';
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    setTimeout(() => toast.remove(), 160);
  }, 3200);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
