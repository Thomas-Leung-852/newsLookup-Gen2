/* ============================================================
   collection.js — newsLookup Gen2
   All JavaScript for collection.html (My Clippings).
   Requires: common/common.js loaded first (provides esc()).
   ============================================================ */

// ── Thumbnail size (loaded from /api/settings/ui on init) ────────────────────
async function loadThumbnailSize() {
  try {
    const res  = await fetch('/api/settings/ui');
    const data = await res.json();
    const valid = ['small', 'medium', 'large', 'xlarge'];
    const size  = valid.includes(data?.thumbnailSize) ? data.thumbnailSize : 'medium';
    valid.forEach(v => document.body.classList.remove('thumb-' + v));
    document.body.classList.add('thumb-' + size);
  } catch (_) {
    document.body.classList.add('thumb-medium');
  }
}
loadThumbnailSize();

let allItems    = [];
let currentMode = 'all'; // 'all' | 'search'

// ── Similarity filter ─────────────────────────────────────────────────────────
let minSimilarity    = 40;
let lastSearchResults = [];

function updateSim(val) {
  minSimilarity = parseInt(val);
  document.getElementById('simVal').textContent = val + '%';
  if (currentMode === 'search') {
    renderItems(lastSearchResults.filter(i => (i.searchScore || 0) >= minSimilarity), true);
  } else {
    renderItems(filterItems(allItems));
  }
}

// ── Tag filter state ──────────────────────────────────────────────────────────
let activeTagFilters = [];
let tagFilterMode    = 'any'; // 'any' | 'all'

function setTagMode(mode) {
  tagFilterMode = mode;
  document.getElementById('tagModeAny').classList.toggle('active', mode === 'any');
  document.getElementById('tagModeAll').classList.toggle('active', mode === 'all');
  renderItems(filterItems(allItems));
}

function addTagFilter(tag) {
  const t = tag.trim().toLowerCase();
  if (!t || activeTagFilters.includes(t)) return;
  activeTagFilters.push(t);
  renderTagFilterChips();
  document.getElementById('tagFilterInput').value = '';
  closeTagFilterAC();
  renderItems(filterItems(allItems));
}

function removeTagFilter(tag) {
  activeTagFilters = activeTagFilters.filter(t => t !== tag);
  renderTagFilterChips();
  renderItems(filterItems(allItems));
}

function renderTagFilterChips() {
  document.getElementById('tagFilterChips').innerHTML = activeTagFilters.map(t =>
    `<span class="tag-filter-chip">
      ${esc(t)}
      <button class="tag-filter-chip-remove" onclick="removeTagFilter('${esc(t)}')" title="Remove">✕</button>
    </span>`
  ).join('');
}

// ── Tag filter autocomplete ───────────────────────────────────────────────────
function getAllTagsFromItems() {
  const set = new Set();
  allItems.forEach(item => {
    if (item.tags) {
      item.tags.split(',').forEach(t => {
        const trimmed = t.trim().toLowerCase();
        if (trimmed) set.add(trimmed);
      });
    }
  });
  return [...set].sort();
}

function onTagFilterInput() {
  const val     = document.getElementById('tagFilterInput').value.trim().toLowerCase();
  const matches = getAllTagsFromItems().filter(t => t.includes(val) && !activeTagFilters.includes(t));
  const ac      = document.getElementById('tagFilterAC');
  if (!val || !matches.length) { closeTagFilterAC(); return; }
  ac.innerHTML = matches.slice(0, 8).map(t =>
    `<div class="tag-filter-ac-item" onmousedown="addTagFilter('${esc(t)}')">${esc(t)}</div>`
  ).join('');
  ac.classList.add('open');
}

function onTagFilterKeydown(e) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const val = document.getElementById('tagFilterInput').value.trim();
    if (val) addTagFilter(val);
  }
  if (e.key === 'Escape') closeTagFilterAC();
}

function closeTagFilterAC() {
  document.getElementById('tagFilterAC').classList.remove('open');
}

document.addEventListener('click', e => {
  if (!e.target.closest('.tag-filter-input-wrap')) closeTagFilterAC();
});

