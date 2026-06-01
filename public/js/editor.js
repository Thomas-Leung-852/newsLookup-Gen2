/* ============================================================
   editor.js — newsLookup Gen2
   All JavaScript for editor.html (RSS Site Editor).
   Requires: common/common.js loaded first (provides esc()).
   ============================================================ */

let sites    = [];   // full array from server
let filtered = [];   // currently shown in list
let activeIdx = -1;  // index in `sites` of selected row (-1 = new)
let isDirty   = false;

// ── Find Duplicates ───────────────────────────────────────────────────────────
function findDuplicates() {
  const urlMap = {};
  sites.forEach((site, idx) => {
    const key = site.rss.trim().toLowerCase().replace(/\/+$/, '');
    if (!urlMap[key]) urlMap[key] = [];
    urlMap[key].push({ site, idx });
  });

  const dupGroups = Object.entries(urlMap).filter(([, group]) => group.length > 1);
  document.getElementById('dupOverlay').classList.add('open');

  if (!dupGroups.length) {
    document.getElementById('dupTitle').textContent = '✅ No Duplicates Found';
    document.getElementById('dupBody').innerHTML =
      '<div style="padding:40px;text-align:center;color:var(--accent);font-family:IBM Plex Mono,monospace;font-size:13px">' +
      '✅ All RSS feed URLs are unique.<br><br>' +
      '<span style="font-size:11px;color:var(--muted)">Checked ' + sites.length + ' sites — no duplicates detected.</span></div>';
    document.getElementById('dupStats').textContent = sites.length + ' sites checked · 0 duplicates';
    return;
  }

  const totalDups = dupGroups.reduce((sum, [, g]) => sum + g.length, 0);
  document.getElementById('dupTitle').textContent =
    '⚠️ Found ' + dupGroups.length + ' duplicated URL' + (dupGroups.length > 1 ? 's' : '');
  document.getElementById('dupStats').textContent =
    dupGroups.length + ' duplicate group' + (dupGroups.length > 1 ? 's' : '') + ' · ' + totalDups + ' affected sites';

  document.getElementById('dupBody').innerHTML = dupGroups.map(([url, group]) => {
    const rows = group.map(({ site, idx }) =>
      '<div class="dup-row">' +
      '<span class="dup-name">'   + esc(site.name)   + '</span>' +
      '<span class="dup-region">' + esc(site.region) + '</span>' +
      '<button class="dup-edit-btn" onclick="dupEdit('   + idx + ')">✎ Edit</button>' +
      '<button class="dup-del-btn"  onclick="dupDelete(' + idx + ')">✕ Delete</button>' +
      '</div>'
    ).join('');
    return '<div class="dup-group">' +
      '<div class="dup-group-header">🔗 ' + esc(url) + '</div>' +
      rows + '</div>';
  }).join('');
}

async function dupDelete(realIdx) {
  const site = sites[realIdx];
  if (!confirm('Delete "' + site.name + '"?\n\nThis will remove it from rss-sites.json immediately.')) return;
  sites.splice(realIdx, 1);
  await saveToServer();
  renderList();
  updateCount();
  showToast('✅ "' + site.name + '" deleted.');
  findDuplicates();
}

function dupEdit(realIdx) {
  closeDupOverlay();
  selectSite(realIdx);
}

function closeDupModal(e) {
  if (e.target === document.getElementById('dupOverlay')) closeDupOverlay();
}
function closeDupOverlay() {
  document.getElementById('dupOverlay').classList.remove('open');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDupOverlay(); });

// ── Fetch & init ──────────────────────────────────────────────────────────────
async function loadSites() {
  const res = await fetch('/api/sites');
  sites = await res.json();
  refreshRegionOptions();
  renderList();
  updateCount();
}

