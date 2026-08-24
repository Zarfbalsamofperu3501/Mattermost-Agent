// ==============================================================================
// Mattermost Agent Web UI Client Application (Baileys.wiki-style)
// ==============================================================================

const state = {
  authenticated: false,
  isLoggingIn: false,
  user: null,
  channels: [],
  currentChannel: 'town-square',
  threads: [],
  cronJobs: [],
  activeCodeLang: 'curl',
  theme: 'dark',
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNavigation();
  initSSE();
  fetchStatus();
  fetchChannels();
  fetchCronJobs();
  initForms();
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

// --- Navigation Tabs ---
function initNavigation() {
  const navButtons = document.querySelectorAll('.nav-item');
  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  // Handle hash changes for direct deep linking (#api, #channels, #cron)
  if (window.location.hash) {
    const hashTab = window.location.hash.replace('#', '');
    if (document.getElementById(`view-${hashTab}`)) {
      switchTab(hashTab);
    }
  }
}

function switchTab(tabId) {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });

  document.querySelectorAll('.view-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `view-${tabId}`);
  });

  window.location.hash = tabId;

  if (tabId === 'channels') {
    loadChannelThreads(state.currentChannel);
  } else if (tabId === 'cron') {
    fetchCronJobs();
  }
}

// --- Server-Sent Events (SSE) Stream ---
function initSSE() {
  const eventSource = new EventSource('/api/events');

  eventSource.addEventListener('auth:starting', (e) => {
    const data = JSON.parse(e.data);
    addLog(`[Auth] ${data.message}`, 'log-info');
    updateConnectionBadge('logging-in', 'Opening Browser...');
  });

  eventSource.addEventListener('auth:success', (e) => {
    const data = JSON.parse(e.data);
    addLog(`[Auth] ${data.message}`, 'log-success');
    showToast(data.message, 'success');
    fetchStatus();
    fetchChannels();
  });

  eventSource.addEventListener('auth:failed', (e) => {
    const data = JSON.parse(e.data);
    addLog(`[Auth Error] ${data.message}`, 'log-error');
    showToast(data.message, 'error');
    fetchStatus();
  });

  eventSource.addEventListener('message:sent', (e) => {
    const data = JSON.parse(e.data);
    addLog(`[Message Sent] #${data.channel}: "${data.message.slice(0, 40)}" (from: ${data.from || 'default'})`, 'log-success');
  });

  eventSource.addEventListener('message:replied', (e) => {
    const data = JSON.parse(e.data);
    addLog(`[Thread Reply] #${data.channel} [${data.rootId}]: "${data.message.slice(0, 40)}"`, 'log-success');
    if (state.currentChannel === data.channel) {
      loadChannelThreads(state.currentChannel);
    }
  });

  eventSource.addEventListener('cron:executed', (e) => {
    const data = JSON.parse(e.data);
    addLog(`[Cron Job] '${data.jobName}' executed successfully`, 'log-info');
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

    const userProfileCard = document.getElementById('user-profile-card');
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
      metricUsername.textContent = data.user.username;
      metricRoles.textContent = data.user.roles || 'system_user';
    } else if (data.isLoggingIn) {
      updateConnectionBadge('logging-in', 'Logging in via browser...');
      userAvatar.textContent = '...';
      userDisplayName.textContent = 'Authenticating';
      userHandle.textContent = 'Please complete in browser';
      metricUsername.textContent = 'Logging In...';
    } else {
      updateConnectionBadge('disconnected', 'Disconnected');
      userAvatar.textContent = '?';
      userDisplayName.textContent = 'Not Logged In';
      userHandle.textContent = '@offline';
      metricUsername.textContent = 'Not Connected';
      metricRoles.textContent = 'Click 1-Click Login';
    }
  } catch (err) {
    updateConnectionBadge('disconnected', 'Server Offline');
  }
}

function updateConnectionBadge(status, text) {
  const badge = document.getElementById('connection-badge');
  const badgeText = document.getElementById('connection-text');
  badge.className = `badge badge-${status}`;
  badgeText.textContent = text;
}

