// ── iGenius Memory — Sidebar Logic ─────────────────
// Communication bridge — VS Code webview or standalone (future Tauri)
const bridge = (() => {
  if (typeof acquireVsCodeApi !== 'undefined') {
    const api = acquireVsCodeApi();
    return { postMessage: (m) => api.postMessage(m) };
  }
  // Future: Tauri bridge
  // if (window.__TAURI__) {
  //   return { postMessage: (m) => window.__TAURI__.invoke('handle_message', m) };
  // }
  return { postMessage: (m) => console.log('[msg]', m) };
})();

function msg(m) { bridge.postMessage(m); }

// ── State ─────────────────────────────────────────
let memories = { short_term: [], long_term: [], persistent: [] };
let currentTab = 'long_term';

// ── Tab switching ─────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const id = tab.dataset.tab;
    currentTab = id;
    document.getElementById('panel-' + id)?.classList.add('active');
  });
});

// ── Search ────────────────────────────────────────
let searchTimeout;
document.getElementById('search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim();
  if (q.length >= 2) {
    searchTimeout = setTimeout(() => msg({ type: 'search', query: q }), 300);
  }
});

// ── Render memory cards ───────────────────────────
function renderCards(layer, container) {
  const list = memories[layer] || [];
  const el = document.getElementById(container);
  const emptyEl = document.getElementById(layer === 'long_term' ? 'lt-empty' : 'st-empty');

  if (!list.length) {
    el.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  el.innerHTML = list.map(m => cardHtml(m, layer)).join('');

  // Attach click handlers
  el.querySelectorAll('.memory-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-actions')) return;
      card.classList.toggle('expanded');
    });
  });
}

function cardHtml(m, layer) {
  const imp = m.importance >= 80 ? 'high' : m.importance >= 50 ? 'med' : 'low';
  const date = new Date(m.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const facts = (m.key_facts || [])
    .map(f => '<li>' + esc(f) + '</li>').join('');

  const actions = [];
  if (layer === 'short_term') {
    actions.push('<button class="promote-btn" onclick="event.stopPropagation();msg({type:\'promote\',memoryId:' + m.id + '})">⬆ Promote</button>');
  }
  actions.push('<button class="delete-btn" onclick="event.stopPropagation();msg({type:\'delete\',memoryId:' + m.id + '})">✕ Delete</button>');

  return '<div class="memory-card" data-id="' + m.id + '">'
    + '<div class="card-header">'
    + '<div class="card-importance imp-' + imp + '"></div>'
    + '<div class="card-body">'
    + '<div class="card-title">' + esc(m.title || 'Untitled') + '</div>'
    + '<div class="card-meta">'
    + '<span class="layer-badge layer-' + m.layer + '">' + m.layer.replace('_', '-') + '</span>'
    + '<span>' + esc(m.category || '') + '</span>'
    + '<span>imp:' + m.importance + '</span>'
    + '<span>' + date + '</span>'
    + '</div></div></div>'
    + '<div class="card-expand">'
    + '<div class="content-text">' + esc(m.content || m.summary || '') + '</div>'
    + (facts ? '<ul class="facts-list">' + facts + '</ul>' : '')
    + '<div class="card-actions">' + actions.join('') + '</div>'
    + '</div></div>';
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ── Search results ────────────────────────────────
function renderSearchResults(data) {
  const el = document.getElementById('search-results');
  const emptyEl = document.getElementById('search-empty');
  const list = data.memories || [];
  if (!list.length) {
    el.innerHTML = '';
    emptyEl.style.display = '';
    emptyEl.querySelector('.emoji').textContent = '🔍';
    emptyEl.querySelector('div:last-child').textContent = 'No results for "' + (data.query || '') + '"';
    return;
  }
  emptyEl.style.display = 'none';
  el.innerHTML = list.map(m => cardHtml(m, m.layer)).join('');
  el.querySelectorAll('.memory-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-actions')) return;
      card.classList.toggle('expanded');
    });
  });
}