// ── Load all items ────────────────────────────────────────────────────────────
async function loadAll() {
  currentMode = 'all';
  document.getElementById('modeLabel').textContent = '';
  try {
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo   = document.getElementById('dateTo').value;
    const params   = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo)   params.set('dateTo',   dateTo);
    const res  = await fetch('/api/collection?' + params.toString());
    const data = await res.json();
    allItems   = data.items || [];

    const regions = [...new Set(allItems.map(i => i.region).filter(Boolean))].sort();
    const rSel    = document.getElementById('regionFilter');
    const cur     = rSel.value;
    rSel.innerHTML = '<option value="">All regions</option>' +
      regions.map(r => `<option value="${r}"${r === cur ? ' selected' : ''}>${r}</option>`).join('');

    populateYearFilter(allItems);
    renderItems(filterItems(allItems));
    updateTotal(allItems.length);
  } catch(err) {
    showError('Failed to load collection: ' + err.message);
  }
}

// ── Filter ────────────────────────────────────────────────────────────────────
function filterItems(items) {
  const region = document.getElementById('regionFilter').value;
  const source = document.getElementById('sourceFilter').value.toLowerCase().trim();
  const topN   = parseInt(document.getElementById('topN').value);

  return items.filter(item => {
    if (region && item.region !== region) return false;
    if (source && !item.source?.toLowerCase().includes(source)) return false;

    if (activeTagFilters.length > 0) {
      const itemTags = item.tags
        ? item.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
        : [];
      if (tagFilterMode === 'any') {
        if (!activeTagFilters.some(ft => itemTags.includes(ft))) return false;
      } else {
        if (!activeTagFilters.every(ft => itemTags.includes(ft))) return false;
      }
    }
    return true;
  }).slice(0, topN);
}