// 1-Click Auto Login Action
document.getElementById('btn-auto-login').addEventListener('click', async () => {
  showToast('Launching interactive Playwright browser window...', 'info');
  updateConnectionBadge('logging-in', 'Opening Browser...');

  try {
    const res = await fetch('/api/auth/login', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message, 'success');
      addLog('[Auth] Interactive login launched.', 'log-info');
    } else {
      showToast(data.message || 'Login request rejected', 'error');
    }
  } catch (err) {
    showToast('Failed to connect to login endpoint', 'error');
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

    renderChannelSelector();
    renderChannelList();
  } catch (err) {
    console.error('Failed to load channels:', err);
  }
}

function renderChannelSelector() {
  const select = document.getElementById('quick-send-channel');
  select.innerHTML = '';

  state.channels.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.alias || c.channel;
    opt.textContent = `#${c.alias} (${c.displayName || c.channel})`;
    if (c.alias === 'town-square') opt.selected = true;
    select.appendChild(opt);
  });
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
    container.innerHTML = '<div class="text-muted text-xs p-2">No matching channels found.</div>';
    return;
  }

  filtered.forEach((c) => {
    const item = document.createElement('div');
    item.className = `channel-list-item ${c.alias === state.currentChannel ? 'active' : ''}`;
    const statusDot = c.enabled ? '🟢' : '⚪';
    item.innerHTML = `
      <span>${statusDot} #${c.alias}</span>
      <span class="text-muted text-xs">${c.displayName ? c.displayName.slice(0, 18) : ''}</span>
    `;
    item.addEventListener('click', () => {
      state.currentChannel = c.alias;
      renderChannelList();
      loadChannelThreads(c.alias);
    });
    container.appendChild(item);
  });
}

document.getElementById('channel-search-input').addEventListener('input', renderChannelList);

document.getElementById('btn-sync-channels').addEventListener('click', async () => {
  showToast('Syncing all channels from Mattermost server...', 'info');
  try {
    const res = await fetch('/api/channels/sync', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast(`Successfully synced ${data.data.totalDiscovered} channels!`, 'success');
      fetchChannels();
    }
  } catch (err) {
    showToast('Failed to sync channels', 'error');
  }
});

// --- Thread Explorer ---
async function loadChannelThreads(channelName) {
  const container = document.getElementById('threads-container');
  document.getElementById('current-channel-name').textContent = `#${channelName}`;

  container.innerHTML = '<div class="loading-state">Loading active threads...</div>';

  try {
    const res = await fetch(`/api/threads?channel=${encodeURIComponent(channelName)}&limit=30`);
    const data = await res.json();

    state.threads = data.threads || [];
    container.innerHTML = '';

    if (state.threads.length === 0) {
      container.innerHTML = '<div class="empty-state">No active threads in this channel.</div>';
      return;
    }

    state.threads.forEach((t, idx) => {
      const card = document.createElement('div');
      card.className = 'thread-item-card';
      const badgeText = t.shortcut || `:${idx + 1}`;
      card.innerHTML = `
        <div class="thread-item-meta">
          <span class="badge badge-muted">${badgeText} • ${t.relativeTime}</span>
          <span class="text-xs">${t.replyCount} ${t.replyCount === 1 ? 'reply' : 'replies'}</span>
        </div>
        <div class="thread-item-body">${escapeHtml(t.messagePreview)}</div>
      `;

      card.addEventListener('click', () => {
        document.getElementById('reply-root-id').value = badgeText;
        document.getElementById('reply-message').focus();
        showToast(`Targeted thread ${badgeText}`, 'info');
      });

      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = '<div class="empty-state text-danger">Failed to load threads for this channel.</div>';
  }
}

document.getElementById('btn-refresh-threads').addEventListener('click', () => {
  loadChannelThreads(state.currentChannel);
});

// --- Cron Scheduler ---
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
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No cron jobs configured. Create <code>cron.yml</code> to add schedules.</td></tr>';
    return;
  }

  state.cronJobs.forEach((job) => {
    const tr = document.createElement('tr');
    const statusIcon = job.enabled ? '<span class="badge badge-success">Enabled</span>' : '<span class="badge badge-muted">Disabled</span>';
    const nextRun = job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : (job.enabled ? 'Pending' : '-');
    const lastStatus = job.lastStatus === 'success' ? '✅ success' : job.lastStatus === 'failed' ? '❌ failed' : '⏳ never';

    tr.innerHTML = `
      <td>${statusIcon}</td>
      <td><strong>${job.name}</strong></td>
      <td><code>${job.schedule}</code> (${job.timezone})</td>
      <td>#${job.channel}</td>
      <td>${job.from || '<em>default</em>'}</td>
      <td>${nextRun}</td>
      <td><span class="text-xs">${lastStatus} (${job.executionCount} runs)</span></td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm btn-primary btn-run-cron" data-name="${job.name}">Run Now</button>
          <button class="btn btn-sm btn-secondary btn-toggle-cron" data-name="${job.name}" data-enabled="${!job.enabled}">
            ${job.enabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      </td>
    `;

    tr.querySelector('.btn-run-cron').addEventListener('click', () => triggerCronJob(job.name));
    tr.querySelector('.btn-toggle-cron').addEventListener('click', () => toggleCronJob(job.name, !job.enabled));

    tbody.appendChild(tr);
  });
}