function refreshRegionOptions() {
  const regions = [...new Set(sites.map(s => s.region))].sort();
  document.getElementById('regionOptions').innerHTML =
    regions.map(r => `<option value="${r}">`).join('');
  const sel = document.getElementById('regionFilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All Regions</option>' +
    regions.map(r => `<option value="${r}"${r === cur ? ' selected' : ''}>${r}</option>`).join('');
}

function updateCount() {
  document.getElementById('siteCount').textContent =
    `${sites.length} site${sites.length !== 1 ? 's' : ''}`;
}

// ── Render left list ──────────────────────────────────────────────────────────
function renderList() {
  const q      = document.getElementById('searchInput').value.toLowerCase();
  const region = document.getElementById('regionFilter').value;

  filtered = sites.filter(s =>
    (!region || s.region === region) &&
    (!q      || s.name.toLowerCase().includes(q))
  );

  const list = document.getElementById('siteList');
  if (!filtered.length) {
    list.innerHTML = '<div style="padding:14px;color:var(--muted);font-size:12px;font-family:IBM Plex Mono,monospace">No sites found</div>';
    return;
  }

  list.innerHTML = filtered.map(s => {
    const realIdx  = sites.indexOf(s);
    const isActive = realIdx === activeIdx;
    return `<div class="site-row${isActive ? ' active' : ''}" onclick="selectSite(${realIdx})">
      <span class="sname">${esc(s.name)}</span>
      <span class="sregion">${esc(s.region)}</span>
    </div>`;
  }).join('');
}

// ── Select a site ─────────────────────────────────────────────────────────────
function selectSite(realIdx) {
  if (isDirty && !confirmLeave()) return;
  activeIdx = realIdx;
  isDirty   = false;
  renderList();
  renderForm(sites[realIdx]);
  document.getElementById('btnDelete').disabled = false;
}

// ── New Site ──────────────────────────────────────────────────────────────────
function newSite() {
  if (isDirty && !confirmLeave()) return;
  activeIdx = -1; isDirty = false;
  renderList();
  renderForm(null);
  document.getElementById('btnDelete').disabled = true;
}

// ── Delete Site ───────────────────────────────────────────────────────────────
async function deleteSite() {
  if (activeIdx < 0) return;
  const site = sites[activeIdx];
  if (!confirm(`Delete "${site.name}"?\n\nThis will remove it from rss-sites.json immediately.`)) return;
  sites.splice(activeIdx, 1);
  await saveToServer();
  activeIdx = -1; isDirty = false;
  renderList();
  showEmpty();
  document.getElementById('btnDelete').disabled = true;
}

// ── Render right form ─────────────────────────────────────────────────────────
function renderForm(site) {
  const v = site || { name: '', rss: '', region: '' };
  document.getElementById('rightPanel').innerHTML = `
    <div class="right-title">${site ? 'Edit Site' : 'New Site'}</div>
    <div class="fields-area">
      <div class="field-group">
        <label>Display Name *</label>
        <input id="f_name" value="${esc(v.name)}" placeholder="e.g. SCMP" oninput="markDirty()"/>
      </div>
      <div class="field-group">
        <label>RSS Feed URL *</label>
        <input id="f_rss" value="${esc(v.rss)}" placeholder="https://example.com/rss.xml" oninput="markDirty()"/>
        <span class="hint">The RSS or Atom feed URL used for fetching articles.</span>
      </div>
      <div class="field-group">
        <label>Region *</label>
        <input id="f_region" value="${esc(v.region)}" placeholder="e.g. HK, Asia, International, Tech"
          list="regionOptions" autocomplete="off" oninput="markDirty()"/>
        <span class="hint">Type to see existing regions, or enter a new one.</span>
      </div>
      <div id="testResult" class="test-result"></div>
    </div>
    <div class="right-actions">
      <button class="btn success" onclick="saveSite()">💾 Save</button>
      <button class="btn"         onclick="clearFields()">⌫ Clear</button>
      <button class="btn"         onclick="testRSS()">🔗 Test RSS</button>
      <span class="dirty-badge" id="dirtyBadge">● unsaved</span>
    </div>`;
}

function showEmpty() {
  document.getElementById('rightPanel').innerHTML =
    '<div class="empty-hint">← Select a site to edit<br>or click ＋ New Site</div>';
}

// ── Dirty tracking ────────────────────────────────────────────────────────────
function markDirty() {
  isDirty = true;
  const b = document.getElementById('dirtyBadge');
  if (b) b.style.display = 'inline';
}

function confirmLeave() {
  return confirm('You have unsaved changes.\n\nAre you sure you want to leave without saving?');
}

window.addEventListener('beforeunload', e => {
  if (isDirty) { e.preventDefault(); e.returnValue = ''; }
});

// ── Clear fields ──────────────────────────────────────────────────────────────
function clearFields() {
  ['f_name', 'f_rss', 'f_region'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const tr = document.getElementById('testResult');
  if (tr) { tr.style.display = 'none'; tr.textContent = ''; }
  markDirty();
}

// ── Save site ─────────────────────────────────────────────────────────────────
async function saveSite() {
  const name   = (document.getElementById('f_name')?.value   || '').trim();
  const rss    = (document.getElementById('f_rss')?.value    || '').trim();
  const region = (document.getElementById('f_region')?.value || '').trim();

  if (!name)   { alert('⚠️ Display Name is required.'); return; }
  if (!rss)    { alert('⚠️ RSS Feed URL is required.'); return; }
  if (!region) { alert('⚠️ Region is required.'); return; }

  const record = { name, rss, region };

  if (activeIdx >= 0) {
    sites[activeIdx] = record;
  } else {
    if (sites.find(s => s.name.toLowerCase() === name.toLowerCase())) {
      alert(`⚠️ A site named "${name}" already exists.`); return;
    }
    sites.push(record);
  }

  await saveToServer();
  activeIdx = sites.findIndex(s => s.name === name);
  isDirty   = false;
  const b = document.getElementById('dirtyBadge');
  if (b) b.style.display = 'none';
  refreshRegionOptions();
  renderList();
  updateCount();
  showToast(`✅ "${name}" saved.`);
}

// ── Write to server ───────────────────────────────────────────────────────────
async function saveToServer() {
  const res = await fetch('/api/sites', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sites),
  });
  if (!res.ok) {
    const err = await res.json();
    alert('❌ Save failed: ' + err.error);
    throw new Error(err.error);
  }
  const fresh = await fetch('/api/sites');
  sites = await fresh.json();
}