// ── Message handler ───────────────────────────────
window.addEventListener('message', (event) => {
  const m = event.data;
  switch (m.type) {
    case 'memories':
      memories[m.layer] = m.data || [];
      if (m.layer === 'long_term') renderCards('long_term', 'lt-list');
      if (m.layer === 'short_term') renderCards('short_term', 'st-list');
      break;

    case 'stats':
      document.getElementById('stat-total').textContent = 'Total: ' + m.data.total_count;
      document.getElementById('stat-persistent').textContent = 'P: ' + m.data.persistent_count;
      document.getElementById('stat-long').textContent = 'LT: ' + m.data.long_term_count;
      document.getElementById('stat-short').textContent = 'ST: ' + m.data.short_term_count;
      document.getElementById('count-lt').textContent = m.data.long_term_count;
      document.getElementById('count-st').textContent = m.data.short_term_count;
      break;

    case 'briefing':
      document.getElementById('briefing-text').innerHTML =
        '<div style="white-space:pre-wrap;line-height:1.7;">' + esc(m.data.briefing || 'No briefing available.') + '</div>';
      break;

    case 'search-results':
      renderSearchResults(m.data);
      break;

    case 'loading':
      document.getElementById('loading').classList.toggle('active', m.loading);
      break;

    case 'error':
      showError(m.message);
      break;

    case 'no-api-key':
      document.getElementById('no-key').style.display = '';
      document.getElementById('main').style.display = 'none';
      break;

    case 'promote-ok':
      showToast('Memory #' + m.memoryId + ' promoted to long-term ✓', false);
      break;

    case 'delete-ok':
      showToast('Memory #' + m.memoryId + ' deleted ✓', false);
      break;

    case 'store-ok':
      showToast('Memory saved: "' + (m.memory?.title || 'Untitled') + '" ✓', false);
      break;

    case 'pinned-memories':
      pinnedMemories = m.data || [];
      renderPins();
      break;

    case 'pin-stored':
      showToast('📌 Pinned: "' + (m.memory?.title || '') + '"', false);
      msg({ type: 'get-pinned' });
      break;

    case 'pin-updated':
      showToast('💾 Updated: "' + (m.memory?.title || '') + '"', false);
      msg({ type: 'get-pinned' });
      break;

    case 'pin-deleted':
      showToast('Pinned fact deleted ✓', false);
      msg({ type: 'get-pinned' });
      break;

    case 'pause-state': {
      const btn = document.getElementById('pause-btn');
      const banner = document.getElementById('pause-banner');
      if (m.paused) {
        btn.textContent = '▶';
        btn.title = 'Resume background activity';
        btn.classList.add('paused');
        banner.classList.add('show');
      } else {
        btn.textContent = '⏸';
        btn.title = 'Pause all background activity';
        btn.classList.remove('paused');
        banner.classList.remove('show');
      }
      break;
    }

    case 'project-changed': {
      const nameEl = document.getElementById('project-name');
      const barEl = document.getElementById('project-bar');
      if (m.project) {
        nameEl.textContent = m.project;
        barEl.classList.remove('global');
        barEl.classList.add('scoped');
      } else {
        nameEl.textContent = 'Global (no project)';
        barEl.classList.add('global');
        barEl.classList.remove('scoped');
      }
      break;
    }
  }
});

function showError(text) {
  const el = document.getElementById('error-toast');
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 4000);
}

function showToast(text, isError) {
  const el = document.getElementById('error-toast');
  el.textContent = text;
  el.style.background = isError ? '#f43f5e' : '#10b981';
  el.classList.add('show');
  setTimeout(() => { el.classList.remove('show'); el.style.background = ''; }, 3000);
}

// ── Visual tools ──────────────────────────────────
function visualAction(action) {
  const url = document.getElementById('visual-url').value.trim();
  if (!url) {
    showError('Enter a URL to analyze');
    return;
  }
  try { new URL(url); } catch {
    showError('Enter a valid URL (e.g. https://example.com)');
    return;
  }
  msg({ type: 'visual-' + action, url: url });
}

// ── Pin form + rendering ──────────────────────────
let pinnedMemories = [];

function togglePinForm() {
  const f = document.getElementById('pin-form');
  const arrow = document.getElementById('pin-form-arrow');
  if (f.style.display === 'none') {
    f.style.display = '';
    arrow.textContent = '▾';
  } else {
    f.style.display = 'none';
    arrow.textContent = '▸';
    clearPinForm();
  }
}

function clearPinForm() {
  document.getElementById('pin-title').value = '';
  document.getElementById('pin-content').value = '';
  document.getElementById('pin-category').value = 'note';
  document.getElementById('pin-project').value = '';
  // Remove edit state
  delete document.getElementById('pin-form').dataset.editId;
  document.querySelector('.pin-save-btn').textContent = '📌 Pin It';
}