async function triggerCronJob(jobName) {
  showToast(`Triggering cron job '${jobName}'...`, 'info');
  try {
    const res = await fetch('/api/cron/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobName }),
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Cron job '${jobName}' executed successfully!`, 'success');
      fetchCronJobs();
    } else {
      showToast(`Cron job failed: ${data.error}`, 'error');
    }
  } catch {
    showToast('Failed to trigger cron job', 'error');
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
      showToast(`Cron job '${jobName}' ${enabled ? 'enabled' : 'disabled'}!`, 'success');
      fetchCronJobs();
    }
  } catch {
    showToast('Failed to toggle cron job', 'error');
  }
}

document.getElementById('btn-refresh-cron').addEventListener('click', fetchCronJobs);

// --- Forms Management ---
function initForms() {
  // Quick Send Form
  document.getElementById('form-quick-send').addEventListener('submit', async (e) => {
    e.preventDefault();
    const channel = document.getElementById('quick-send-channel').value;
    const message = document.getElementById('quick-send-message').value;
    const from = document.getElementById('quick-send-from').value;

    showToast(`Sending to #${channel}...`, 'info');

    try {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, message, from }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Message sent successfully!', 'success');
        document.getElementById('quick-send-message').value = '';
      } else {
        showToast(`Send failed: ${data.error}`, 'error');
      }
    } catch {
      showToast('Network error while sending message', 'error');
    }
  });

  // Thread Reply Form
  document.getElementById('form-thread-reply').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rootId = document.getElementById('reply-root-id').value;
    const message = document.getElementById('reply-message').value;
    const from = document.getElementById('reply-from').value;

    showToast(`Replying to ${rootId}...`, 'info');

    try {
      const res = await fetch('/api/messages/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: state.currentChannel, rootId, message, from }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Reply posted successfully!', 'success');
        document.getElementById('reply-message').value = '';
        loadChannelThreads(state.currentChannel);
      } else {
        showToast(`Reply failed: ${data.error}`, 'error');
      }
    } catch {
      showToast('Network error while posting reply', 'error');
    }
  });

  document.getElementById('btn-quick-send').addEventListener('click', () => {
    switchTab('overview');
    document.getElementById('quick-send-message').focus();
  });
}