// ── AI Search ─────────────────────────────────────────────────────────────────
async function doSearch() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) { loadAll(); return; }

  currentMode = 'search';
  document.getElementById('modeLabel').textContent = '🤖 AI search: "' + q + '"';
  document.getElementById('resultsCount').textContent = '⏳ Searching...';
  document.getElementById('resultsBody').innerHTML =
    '<div class="empty-state">⏳ Computing similarity scores...</div>';

  try {
    const topN = parseInt(document.getElementById('topN').value);
    const res  = await fetch('/api/collection/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, topN }),
    });
    const data = await res.json();
    if (data.error) { showError(data.error); return; }
    lastSearchResults = data.items;
    const simFiltered = data.items.filter(i => (i.searchScore || 0) >= minSimilarity);
    renderItems(simFiltered, true);
    document.getElementById('resultsCount').textContent =
      `${simFiltered.length} result${simFiltered.length !== 1 ? 's' : ''} (min ${minSimilarity}% match)`;
  } catch(err) {
    showError('Search failed: ' + err.message);
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderItems(items, isSearch = false) {
  const body = document.getElementById('resultsBody');
  document.getElementById('resultsCount').textContent =
    `${items.length} item${items.length !== 1 ? 's' : ''}`;

  if (!items.length) {
    body.innerHTML = '<div class="empty-state">📭 No items found.<br><br>' +
      (currentMode === 'search'
        ? 'Try a different query or lower your search terms.'
        : 'Save articles from the main search using the 🤖 Summarise button.') + '</div>';
    return;
  }

  body.innerHTML = items.map(item => {
    const scoreLabel = isSearch && item.searchScore
      ? `<span class="col-score" title="Similarity to your query">${item.searchScore}% match</span>`
      : '';
    const savedDate = item.savedAt ? new Date(item.savedAt).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }) : '';
    const pubDate    = item.pubDate ? fmtDate(item.pubDate) : '';
    const hasSummary = item.summary && item.summary.trim().length > 0;
    const tagBadges  = item.tags
      ? item.tags.split(',').map(t => t.trim()).filter(Boolean)
          .map(t => `<span class="col-badge tag">🏷 ${esc(t)}</span>`).join('')
      : '';
    const editorChipsHtml = buildEditorChipsHtml(item.id, item.tags || '');

    const thumbHtml = item.thumbnail
      ? `<img class="col-thumb" src="${esc(item.thumbnail)}" alt="" loading="lazy" onerror="this.remove()">`
      : '';

    return `<div class="col-card" id="card_${item.id}">
      <div class="col-card-header">
        ${scoreLabel}
        ${thumbHtml}
        <div class="col-title" style="flex:1">
          <a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a>
        </div>
      </div>
      <div class="col-meta" id="meta_${item.id}">
        <span class="col-badge source">${esc(item.source || '')}</span>
        <span class="col-badge">${esc(item.region || '')}</span>
        ${pubDate ? `<span class="col-badge">${pubDate}</span>` : ''}
        <span class="col-badge">saved ${savedDate}</span>
        ${tagBadges}
      </div>
      ${hasSummary
        ? `<div class="col-summary" id="summary_${item.id}">${parseSummary(item.summary).map(s => `<div class="col-summary-point">${esc(s)}</div>`).join('')}</div>`
        : ''}
      <div class="col-actions">
        ${hasSummary
          ? `<button class="col-btn" onclick="toggleSummary(${item.id})">📝 Summary</button>`
          : `<button class="col-btn" id="sum_${item.id}" onclick="summariseClipping(${item.id},'${esc(item.url)}','${esc(item.title).replace(/'/g, "\\'")}')">🤖 Summarise</button>`}
        <button class="col-btn${item.tags ? ' tag-active' : ''}" id="tagBtn_${item.id}" onclick="toggleTagEditor(${item.id})">🏷 Tags</button>
        <button class="col-btn del" onclick="deleteItem(${item.id})">✕ Remove</button>
      </div>
      <div class="tag-editor" id="tagEditor_${item.id}">
        <div class="tag-editor-chips" id="editorChips_${item.id}">${editorChipsHtml}</div>
        <button class="tag-suggest-btn" id="tagSuggestBtn_${item.id}" onclick="suggestTags(${item.id})">✨ Suggest Tags</button>
        <div class="tag-suggest-hint" id="tagSuggestHint_${item.id}" style="display:none"></div>
        <div class="tag-editor-row">
          <input class="tag-input" id="tagInput_${item.id}"
            placeholder="Add tag, press Enter or comma…"
            oninput="onTagEditorInput(${item.id})"
            onkeydown="onTagEditorKeydown(event,${item.id})"
            autocomplete="off"/>
          <button class="tag-save-btn" id="tagSaveBtn_${item.id}" onclick="saveTags(${item.id})">💾 Save</button>
          <div class="tag-autocomplete" id="tagAC_${item.id}"></div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Tag editor helpers ────────────────────────────────────────────────────────
const draftTags = {}; // itemId → string[]

function buildEditorChipsHtml(itemId, tagsStr) {
  const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
  draftTags[itemId] = [...tags];
  return tags.map(t => chipHtml(itemId, t)).join('');
}

function chipHtml(itemId, tag) {
  return `<span class="tag-chip" id="chip_${itemId}_${esc(tag)}">
    ${esc(tag)}
    <button class="tag-chip-remove" onclick="removeDraftTag(${itemId},'${esc(tag)}')" title="Remove tag">✕</button>
  </span>`;
}

function toggleTagEditor(itemId) {
  const editor = document.getElementById(`tagEditor_${itemId}`);
  const btn    = document.getElementById(`tagBtn_${itemId}`);
  const isOpen = editor.classList.toggle('open');
  btn.classList.toggle('tag-active', isOpen);
  if (isOpen) setTimeout(() => document.getElementById(`tagInput_${itemId}`)?.focus(), 50);
}

function removeDraftTag(itemId, tag) {
  if (!draftTags[itemId]) return;
  draftTags[itemId] = draftTags[itemId].filter(t => t !== tag);
  reRenderEditorChips(itemId);
}

function reRenderEditorChips(itemId) {
  const wrap = document.getElementById(`editorChips_${itemId}`);
  if (wrap) wrap.innerHTML = (draftTags[itemId] || []).map(t => chipHtml(itemId, t)).join('');
}

function addDraftTag(itemId, tag) {
  const t = tag.trim();
  if (!t) return;
  if (!draftTags[itemId]) draftTags[itemId] = [];
  if (!draftTags[itemId].includes(t)) {
    draftTags[itemId].push(t);
    reRenderEditorChips(itemId);
  }
  const inp = document.getElementById(`tagInput_${itemId}`);
  if (inp) inp.value = '';
  closeTagAC(itemId);
}

function onTagEditorKeydown(e, itemId) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const val = document.getElementById(`tagInput_${itemId}`)?.value.trim();
    if (val) addDraftTag(itemId, val);
  }
  if (e.key === 'Escape') closeTagAC(itemId);
}

function onTagEditorInput(itemId) {
  const val     = document.getElementById(`tagInput_${itemId}`)?.value.trim().toLowerCase();
  const current = draftTags[itemId] || [];
  const matches = getAllTagsFromItems().filter(t =>
    val && t.toLowerCase().includes(val) && !current.map(c => c.toLowerCase()).includes(t)
  );
  const ac = document.getElementById(`tagAC_${itemId}`);
  if (!ac) return;
  if (!val || !matches.length) { closeTagAC(itemId); return; }
  ac.innerHTML = matches.slice(0, 6).map(t =>
    `<div class="tag-ac-item" onmousedown="addDraftTag(${itemId},'${esc(t)}')">${esc(t)}</div>`
  ).join('');
  ac.classList.add('open');
}

