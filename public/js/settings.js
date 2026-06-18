/* ============================================================
   settings.js — newsLookup Gen2
   All JavaScript for settings.html (App Settings).
   Requires: common/common.js loaded first.
   ============================================================ */

// ── Domain display metadata ───────────────────────────────────────────────────
const DOMAIN_META = {
  collection: { icon: '🗂',  label: 'My Clippings',                     cls: 'collection' },
  search:     { icon: '🔍',  label: 'newsLookup - Search',              cls: 'search'     },
  rss:        { icon: '📡',  label: 'newsLookup - RSS Feeds',           cls: 'rss'        },
  keywords:   { icon: '💡',  label: 'newsLookup - Keyword Suggestions', cls: 'keywords'   },
  ui:         { icon: '🎨',  label: 'newsLookup - Display',             cls: 'ui'         },
};

// ── Utilities ─────────────────────────────────────────────────────────────────
function showStatus(msg, isError = false) {
  const bar = document.getElementById('statusBar');
  const txt = document.getElementById('statusMsg');
  bar.className   = 'status-bar show ' + (isError ? 'err' : 'ok');
  txt.textContent = msg;
  if (!isError) setTimeout(() => bar.classList.remove('show'), 3000);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString();
}

// ── Render helpers ────────────────────────────────────────────────────────────
function buildControl(item) {
  const { dotPath, type, currentValue, min, max, step, unit, options } = item;
  const safeId = dotPath.replace(/\./g, '_');

  if (type === 'boolean') {
    return `
      <label class="toggle" title="${dotPath}">
        <input type="checkbox" id="${safeId}" ${currentValue ? 'checked' : ''}
               onchange="saveSetting('${dotPath}', this.checked)">
        <span class="toggle-track"></span>
      </label>`;
  }

  if (type === 'select') {
    const opts = (options || []).map(opt => {
      const value = typeof opt === 'object' ? opt.value : opt;
      const label = typeof opt === 'object' ? (opt.label || opt.value) : opt;
      const sel   = value === currentValue ? ' selected' : '';
      return `<option value="${value}"${sel}>${label}</option>`;
    }).join('');
    return `
      <select id="${safeId}" class="select-input num-input" title="${dotPath}"
              onchange="saveSetting('${dotPath}', this.value)">
        ${opts}
      </select>`;
  }

  const sliderMin  = min  !== undefined ? min  : 0;
  const sliderMax  = max  !== undefined ? max  : 100;
  const sliderStep = step !== undefined ? step : (type === 'float' ? 0.01 : 1);
  const unitHtml   = unit ? `<span class="unit-label">${unit}</span>` : '';

  return `
    <div class="slider-wrap">
      <input type="range"
             id="${safeId}_range"
             min="${sliderMin}" max="${sliderMax}" step="${sliderStep}"
             value="${currentValue}"
             oninput="syncNum('${safeId}', this.value)">
      <input type="number"
             id="${safeId}_num"
             class="num-input"
             min="${sliderMin}" max="${sliderMax}" step="${sliderStep}"
             value="${currentValue}"
             oninput="syncRange('${safeId}', this.value)">
      ${unitHtml}
    </div>
    <button class="save-btn" id="${safeId}_btn"
            onclick="saveFromInput('${dotPath}', '${safeId}', '${type}')">
      save
    </button>`;
}

function syncNum(safeId, val) {
  const el = document.getElementById(safeId + '_num');
  if (el) el.value = val;
}
function syncRange(safeId, val) {
  const el = document.getElementById(safeId + '_range');
  if (el) el.value = val;
}

function buildSettingRow(item) {
  return `
    <div class="setting-row">
      <div class="setting-meta">
        <div class="setting-label">${item.label || item.key}</div>
        <div class="setting-desc">${item.description || ''}</div>
        <div class="setting-path">${item.dotPath}</div>
      </div>
      <div class="setting-control">
        ${buildControl(item)}
      </div>
    </div>`;
}