// ── Test RSS ──────────────────────────────────────────────────────────────────
async function testRSS() {
  const rss = (document.getElementById('f_rss')?.value || '').trim();
  const tr  = document.getElementById('testResult');
  if (!rss) { alert('⚠️ Enter an RSS URL first.'); return; }

  tr.style.display = 'block';
  tr.className     = 'test-result';
  tr.innerHTML     = '<div class="test-status">⏳ Testing…</div>';

  try {
    const res  = await fetch(`/api/test-rss?url=${encodeURIComponent(rss)}`);
    const data = await res.json();

    let statusHtml = '';
    if      (data.status === 200) { tr.className = 'test-result ok';   statusHtml = `✅ ${data.status} OK — Feed is reachable! (${data.articles.length} articles fetched)`; }
    else if (data.status === 403) { tr.className = 'test-result warn';  statusHtml = `⚠️ ${data.status} Forbidden — Site blocks bots. May still work in the app.`; }
    else if (data.status === 404) { tr.className = 'test-result fail';  statusHtml = `❌ ${data.status} Not Found — Check the RSS URL.`; }
    else if (data.status === 0)   { tr.className = 'test-result fail';  statusHtml = `❌ Connection error — ${data.statusText}`; }
    else                          { tr.className = 'test-result warn';  statusHtml = `⚠️ ${data.status} ${data.statusText}`; }

    function fmtDate(raw) {
      if (!raw) return { label: '', stale: false };
      const d = new Date(raw);
      if (isNaN(d)) return { label: String(raw).slice(0, 16), stale: false };
      const ageDays = Math.floor((Date.now() - d.getTime()) / 86400000);
      const stale   = ageDays > 90;
      let label;
      if      (ageDays === 0) label = 'today';
      else if (ageDays === 1) label = 'yesterday';
      else if (ageDays < 30)  label = ageDays + 'd ago';
      else if (ageDays < 365) label = Math.floor(ageDays / 30) + 'mo ago';
      else                    label = Math.floor(ageDays / 365) + 'yr ago ⚠️';
      return { label, stale };
    }

    let feedHtml = data.feedUpdated
      ? (() => {
          const { label, stale } = fmtDate(data.feedUpdated);
          return `<div class="feed-updated ${stale ? 'stale' : 'ok'}">
            ${stale ? '⚠️' : '🕐'} Feed last updated: ${esc(label)} &nbsp;·&nbsp;
            <span style="color:var(--muted)">${esc(String(data.feedUpdated).slice(0, 25))}</span>
          </div>`;
        })()
      : `<div class="feed-updated unknown">🕐 Feed update date: not provided by this feed</div>`;

    let articlesHtml = '';
    if (data.articles?.length) {
      articlesHtml = '<div class="test-articles">' +
        data.articles.map((a, i) => {
          const { label, stale } = fmtDate(a.pubDate);
          const dateCell = label
            ? `<span class="test-article-date ${stale ? 'stale' : ''}">${esc(label)}</span>`
            : '';
          return `<div class="test-article-row">
            <span class="test-article-num">${i + 1}.</span>
            <a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.title)}</a>
            ${dateCell}
          </div>`;
        }).join('') + '</div>';
    }

    tr.innerHTML = `<div class="test-status">${statusHtml}</div>${feedHtml}${articlesHtml}`;

  } catch(err) {
    tr.className = 'test-result fail';
    tr.innerHTML = `<div class="test-status">❌ Request failed — ${esc(err.message)}</div>`;
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:24px;right:24px;
    background:#0f2a1a;border:1px solid var(--accent);color:var(--accent);
    font-family:'IBM Plex Mono',monospace;font-size:12px;
    padding:10px 18px;border-radius:7px;z-index:999;`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ── Panel Toggle (mobile) ─────────────────────────────────────────────────────
function togglePanel() {
  const panel = document.querySelector('.left-panel');
  const btn   = document.getElementById('panelToggle');
  const open  = panel.classList.toggle('open');
  btn.textContent = open ? '✕ Sites' : '☰ Sites';
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadSites();