function closeTagAC(itemId) {
  document.getElementById(`tagAC_${itemId}`)?.classList.remove('open');
}

// ── AI Tag Suggestion ─────────────────────────────────────────────────────────
async function suggestTags(itemId) {
  const btn    = document.getElementById(`tagSuggestBtn_${itemId}`);
  const hintEl = document.getElementById(`tagSuggestHint_${itemId}`);
  const item   = allItems.find(i => i.id === itemId);
  if (!item) return;

  btn.disabled    = true;
  btn.textContent = '⏳ Thinking…';
  hintEl.style.display = 'none';

  try {
    const res = await fetch('/api/collection/suggest-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:        item.title,
        summary:      item.summary  || '',
        source:       item.source   || '',
        region:       item.region   || '',
        existingTags: (draftTags[itemId] || []).join(', '),
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Server error');

    const current  = (draftTags[itemId] || []).map(t => t.toLowerCase());
    const filtered = (data.suggestions || []).filter(s => !current.includes(s.tag.toLowerCase()));

    if (!filtered.length) {
      hintEl.textContent   = '✓ No new tags to suggest';
      hintEl.style.display = 'block';
      btn.disabled    = false;
      btn.textContent = '✨ Suggest Tags';
      return;
    }

    filtered.forEach(s => {
      if (!draftTags[itemId]) draftTags[itemId] = [];
      if (!draftTags[itemId].includes(s.tag)) draftTags[itemId].push(s.tag);
    });
    reRenderEditorChips(itemId);

    hintEl.textContent   = `✨ Added ${filtered.length} tag${filtered.length !== 1 ? 's' : ''}: ${filtered.map(s => s.tag + ' (' + s.score + '%)').join(', ')} — click 💾 Save to apply`;
    hintEl.style.display = 'block';
    btn.disabled    = false;
    btn.textContent = '✨ Suggest Tags';
  } catch(err) {
    hintEl.textContent   = '❌ Suggestion failed: ' + err.message;
    hintEl.style.display = 'block';
    btn.disabled    = false;
    btn.textContent = '✨ Suggest Tags';
  }
}

// ── Save tags ─────────────────────────────────────────────────────────────────
async function saveTags(itemId) {
  const btn  = document.getElementById(`tagSaveBtn_${itemId}`);
  const tags = (draftTags[itemId] || []).join(', ');
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }

  try {
    const res  = await fetch(`/api/collection/${itemId}/tags`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed');

    const idx = allItems.findIndex(i => i.id === itemId);
    if (idx !== -1) allItems[idx].tags = data.tags || '';
    refreshMetaTags(itemId, data.tags || '');
    document.getElementById(`tagBtn_${itemId}`)?.classList.toggle('tag-active', !!data.tags);

    if (btn) { btn.textContent = '✅ Saved'; btn.disabled = false; }
    setTimeout(() => {
      if (btn) btn.textContent = '💾 Save';
      document.getElementById(`tagEditor_${itemId}`)?.classList.remove('open');
    }, 1000);
  } catch(err) {
    if (btn) { btn.textContent = '❌ Error'; btn.disabled = false; }
    setTimeout(() => { if (btn) btn.textContent = '💾 Save'; }, 2000);
  }
}

function refreshMetaTags(itemId, tagsStr) {
  const meta = document.getElementById(`meta_${itemId}`);
  if (!meta) return;
  meta.querySelectorAll('.col-badge.tag').forEach(el => el.remove());
  if (tagsStr) {
    tagsStr.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
      const span = document.createElement('span');
      span.className   = 'col-badge tag';
      span.textContent = '🏷 ' + t;
      meta.appendChild(span);
    });
  }
}

// ── Misc helpers ──────────────────────────────────────────────────────────────
function toggleSummary(id) {
  document.getElementById('summary_' + id)?.classList.toggle('open');
}

async function deleteItem(id) {
  if (!confirm('Remove this item from your collection?')) return;
  try {
    await fetch('/api/collection/' + id, { method: 'DELETE' });
    document.getElementById('card_' + id)?.remove();
    allItems = allItems.filter(i => i.id !== id);
    delete draftTags[id];
    updateTotal(allItems.length);
    document.getElementById('resultsCount').textContent =
      document.querySelectorAll('.col-card').length + ' items';
  } catch(err) { alert('Delete failed: ' + err.message); }
}