function savePin() {
  const title = document.getElementById('pin-title').value.trim();
  const content = document.getElementById('pin-content').value.trim();
  const category = document.getElementById('pin-category').value;
  const project = document.getElementById('pin-project').value.trim() || null;
  const editId = document.getElementById('pin-form').dataset.editId;

  if (!title) { showError('Title is required'); return; }
  if (!content) { showError('Content/value is required'); return; }

  if (editId) {
    msg({ type: 'update-pin', memoryId: parseInt(editId), title, content, category });
  } else {
    msg({ type: 'store-pin', title, content, category, project });
  }

  togglePinForm();
}

function editPin(id) {
  const mem = pinnedMemories.find(m => m.id === id);
  if (!mem) return;

  const f = document.getElementById('pin-form');
  f.style.display = '';
  f.dataset.editId = '' + id;
  document.getElementById('pin-form-arrow').textContent = '▾';
  document.getElementById('pin-title').value = mem.title || '';
  document.getElementById('pin-content').value = mem.content || '';
  document.getElementById('pin-category').value = mem.category || 'note';
  document.getElementById('pin-project').value = mem.project || '';
  document.querySelector('.pin-save-btn').textContent = '💾 Update';
  document.getElementById('pin-title').focus();
}

const categoryIcons = {
  credential: '🔑', server: '🖥️', api_key: '🔐',
  config: '⚙️', identity: '👤', url: '🔗', note: '📝'
};

function renderPins() {
  const list = pinnedMemories;
  const el = document.getElementById('pin-list');
  const emptyEl = document.getElementById('pin-empty');
  document.getElementById('count-pin').textContent = list.length;

  if (!list.length) {
    el.innerHTML = '';
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  el.innerHTML = list.map(m => {
    const icon = categoryIcons[m.category] || '📌';
    const date = new Date(m.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric'
    });
    const proj = m.project ? '<span>📁 ' + esc(m.project) + '</span>' : '';

    return '<div class="pin-card" data-id="' + m.id + '" onclick="togglePinCard(this)">'
      + '<div style="display:flex;align-items:flex-start;gap:8px;">'
      + '<span class="pin-icon">' + icon + '</span>'
      + '<div class="pin-body">'
      + '<div class="pin-title">' + esc(m.title || 'Untitled') + '</div>'
      + '<div class="pin-value">' + esc((m.content || '').substring(0, 80)) + '</div>'
      + '<div class="pin-meta">'
      + '<span class="cat-badge">' + esc(m.category || 'note') + '</span>'
      + proj
      + '<span>' + date + '</span>'
      + '</div></div></div>'
      + '<div class="pin-expand">'
      + '<div class="full-content">' + esc(m.content || '') + '</div>'
      + '<div class="pin-actions">'
      + '<button onclick="event.stopPropagation();editPin(' + m.id + ')">✏️ Edit</button>'
      + '<button class="pin-delete-btn" onclick="event.stopPropagation();msg({type:\'delete-pin\',memoryId:' + m.id + '})">✕ Delete</button>'
      + '</div></div></div>';
  }).join('');
}

function togglePinCard(card) {
  if (event.target.closest('.pin-actions')) return;
  card.classList.toggle('expanded');
}

// ── Context menu (right-click on Long-term tab) ───
const ctxMenu = document.getElementById('ctx-menu');

// Attach right-click to the Long-term tab
document.querySelectorAll('.tab').forEach(tab => {
  if (tab.dataset.tab === 'long_term') {
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      ctxMenu.style.left = e.pageX + 'px';
      ctxMenu.style.top = e.pageY + 'px';
      ctxMenu.classList.add('show');
    });
  }
});

// Also allow right-click on the Long-term panel itself
document.getElementById('panel-long_term').addEventListener('contextmenu', (e) => {
  // Don't override context menu on memory cards
  if (e.target.closest('.memory-card')) return;
  e.preventDefault();
  ctxMenu.style.left = e.pageX + 'px';
  ctxMenu.style.top = e.pageY + 'px';
  ctxMenu.classList.add('show');
});

// Hide context menu on click anywhere
document.addEventListener('click', () => ctxMenu.classList.remove('show'));
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.tab[data-tab="long_term"]') && !e.target.closest('#panel-long_term')) {
    ctxMenu.classList.remove('show');
  }
});

function ctxAction(action) {
  ctxMenu.classList.remove('show');
  if (action === 'add-memory') {
    msg({ type: 'add-long-term-memory' });
  } else if (action === 'refresh') {
    msg({ type: 'refresh' });
  }
}

// ── Init ──────────────────────────────────────────
document.getElementById('main').style.display = '';
msg({ type: 'ready' });