function buildDomainCard(domain, items, openByDefault) {
  const dm   = DOMAIN_META[domain] || { icon: '⚙️', label: domain, cls: '' };
  const open = openByDefault ? ' open' : '';
  return `
    <div class="domain-card${open}" id="card_${domain}">
      <div class="domain-header" onclick="toggleCard('${domain}')">
        <div class="domain-icon ${dm.cls}">${dm.icon}</div>
        <span class="domain-label">${dm.label}</span>
        <span class="domain-count">${items.length} setting${items.length !== 1 ? 's' : ''}</span>
        <span class="domain-chevron">▶</span>
      </div>
      <div class="domain-body">
        ${items.map(buildSettingRow).join('')}
      </div>
    </div>`;
}

// ── Toggle card ───────────────────────────────────────────────────────────────
function toggleCard(domain) {
  document.getElementById('card_' + domain).classList.toggle('open');
}

// ── Load settings + schema ────────────────────────────────────────────────────
async function loadAll() {
  try {
    const [schemaRes, settingsRes] = await Promise.all([
      fetch('/api/settings/schema'),
      fetch('/api/settings'),
    ]);
    const schema   = await schemaRes.json();
    const settings = await settingsRes.json();

    const byDomain = {};
    for (const item of schema) {
      if (item.hidden) continue;
      const domainVal = settings[item.domain];
      item.currentValue = domainVal !== undefined ? domainVal[item.key] : item.currentValue;
      if (!byDomain[item.domain]) byDomain[item.domain] = [];
      byDomain[item.domain].push(item);
    }

    const container = document.getElementById('settingsContainer');
    const domains   = Object.keys(byDomain);
    container.innerHTML = domains
      .map((d, i) => buildDomainCard(d, byDomain[d], i === 0))
      .join('');

    if (settings.updatedAt) {
      document.getElementById('lastUpdated').textContent =
        'Last saved: ' + formatDate(settings.updatedAt);
    }
  } catch(err) {
    showStatus('Failed to load settings: ' + err.message, true);
  }
}

// ── Save boolean toggle immediately ──────────────────────────────────────────
async function saveSetting(dotPath, value) {
  const [domain, key] = dotPath.split('.');
  try {
    const res  = await fetch(`/api/settings/${domain}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unknown error');
    showStatus(`Saved: ${dotPath} = ${value}`);
    if (data.settings?.updatedAt) {
      document.getElementById('lastUpdated').textContent =
        'Last saved: ' + formatDate(data.settings.updatedAt);
    }
  } catch(err) {
    showStatus('Save failed: ' + err.message, true);
  }
}

// ── Save numeric input via save button ────────────────────────────────────────
async function saveFromInput(dotPath, safeId, type) {
  const numEl = document.getElementById(safeId + '_num');
  if (!numEl) return;
  const value = type === 'float' ? parseFloat(numEl.value) : parseInt(numEl.value, 10);
  if (isNaN(value)) { showStatus('Invalid value', true); return; }

  const [domain, key] = dotPath.split('.');
  const btn = document.getElementById(safeId + '_btn');

  try {
    const res  = await fetch(`/api/settings/${domain}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unknown error');
    showStatus(`Saved: ${dotPath} = ${value}`);
    if (btn) {
      btn.textContent = 'saved ✓'; btn.classList.add('saved');
      setTimeout(() => { btn.textContent = 'save'; btn.classList.remove('saved'); }, 2000);
    }
    if (data.settings?.updatedAt) {
      document.getElementById('lastUpdated').textContent =
        'Last saved: ' + formatDate(data.settings.updatedAt);
    }
  } catch(err) {
    showStatus('Save failed: ' + err.message, true);
    if (btn) {
      btn.textContent = 'error'; btn.classList.add('error');
      setTimeout(() => { btn.textContent = 'save'; btn.classList.remove('error'); }, 3000);
    }
  }
}

// ── Reset all to defaults ─────────────────────────────────────────────────────
async function confirmReset() {
  if (!confirm('Reset ALL settings to defaults? This cannot be undone.')) return;
  try {
    const res  = await fetch('/api/settings/reset', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unknown error');
    showStatus('All settings reset to defaults.');
    await loadAll();
  } catch(err) {
    showStatus('Reset failed: ' + err.message, true);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadAll();