async function clearAll() {
  if (!confirm('Clear your ENTIRE collection?\n\nThis cannot be undone.')) return;
  try {
    await fetch('/api/collection', { method: 'DELETE' });
    allItems = [];
    renderItems([]);
    updateTotal(0);
  } catch(err) { alert('Failed: ' + err.message); }
}

function updateTotal(n) {
  document.getElementById('totalBadge').textContent = n + ' item' + (n !== 1 ? 's' : '') + ' saved';
}

function showError(msg) {
  document.getElementById('resultsBody').innerHTML =
    `<div class="empty-state" style="color:var(--danger)">❌ ${esc(msg)}</div>`;
}

function fmtDate(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d)) return String(raw).slice(0, 16);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function parseSummary(raw) {
  let clean = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
  if (/[▶▸►•]/.test(clean) && clean.split(/\r?\n/).length <= 2) {
    clean = clean.replace(/[▶▸►•]/g, '\n');
  }
  const results = [];
  for (const line of clean.split(/\r?\n/)) {
    const stripped = line.replace(/^[\s\u200b\u00a0]*([▶▸►•\-\*]|\d+[\.\)])\s*/, '').trim();
    const text = stripped || line.trim();
    if (text.replace(/[\s\u200b\u00a0\r]/g, '').length >= 3) results.push(text);
  }
  return results;
}

// ── Summarise from Clippings ──────────────────────────────────────────────────
async function summariseClipping(id, url, title) {
  const btn = document.getElementById('sum_' + id);
  if (!btn) return;
  btn.textContent = '⏳'; btn.disabled = true;

  try {
    const res  = await fetch('/api/summarise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, link: url }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    await fetch('/api/collection/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, summary: data.summary }),
    });

    btn.textContent = '✅'; btn.title = 'Summary saved! Reload to view.';

    const card = document.getElementById('card_' + id);
    if (card) {
      const fmtSummary = s => parseSummary(s).map(p => `<div class="col-summary-point">${esc(p)}</div>`).join('');
      const existing   = card.querySelector('.col-summary');
      if (existing) {
        existing.innerHTML = fmtSummary(data.summary);
        existing.classList.add('open');
      } else {
        const div = document.createElement('div');
        div.className = 'col-summary open';
        div.innerHTML = fmtSummary(data.summary);
        card.querySelector('.col-actions').before(div);
      }
    }
  } catch(err) {
    btn.textContent = '❌'; btn.title = 'Error: ' + err.message; btn.disabled = false;
  }
}

// ── Panel toggle (mobile) ─────────────────────────────────────────────────────
function togglePanel() {
  const panel = document.querySelector('.left-panel');
  const btn   = document.getElementById('panelToggle');
  const open  = panel.classList.toggle('open');
  btn.textContent = open ? '✕ Filters' : '☰ Filters';
}

// ── Export ────────────────────────────────────────────────────────────────────
function populateYearFilter(items) {
  const years = [...new Set(
    items.map(i => i.savedAt ? new Date(i.savedAt).getFullYear() : null).filter(Boolean)
  )].sort((a, b) => b - a);
  document.getElementById('exportYear').innerHTML =
    '<option value="">All Years</option>' +
    years.map(y => `<option value="${y}">${y}</option>`).join('');
}

async function exportCollection() {
  const year = document.getElementById('exportYear').value;
  const btn  = document.querySelector('.export-btn');
  btn.disabled = true; btn.textContent = '⏳';

  try {
    const res  = await fetch('/api/collection');
    const data = await res.json();
    let items  = data.items || data;
    if (year) items = items.filter(i => i.savedAt && new Date(i.savedAt).getFullYear() === parseInt(year));

    const filename = year ? `collection-${year}.json` : 'collection-all.json';
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);

    btn.textContent = `✅ ${items.length} exported`;
    setTimeout(() => { btn.textContent = '⬇ Export'; btn.disabled = false; }, 2500);
  } catch(err) {
    btn.textContent = '❌ Error'; btn.disabled = false;
    setTimeout(() => { btn.textContent = '⬇ Export'; }, 2000);
  }
}