// --- Interactive API Playground (Baileys.wiki-Style) ---
const API_ENDPOINTS = {
  send_message: {
    method: 'POST',
    path: '/api/messages/send',
    params: [
      { name: 'channel', type: 'string', default: 'town-square', required: true },
      { name: 'message', type: 'string', default: 'Hello from REST API!', required: true },
      { name: 'from', type: 'string', default: 'Google Antigravity', required: false },
    ],
  },
  reply_thread: {
    method: 'POST',
    path: '/api/messages/reply',
    params: [
      { name: 'channel', type: 'string', default: 'town-square', required: true },
      { name: 'rootId', type: 'string', default: ':1', required: true },
      { name: 'message', type: 'string', default: 'Approved and merged!', required: true },
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
      { name: 'channel', type: 'string', default: 'town-square', required: true },
      { name: 'limit', type: 'number', default: '20', required: false },
    ],
  },
  get_history: {
    method: 'GET',
    path: '/api/messages/history',
    params: [
      { name: 'channel', type: 'string', default: 'town-square', required: true },
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

  document.querySelectorAll('.code-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.code-tab').forEach((t) => t.classList.remove('active'));
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
  const endpointKey = select.value;
  const def = API_ENDPOINTS[endpointKey];
  const container = document.getElementById('api-params-container');

  container.innerHTML = '';

  if (def.params.length === 0) {
    container.innerHTML = '<p class="text-sm text-muted">No request parameters required for this endpoint.</p>';
  } else {
    def.params.forEach((param) => {
      const group = document.createElement('div');
      group.className = 'form-group';
      group.innerHTML = `
        <label>${param.name} ${param.required ? '<span style="color:var(--danger)">*</span>' : ''}</label>
        <input type="text" class="form-control api-input" data-param="${param.name}" value="${param.default}">
      `;
      group.querySelector('input').addEventListener('input', updateGeneratedCode);
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
    code = `// Go (net/http)\npackage main\n\nimport (\n    "bytes"\n    "encoding/json"\n    "fmt"\n    "net/http"\n)\n\nfunc main() {\n    // Execute request to ${def.path}\n    // See full docs at ${baseUrl}/api/openapi.json\n}`;
  } else if (lang === 'php') {
    code = `<?php\n// PHP cURL\n$ch = curl_init("${baseUrl}${def.path}");\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n${def.method === 'POST' ? `curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(${JSON.stringify(values)}));\ncurl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);\n` : ''}$res = curl_exec($ch);\ncurl_close($ch);\necho $res;`;
  }

  snippetEl.textContent = code;
}

async function executeApiRequest() {
  const { def, values } = getApiFormData();
  const statusBadge = document.getElementById('api-response-status');
  const responseBody = document.getElementById('api-response-body');

  statusBadge.className = 'badge badge-warning';
  statusBadge.textContent = 'Executing...';
  responseBody.textContent = 'Sending request to server...';

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

    statusBadge.className = res.ok ? 'badge badge-success' : 'badge badge-danger';
    statusBadge.textContent = `Status: ${res.status} ${res.statusText} (${duration}ms)`;
    responseBody.textContent = JSON.stringify(json, null, 2);

    addLog(`[API Request] ${def.method} ${url} -> ${res.status} (${duration}ms)`, res.ok ? 'log-success' : 'log-error');
  } catch (err) {
    statusBadge.className = 'badge badge-danger';
    statusBadge.textContent = 'Network Error';
    responseBody.textContent = err.message;
  }
}

function copyApiSnippet() {
  const snippet = document.getElementById('api-code-snippet').textContent;
  navigator.clipboard.writeText(snippet);
  showToast('Code snippet copied to clipboard!', 'info');
}

function copySnippet(id) {
  const el = document.getElementById(id);
  navigator.clipboard.writeText(el.innerText);
  showToast('cURL command copied!', 'info');
}

// --- Live Activity Logging ---
function addLog(text, levelClass = 'log-info') {
  const consoleEl = document.getElementById('logs-console');
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry ${levelClass}`;
  entry.textContent = `[${time}] ${text}`;
  consoleEl.appendChild(entry);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

document.getElementById('btn-clear-logs').addEventListener('click', () => {
  document.getElementById('logs-console').innerHTML = '<div class="log-entry log-info">[System] Logs cleared.</div>';
});

// --- Toast Notifications ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