// ── Import ────────────────────────────────────────────────────────────────────
async function importCollection(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  const importBtn  = document.querySelector('.import-btn');
  const progressEl = document.getElementById('importProgress');
  const barEl      = document.getElementById('importProgressBar');
  const textEl     = document.getElementById('importProgressText');

  let items;
  try {
    items = JSON.parse(await file.text());
    if (!Array.isArray(items)) throw new Error('Invalid format');
  } catch(err) { alert('❌ Could not read file: ' + err.message); return; }

  let existingUrls = new Set();
  try {
    const res  = await fetch('/api/collection');
    const data = await res.json();
    (data.items || data).forEach(i => existingUrls.add(i.url));
  } catch(err) { alert('❌ Could not load existing collection: ' + err.message); return; }

  const toImport = items.filter(i => i.url && !existingUrls.has(i.url));
  const skipped  = items.length - toImport.length;

  if (!toImport.length) {
    alert(`ℹ️ Nothing to import.\n\n${skipped} item${skipped !== 1 ? 's' : ''} already exist.`);
    return;
  }

  importBtn.disabled = true;
  progressEl.style.display = 'block';
  barEl.style.width = '0%'; barEl.style.background = 'var(--accent)';

  let imported = 0, failed = 0;
  const importedItems = [];

  for (let i = 0; i < toImport.length; i++) {
    const item = toImport[i];
    barEl.style.width  = Math.round(((i + 1) / toImport.length) * 50) + '%';
    textEl.textContent = `Importing… ${i + 1} / ${toImport.length}`;

    try {
      const res = await fetch('/api/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newsId: item.newsId || undefined, url: item.url, title: item.title,
          summary: item.summary || '', score: item.score ?? null,
          threshold: item.threshold ?? null, source: item.source || '',
          region: item.region || '', pubDate: item.pubDate || '', tags: item.tags || null,
        }),
      });
      if (!res.ok) throw new Error();
      imported++; importedItems.push(item);
    } catch { failed++; }
  }

  loadAll();

  if (!imported) {
    progressEl.style.display = 'none'; importBtn.disabled = false;
    alert(`❌ Import failed — ${failed} item${failed !== 1 ? 's' : ''} could not be saved.`);
    return;
  }

  textEl.textContent = `✅ ${imported} imported — building search index…`;
  barEl.style.width = '50%'; barEl.style.background = 'var(--accent2)';

  await reEmbedItems(importedItems);
  importBtn.disabled = false;

  if (skipped || failed) {
    alert([
      skipped ? `• ${skipped} skipped (already exist)` : null,
      failed  ? `• ${failed} failed to save`           : null,
    ].filter(Boolean).join('\n'));
  }
}

// ── Re-embed missing vectors ──────────────────────────────────────────────────
async function checkUnembedded() {
  try {
    const res  = await fetch('/api/collection/unembedded');
    if (!res.ok) return;
    const data  = await res.json();
    const items = data.items || [];
    if (!items.length) return;
    if (confirm(`⚠️ ${items.length} item${items.length !== 1 ? 's are' : ' is'} missing search vectors.\n\nRe-create now?`)) {
      await reEmbedItems(items);
    }
  } catch { /* silent */ }
}

async function reEmbedItems(items) {
  const progressEl = document.getElementById('importProgress');
  const barEl      = document.getElementById('importProgressBar');
  const textEl     = document.getElementById('importProgressText');

  progressEl.style.display = 'block';
  barEl.style.background   = 'var(--accent2)';
  barEl.style.width        = '0%';

  let embedded = 0, embedFailed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    barEl.style.width  = Math.round(((i + 1) / items.length) * 100) + '%';
    textEl.textContent = `Re-embedding ${i + 1} / ${items.length}…`;
    try {
      const res = await fetch('/api/collection/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newsId: item.newsId, title: item.title, url: item.url }),
      });
      if (!res.ok) throw new Error();
      embedded++;
    } catch { embedFailed++; }
  }

  setTimeout(() => {
    progressEl.style.display = 'none'; barEl.style.width = '0%';
    alert([
      `✅ ${embedded} item${embedded !== 1 ? 's' : ''} ready for semantic search`,
      embedFailed ? `• ${embedFailed} failed — try again later` : null,
    ].filter(Boolean).join('\n'));
  }, 400);
}

// ── Init ──────────────────────────────────────────────────────────────────────
(function setDefaultDateRange() {
  const fmt   = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = new Date();
  const from  = new Date(); from.setDate(today.getDate() - 14);
  document.getElementById('dateFrom').value = fmt(from);
  document.getElementById('dateTo').value   = fmt(today);
})();

loadAll();
checkUnembedded();
