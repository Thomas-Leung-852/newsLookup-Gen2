/* ============================================================
   index.js — newsLookup Gen2
   All JavaScript for index.html (main search UI).
   Requires: common/common.js loaded first (provides esc()).
   ============================================================ */

// ── App Info (update APP_VERSION on every release) ──────────────────────────
const APP_VERSION = '1.4.0';
const APP_DESCRIPTION = 'An AI-powered news search engine that finds, summarizes, and saves articles matching your interests.';

// ── State ─────────────────────────────────────────────────────────────────────
let currentResults = [];
let sortCol = 'score';   // default sort by score
let sortDir = -1;        // -1 = desc, 1 = asc
let isSearching = false;
let activeFilter = 'today';
let similarityThreshold = 0.50;
let searchHistory = JSON.parse(sessionStorage.getItem('nlg2_history') || '[]');
let historyIndex  = -1;   // -1 = not browsing history
let currentDraft  = '';   // saves what user was typing before browsing history
let sessionHistory = []; // short-term memory — cleared on tab close
let startTime = null;
let searchId = 0; // unique ID per search to avoid DOM ID conflicts
let timerInterval = null;
let articlesProcessed = 0;
let showThumbnails = sessionStorage.getItem('nlg2_showThumbs') !== 'off'; // default: shown

function applyThumbToggleUI() {
  const btn = document.getElementById('thumbToggleBtn');
  document.body.classList.toggle('thumbs-off', !showThumbnails);
  if (btn) {
    btn.classList.toggle('active', showThumbnails);
    btn.classList.toggle('inactive', !showThumbnails);
    btn.textContent = showThumbnails ? '🖼️ Thumbnails' : '🖼️ Thumbnails: off';
  }
}

function applyThumbSize(size) {
  const valid = ['small', 'medium', 'large', 'xlarge'];
  const s = valid.includes(size) ? size : 'medium';
  valid.forEach(v => document.body.classList.remove('thumb-' + v));
  document.body.classList.add('thumb-' + s);
}

async function loadThumbnailSize() {
  try {
    const res  = await fetch('/api/settings/ui');
    const data = await res.json();
    applyThumbSize(data?.thumbnailSize || 'medium');
  } catch (e) {
    applyThumbSize('medium');
  }
}

function toggleThumbnails() {
  showThumbnails = !showThumbnails;
  sessionStorage.setItem('nlg2_showThumbs', showThumbnails ? 'on' : 'off');
  applyThumbToggleUI();
}

function thumbImg(url, cls) {
  if (!url) return '';
  return '<img class="' + cls + '" src="' + esc(url) + '" alt="" loading="lazy" onerror="this.remove()">';
}

applyThumbToggleUI();
loadThumbnailSize();
loadPreviewCapNotice();

async function loadPreviewCapNotice() {
  try {
    const res  = await fetch('/api/settings/rss');
    const data = await res.json();
    const cap  = data?.maxArticlesPerFeed || 200;
    document.getElementById('previewCapNotice').textContent =
      'Showing up to ' + cap + ' articles per feed — raise this in Settings → RSS if a source looks cut off';
  } catch (e) {
    document.getElementById('previewCapNotice').textContent =
      'Note: each feed is capped to a configurable number of articles — see Settings → RSS';
  }
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return m + 'm ' + (s % 60) + 's';
  return s + 's';
}

// ── Preview ───────────────────────────────────────────────────────────────────
async function previewSelected() {
  const checked = [...document.querySelectorAll('#siteList input:checked')];
  if (checked.length === 0) {
    alert('Please select at least one site to preview.');
    return;
  }
  if (checked.length > 15) {
    alert('Too many sites selected (' + checked.length + ').\n\nPlease select 20 or fewer sites for preview.\nTip: use the region filter to narrow down.');
    return;
  }
  const names = checked.map(cb => cb.value);
  const targets = allSites.filter(s => names.includes(s.name));

  document.getElementById('previewTitle').textContent = 'Loading ' + names.length + ' site' + (names.length > 1 ? 's' : '') + '...';
  document.getElementById('previewBody').innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);font-family:IBM Plex Mono,monospace;font-size:12px">Fetching headlines…</div>';
  document.getElementById('previewStats').textContent = '';
  document.getElementById('previewOverlay').classList.add('open');

  let totalArticles = 0;
  const blocks = await Promise.all(targets.map(async site => {
    try {
      const res  = await fetch('/api/test-rss?url=' + encodeURIComponent(site.rss));
      const data = await res.json();
      if (!data.ok || !data.articles || !data.articles.length) return null;
      totalArticles += data.articles.length;
      return { site, articles: data.articles };
    } catch(e) { return null; }
  }));

  const valid = blocks.filter(Boolean);
  if (!valid.length) {
    document.getElementById('previewBody').innerHTML =
      '<div style="padding:30px;text-align:center;color:var(--danger);font-family:IBM Plex Mono,monospace;font-size:12px">No articles could be fetched. Check your RSS feeds.</div>';
    document.getElementById('previewTitle').textContent = 'Preview — no results';
    return;
  }

  const html = valid.map(function(block) {
    const rows = block.articles.map(function(a, i) {
      const d = a.pubDate ? new Date(a.pubDate) : null;
      let dateLabel = '';
      if (d && !isNaN(d)) {
        const days = Math.floor((Date.now() - d) / 86400000);
        if (days === 0) dateLabel = 'today';
        else if (days === 1) dateLabel = 'yesterday';
        else if (days < 30) dateLabel = days + 'd ago';
        else if (days < 365) dateLabel = Math.floor(days/30) + 'mo ago';
        else dateLabel = Math.floor(days/365) + 'yr ago';
      }
      const clipData = JSON.stringify({title:a.title,link:a.link,pubDate:a.pubDate||'',source:block.site.name,region:block.site.region,thumbnail:a.thumbnail||null});
      return '<div class="preview-article"><span class="preview-article-num">' + (i+1) + '.</span>' +
        thumbImg(a.thumbnail, 'preview-article-thumb') +
        '<a href="' + esc(a.link) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a>' +
        (dateLabel ? '<span class="preview-article-date">' + dateLabel + '</span>' : '') +
        '<button class="clip-btn" title="Add to My Clippings" onclick="clipArticle(this,decodeURIComponent(\'' + encodeURIComponent(clipData) + '\'))">✂️</button>' +
        '</div>';
    }).join('');
    return '<div class="preview-site-block">' +
      '<div class="preview-site-name">' + esc(block.site.name) +
      '<span class="preview-site-region">' + esc(block.site.region) + '</span>' +
      '<span style="color:var(--muted);font-size:10px;margin-left:auto">' + block.articles.length + ' articles</span>' +
      '</div>' + rows + '</div>';
  }).join('');

  document.getElementById('previewTitle').textContent = 'News Preview — ' + valid.length + ' site' + (valid.length > 1 ? 's' : '');
  document.getElementById('previewBody').innerHTML = html;
  document.getElementById('previewStats').textContent = valid.length + ' site' + (valid.length > 1 ? 's' : '') + ' · ' + totalArticles + ' articles';
}

function closePreview(e) {
  if (e.target === document.getElementById('previewOverlay')) closePreviewModal();
}
function closePreviewModal() {
  document.getElementById('previewOverlay').classList.remove('open');
}
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closePreviewModal(); });

// ── Date helpers ──────────────────────────────────────────────────────────────
function isToday(pubDate) {
  if (!pubDate) return false;
  const d   = new Date(pubDate);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth()    === now.getMonth()    &&
         d.getDate()     === now.getDate();
}

// ── Yesterday Preview ─────────────────────────────────────────────────────────
async function yesterdayPreview() {
  const checked = [...document.querySelectorAll('#siteList input:checked')];
  if (checked.length === 0) { alert('Please select at least one site.'); return; }
  if (checked.length > 20) { alert('Too many sites selected (' + checked.length + ').\n\nPlease select 20 or fewer sites.'); return; }

  const names   = checked.map(cb => cb.value);
  const targets = allSites.filter(s => names.includes(s.name));
  const now     = new Date();
  const yest    = new Date(now); yest.setDate(yest.getDate() - 1);
  const yLabel  = yest.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  document.getElementById('previewTitle').textContent = '📰 Yesterday — ' + yLabel;
  document.getElementById('previewBody').innerHTML    = '<div style="padding:30px;text-align:center;color:var(--muted);font-family:IBM Plex Mono,monospace;font-size:12px">⏳ Fetching yesterday\'s headlines…</div>';
  document.getElementById('previewStats').textContent = '';
  document.getElementById('previewOverlay').classList.add('open');

  let totalFetched = 0, totalMatch = 0;
  const yLocal = yest.getFullYear() + '-' + String(yest.getMonth()+1).padStart(2,'0') + '-' + String(yest.getDate()).padStart(2,'0');
  const tzOffsetMs = now.getTimezoneOffset() * -60000;

  const blocks = await Promise.all(targets.map(async site => {
    try {
      const res  = await fetch('/api/test-rss?url=' + encodeURIComponent(site.rss));
      const data = await res.json();
      if (!data.ok || !data.articles?.length) return null;
      totalFetched += data.articles.length;
      const matched = data.articles.filter(a => {
        if (!a.pubDate) return false;
        const d = new Date(new Date(a.pubDate).getTime() + tzOffsetMs);
        const local = d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0');
        return local === yLocal;
      });
      totalMatch += matched.length;
      return matched.length ? { site, articles: matched } : null;
    } catch { return null; }
  }));

  const valid = blocks.filter(Boolean);
  if (!valid.length) {
    document.getElementById('previewBody').innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);font-family:IBM Plex Mono,monospace;font-size:12px">📭 No articles from yesterday found.</div>';
    document.getElementById('previewStats').textContent = '0 yesterday from ' + totalFetched + ' fetched';
    return;
  }

  const html = valid.map(function(block) {
    const rows = block.articles.map(function(a, i) {
      const t = a.pubDate ? new Date(a.pubDate).toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' }) : '';
      const clipData = JSON.stringify({title:a.title,link:a.link,pubDate:a.pubDate||'',source:block.site.name,region:block.site.region,thumbnail:a.thumbnail||null});
      return '<div class="preview-article"><span class="preview-article-num">' + (i+1) + '.</span>' +
        thumbImg(a.thumbnail, 'preview-article-thumb') +
        '<a href="' + esc(a.link) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a>' +
        (t ? '<span class="preview-article-date">' + t + '</span>' : '') +
        '<button class="clip-btn" title="Add to My Clippings" onclick="clipArticle(this,decodeURIComponent(\'' + encodeURIComponent(clipData) + '\'))">✂️</button>' +
        '</div>';
    }).join('');
    return '<div class="preview-site-block"><div class="preview-site-name">' + esc(block.site.name) +
      '<span class="preview-site-region">' + esc(block.site.region) + '</span>' +
      '<span style="color:var(--accent);font-size:10px;margin-left:auto">' + block.articles.length + ' yesterday</span></div>' + rows + '</div>';
  }).join('');

  document.getElementById('previewTitle').textContent = '📰 Yesterday — ' + yLabel;
  document.getElementById('previewBody').innerHTML    = html;
  document.getElementById('previewStats').textContent = totalMatch + ' yesterday\'s articles · ' + (totalFetched - totalMatch) + ' others filtered · your local timezone';
}

// ── Week Preview ──────────────────────────────────────────────────────────────
async function weekPreview() {
  const checked = [...document.querySelectorAll('#siteList input:checked')];
  if (checked.length === 0) { alert('Please select at least one site.'); return; }
  if (checked.length > 20) { alert('Too many sites selected (' + checked.length + ').\n\nPlease select 20 or fewer sites.'); return; }

  const names   = checked.map(cb => cb.value);
  const targets = allSites.filter(s => names.includes(s.name));
  const now     = new Date();

  document.getElementById('previewTitle').textContent = '📅 This Week';
  document.getElementById('previewBody').innerHTML    = '<div style="padding:30px;text-align:center;color:var(--muted);font-family:IBM Plex Mono,monospace;font-size:12px">⏳ Fetching this week\'s headlines…</div>';
  document.getElementById('previewStats').textContent = '';
  document.getElementById('previewOverlay').classList.add('open');

  let totalFetched = 0, totalMatch = 0;

  const blocks = await Promise.all(targets.map(async site => {
    try {
      const res  = await fetch('/api/test-rss?url=' + encodeURIComponent(site.rss));
      const data = await res.json();
      if (!data.ok || !data.articles?.length) return null;
      totalFetched += data.articles.length;
      const matched = data.articles.filter(a => {
        if (!a.pubDate) return false;
        const d = new Date(a.pubDate);
        return !isNaN(d) && (now - d) / 86400000 <= 7;
      });
      totalMatch += matched.length;
      return matched.length ? { site, articles: matched } : null;
    } catch { return null; }
  }));

  const valid = blocks.filter(Boolean);
  if (!valid.length) {
    document.getElementById('previewBody').innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);font-family:IBM Plex Mono,monospace;font-size:12px">📭 No articles from this week found.</div>';
    document.getElementById('previewStats').textContent = '0 this week from ' + totalFetched + ' fetched';
    return;
  }

  const html = valid.map(function(block) {
    const rows = block.articles.map(function(a, i) {
      const d = a.pubDate ? new Date(a.pubDate) : null;
      const days = d ? Math.floor((now - d) / 86400000) : null;
      const label = days === 0 ? 'today' : days === 1 ? 'yesterday' : days !== null ? days + 'd ago' : '';
      const clipData = JSON.stringify({title:a.title,link:a.link,pubDate:a.pubDate||'',source:block.site.name,region:block.site.region,thumbnail:a.thumbnail||null});
      return '<div class="preview-article"><span class="preview-article-num">' + (i+1) + '.</span>' +
        thumbImg(a.thumbnail, 'preview-article-thumb') +
        '<a href="' + esc(a.link) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a>' +
        (label ? '<span class="preview-article-date">' + label + '</span>' : '') +
        '<button class="clip-btn" title="Add to My Clippings" onclick="clipArticle(this,decodeURIComponent(\'' + encodeURIComponent(clipData) + '\'))">✂️</button>' +
        '</div>';
    }).join('');
    return '<div class="preview-site-block"><div class="preview-site-name">' + esc(block.site.name) +
      '<span class="preview-site-region">' + esc(block.site.region) + '</span>' +
      '<span style="color:var(--accent);font-size:10px;margin-left:auto">' + block.articles.length + ' this week</span></div>' + rows + '</div>';
  }).join('');

  document.getElementById('previewTitle').textContent = '📅 This Week';
  document.getElementById('previewBody').innerHTML    = html;
  document.getElementById('previewStats').textContent = totalMatch + ' articles this week · your local timezone';
}

// ── Today Preview ─────────────────────────────────────────────────────────────
async function todayPreview() {
  const checked = [...document.querySelectorAll('#siteList input:checked')];
  if (checked.length === 0) { alert('Please select at least one site.'); return; }
  if (checked.length > 20) {
    alert('Too many sites selected (' + checked.length + ').\n\nPlease select 20 or fewer sites.\nTip: use the region filter to narrow down.');
    return;
  }

  const names      = checked.map(cb => cb.value);
  const targets    = allSites.filter(s => names.includes(s.name));
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  document.getElementById('previewTitle').textContent = '📰 Today — ' + todayLabel;
  document.getElementById('previewBody').innerHTML    = '<div style="padding:30px;text-align:center;color:var(--muted);font-family:IBM Plex Mono,monospace;font-size:12px">⏳ Fetching today\'s headlines…</div>';
  document.getElementById('previewStats').textContent = '';
  document.getElementById('previewOverlay').classList.add('open');

  let totalFetched = 0, totalToday = 0;

  const blocks = await Promise.all(targets.map(async site => {
    try {
      const res  = await fetch('/api/test-rss?url=' + encodeURIComponent(site.rss));
      const data = await res.json();
      if (!data.ok || !data.articles || !data.articles.length) return null;
      totalFetched += data.articles.length;
      const todayArticles = data.articles.filter(a => isToday(a.pubDate));
      totalToday += todayArticles.length;
      return todayArticles.length ? { site, articles: todayArticles } : null;
    } catch(e) { return null; }
  }));

  const valid = blocks.filter(Boolean);
  if (!valid.length) {
    document.getElementById('previewBody').innerHTML =
      '<div style="padding:30px;text-align:center;color:var(--muted);font-family:IBM Plex Mono,monospace;font-size:13px">' +
      '📭 No articles published today found.<br><br>' +
      '<span style="font-size:11px;color:var(--muted)">Fetched ' + totalFetched + ' articles — none matched today\'s date in your local timezone.<br>' +
      'Try 👁 Preview to see all recent articles.</span></div>';
    document.getElementById('previewStats').textContent = '0 today from ' + totalFetched + ' fetched';
    return;
  }

  const html = valid.map(function(block) {
    const rows = block.articles.map(function(a, i) {
      const t = a.pubDate ? new Date(a.pubDate).toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' }) : '';
      const clipData = JSON.stringify({title:a.title,link:a.link,pubDate:a.pubDate||'',source:block.site.name,region:block.site.region,thumbnail:a.thumbnail||null});
      return '<div class="preview-article">' +
        '<span class="preview-article-num">' + (i+1) + '.</span>' +
        thumbImg(a.thumbnail, 'preview-article-thumb') +
        '<a href="' + esc(a.link) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a>' +
        (t ? '<span class="preview-article-date">' + t + '</span>' : '') +
        '<button class="clip-btn" title="Add to My Clippings" onclick="clipArticle(this,decodeURIComponent(\'' + encodeURIComponent(clipData) + '\'))">✂️</button>' +
        '</div>';
    }).join('');
    return '<div class="preview-site-block">' +
      '<div class="preview-site-name">' + esc(block.site.name) +
      '<span class="preview-site-region">' + esc(block.site.region) + '</span>' +
      '<span style="color:var(--accent);font-size:10px;margin-left:auto">' + block.articles.length + ' today</span>' +
      '</div>' + rows + '</div>';
  }).join('');

  document.getElementById('previewTitle').textContent = '📰 Today — ' + todayLabel;
  document.getElementById('previewBody').innerHTML    = html;
  document.getElementById('previewStats').textContent =
    totalToday + ' today\'s articles · ' + (totalFetched - totalToday) + ' older filtered out · your local timezone';
}

// ── Sites ─────────────────────────────────────────────────────────────────────
let allSites = [];

async function loadSites(retries = 3) {
  try {
    const res = await fetch('/api/sites');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const fetched = await res.json();
    // Only enabled sites are shown — disabled sites are never selectable,
    // never previewed, and never sent to /api/search (so no RSS fetch/cache).
    allSites = fetched.filter(s => s.enabled !== false);

    const regions = [...new Set(allSites.map(s => s.region))].sort();
    const select  = document.getElementById('regionFilter');
    while (select.options.length > 1) select.remove(1);
    regions.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r; opt.textContent = r;
      select.appendChild(opt);
    });

    renderSiteList(allSites);
  } catch(err) {
    if (retries > 0) {
      document.getElementById('siteList').innerHTML =
        '<div style="padding:12px;color:var(--muted);font-size:12px">⏳ Connecting to server...</div>';
      setTimeout(() => loadSites(retries - 1), 1000);
    } else {
      document.getElementById('siteList').innerHTML =
        '<div style="padding:12px;color:var(--danger);font-size:12px">❌ Failed to load sites — is the server running?<br><br>' +
        '<span style="color:var(--muted)">Run: npm start</span></div>';
    }
  }
}

function renderSiteList(sites) {
  const list = document.getElementById('siteList');
  list.innerHTML = '';
  if (!sites.length) {
    list.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:12px">No sites in this region</div>';
    return;
  }
  sites.forEach(site => {
    const row = document.createElement('div');
    row.className = 'site-item';
    row.dataset.region = site.region;
    row.innerHTML = `
      <input type="checkbox" id="site_${site.name}" value="${site.name}" checked>
      <label for="site_${site.name}">${site.name}</label>
      <span class="region">${site.region}</span>`;
    list.appendChild(row);
  });
}

function filterByRegion() {
  const region   = document.getElementById('regionFilter').value;
  const filtered = region ? allSites.filter(s => s.region === region) : allSites;
  renderSiteList(filtered);
  loadSuggestedKeywords();
}

function selectVisible(checked) {
  document.querySelectorAll('#siteList input[type=checkbox]').forEach(cb => cb.checked = checked);
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

function handleKey(e) {
  if (isSearching) return;
  const input = document.getElementById('inputBox');

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!searchHistory.length) return;
    if (historyIndex === -1) currentDraft = input.value;
    historyIndex = Math.min(historyIndex + 1, searchHistory.length - 1);
    input.value  = searchHistory[historyIndex];
    autoResize(input);
    setTimeout(() => { input.selectionStart = input.selectionEnd = input.value.length; }, 0);
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (historyIndex === -1) return;
    historyIndex--;
    input.value = historyIndex === -1 ? currentDraft : searchHistory[historyIndex];
    autoResize(input);
    setTimeout(() => { input.selectionStart = input.selectionEnd = input.value.length; }, 0);
    return;
  }
  if (e.key !== 'Enter') historyIndex = -1;
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startSearch(); }
}

function setSearching(busy) {
  isSearching = busy;
  document.getElementById('sendBtn').disabled = busy;
  const dot = document.getElementById('statusDot');
  dot.className = 'status-dot ' + (busy ? 'busy' : 'idle');
}

function scrollBottom() {
  const log = document.getElementById('chatLog');
  log.scrollTop = log.scrollHeight;
}

function appendMsg(role, html) {
  const log   = document.getElementById('chatLog');
  const icon  = role === 'user' ? '👤' : '📡';
  const label = role === 'user' ? 'You' : 'newsLookup';
  const div   = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = `
    <div class="msg-icon">${icon}</div>
    <div class="msg-body">
      <div class="msg-label">${label}</div>
      <div class="msg-text">${html}</div>
    </div>`;
  log.appendChild(div);
  scrollBottom();
  return div.querySelector('.msg-text');
}

// ── Threshold ─────────────────────────────────────────────────────────────────
function updateThreshold(val) {
  similarityThreshold = parseFloat(val);
  const pct = Math.round(parseFloat(val) * 100);
  document.getElementById('thresholdVal').textContent  = pct + '%';
  document.getElementById('thresholdHint').textContent = 'score ≥ ' + pct + '%';
}

fetch('/api/embed-config').then(r => r.json()).then(cfg => {
  if (cfg.threshold) {
    similarityThreshold = cfg.threshold;
    document.getElementById('thresholdSlider').value = cfg.threshold;
    updateThreshold(cfg.threshold.toFixed ? cfg.threshold.toFixed(2) : cfg.threshold.toString());
  }
  if (cfg.model) {
    const hint  = document.getElementById('thresholdHint');
    if (hint) hint.title = 'Embed model: ' + cfg.model + ' @ ' + (cfg.baseUrl || 'localhost');
    const label = document.querySelector('.threshold-bar label');
    if (label) label.title = cfg.model + ' @ ' + (cfg.baseUrl || 'localhost:11434');
  }
}).catch(() => {});

// ── Date Filter ───────────────────────────────────────────────────────────────
function setFilter(filter, btn) {
  activeFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadSuggestedKeywords();
}

// ── Suggested Keywords ────────────────────────────────────────────────────────
let suggestedKeywords  = [];
let kwMobilePage       = 0;
const KW_MOBILE_PER_PAGE = 2;
const KW_TTL_MS          = 3 * 60 * 60 * 1000; // 3h — must match server
let kwGenerating       = false;

function getActiveRegion() {
  return document.getElementById('regionFilter').value || 'all';
}

async function loadSuggestedKeywords() {
  if (kwGenerating) return;
  const region     = getActiveRegion();
  const dateFilter = activeFilter;

  try {
    const res  = await fetch(`/api/suggested-keywords?region=${encodeURIComponent(region)}&dateFilter=${encodeURIComponent(dateFilter)}`);
    const data = await res.json();

    if (data.status === 'fresh' && data.keywords?.length) {
      renderKeywords(data.keywords);
    } else if (data.status === 'stale' && data.keywords?.length) {
      renderKeywords(data.keywords);
      generateKeywords(region, dateFilter);
    } else {
      renderKeywords([]);
    }
  } catch(e) {
    renderKeywords([]);
  }
}

async function generateKeywords(region, dateFilter) {
  if (kwGenerating) return;
  kwGenerating = true;
  showKwOverlay(true);
  try {
    const res  = await fetch('/api/suggested-keywords/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region, dateFilter }),
    });
    const data = await res.json();
    if (data.keywords?.length) {
      renderKeywords(data.keywords);
    } else {
      // API returned but with an error or empty keywords — show it in the keyword area
      const errMsg = data.error || 'No keywords returned';
      console.warn('Keywords generate failed:', errMsg);
      showKwError(errMsg);
    }
  } catch(e) {
    // Network/fetch error
    console.warn('Keywords generate failed:', e.message);
    showKwError(e.message);
  } finally {
    kwGenerating = false;
    showKwOverlay(false);
  }
}

function showKwError(msg) {
  const list = document.getElementById('kwList');
  if (list) list.innerHTML = '<span style="font-family:IBM Plex Mono,monospace;font-size:10px;color:var(--danger);opacity:0.8">⚠ ' + esc(msg) + '</span>';
}

function showKwOverlay(visible) {
  const overlay = document.getElementById('kwOverlay');
  if (overlay) overlay.classList.toggle('active', visible);
  const btn = document.getElementById('kwRefreshBtn');
  if (btn) btn.disabled = visible;
}

async function refreshSuggestedKeywords() {
  if (kwGenerating) return;
  await generateKeywords(getActiveRegion(), activeFilter);
}

function renderKeywords(keywords) {
  suggestedKeywords = keywords;
  kwMobilePage = 0;

  const label = document.getElementById('kwLabel');
  const list  = document.getElementById('kwList');

  if (label) label.textContent = '💡 Suggested Keywords:';

  if (!keywords.length) {
    if (list) list.innerHTML = '<span style="font-family:IBM Plex Mono,monospace;font-size:10px;color:var(--muted);opacity:0.6">— search to generate —</span>';
    renderMobileKeywords();
    return;
  }

  if (list) {
    list.innerHTML = keywords.map((item, i) => {
      const kw = item.keyword || item;
      return `<button class="kw-chip" onclick="useKeyword(${i})">${esc(kw)}</button>`;
    }).join('');
  }
  renderMobileKeywords();
}

function renderMobileKeywords() {
  const chips     = document.getElementById('kwMobileChips');
  const prev      = document.getElementById('kwPrev');
  const next      = document.getElementById('kwNext');
  const indicator = document.getElementById('kwPageIndicator');
  if (!chips) return;

  const totalPages = Math.max(1, Math.ceil(suggestedKeywords.length / KW_MOBILE_PER_PAGE));
  kwMobilePage = Math.min(kwMobilePage, totalPages - 1);

  if (!suggestedKeywords.length) {
    chips.innerHTML = '<span style="font-family:IBM Plex Mono,monospace;font-size:10px;color:var(--muted);opacity:0.6;flex:1;text-align:center">— search to generate —</span>';
    if (prev) prev.disabled = true;
    if (next) next.disabled = true;
    if (indicator) indicator.textContent = '';
    return;
  }

  const start = kwMobilePage * KW_MOBILE_PER_PAGE;
  const slice = suggestedKeywords.slice(start, start + KW_MOBILE_PER_PAGE);

  chips.innerHTML = slice.map((item, j) => {
    const idx = start + j;
    const kw  = item.keyword || item;
    return `<button class="kw-mobile-chip" onclick="useKeyword(${idx})">${esc(kw)}</button>`;
  }).join('');

  if (prev) prev.disabled = (kwMobilePage === 0);
  if (next) next.disabled = (kwMobilePage >= totalPages - 1);
  if (indicator) indicator.textContent = (kwMobilePage + 1) + '/' + totalPages;
}

function kwNavigate(dir) {
  const totalPages = Math.ceil(suggestedKeywords.length / KW_MOBILE_PER_PAGE);
  kwMobilePage = Math.max(0, Math.min(totalPages - 1, kwMobilePage + dir));
  renderMobileKeywords();
}

function useKeyword(idx) {
  const item = suggestedKeywords[idx];
  if (!item) return;
  const kw = item.keyword || item;

  document.querySelectorAll('.kw-chip').forEach((el, i) => el.classList.toggle('selected', i === idx));
  const start = kwMobilePage * KW_MOBILE_PER_PAGE;
  document.querySelectorAll('.kw-mobile-chip').forEach((el, j) => el.classList.toggle('selected', (start + j) === idx));

  const input = document.getElementById('inputBox');
  if (!input) return;
  const existing = input.value.trim();
  if (existing) {
    const already = existing.split(/[,，、\n]+/).map(k => k.trim()).includes(kw);
    if (!already) { input.value = existing + ', ' + kw; autoResize(input); }
  } else {
    input.value = kw;
    autoResize(input);
  }
  input.focus();
}

function postSearchKeywordCheck() {
  const region = getActiveRegion();
  fetch(`/api/suggested-keywords?region=${encodeURIComponent(region)}&dateFilter=${encodeURIComponent(activeFilter)}`)
    .then(r => r.json())
    .then(data => { if (data.status === 'none') generateKeywords(region, activeFilter); })
    .catch(() => {});
}

// ── Search ────────────────────────────────────────────────────────────────────
async function startSearch() {
  if (isSearching) return;
  const input = document.getElementById('inputBox');
  const raw   = input.value.trim();
  if (!raw) return;

  const keywords = raw.split(/[,，、\n]+/).map(k => k.trim()).filter(Boolean);
  const sites    = [...document.querySelectorAll('#siteList input:checked')].map(cb => cb.value);

  searchHistory = [raw, ...searchHistory.filter(h => h !== raw)].slice(0, 10);
  historyIndex  = -1;
  currentDraft  = '';
  sessionStorage.setItem('nlg2_history', JSON.stringify(searchHistory));

  input.value = '';
  input.style.height = 'auto';
  currentResults = [];

  const chatLog = document.getElementById('chatLog');
  const welcome = chatLog.firstElementChild;
  chatLog.innerHTML = '';
  if (welcome) chatLog.appendChild(welcome);

  searchId++;
  const sid = 'sr' + searchId;

  const log  = document.getElementById('chatLog');
  const card = document.createElement('div');
  card.className = 'search-card';
  card.id = sid + '_card';
  card.innerHTML = `
    <div class="search-card-query">
      <span>🔍 ${keywords.map(k => '<strong>' + k + '</strong>').join(' &nbsp;·&nbsp; ')}</span>
      <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted)">${new Date().toLocaleTimeString()}</span>
    </div>
    <div class="search-card-body">
      <div id="${sid}_progressMsg">Starting search across ${sites.length} sources…</div>
      <div class="progress-bar-wrap"><div class="progress-bar" id="${sid}_progressBar"></div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
        <div class="progress-text" id="${sid}_progressSub"></div>
        <div style="display:flex;gap:12px;align-items:center">
          <div id="${sid}_statsCount" style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted)"></div>
          <div id="${sid}_elapsedTime" style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted)"></div>
        </div>
      </div>
      <div id="${sid}_liveResults"></div>
    </div>`;
  log.appendChild(card);
  scrollBottom();

  setSearching(true);
  startTime = Date.now();
  articlesProcessed = 0;
  timerInterval = setInterval(() => {
    const el = document.getElementById(sid + '_elapsedTime');
    if (el) el.textContent = '⏱ ' + formatElapsed(Date.now() - startTime);
  }, 1000);

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords, sites, dateFilter: activeFilter, threshold: similarityThreshold }),
    });

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let sitesDone = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const evt = JSON.parse(line.slice(5).trim());

        if (evt.type === 'progress') {
          const ps2 = document.getElementById(sid + '_progressSub'); if (ps2) ps2.textContent = evt.message;
          if (evt.message.startsWith('Fetching')) sitesDone++;
          const checkMatch = evt.message.match(/Checking (\d+) articles/);
          if (checkMatch) articlesProcessed += parseInt(checkMatch[1]);
          const pct = Math.min(95, Math.round((sitesDone / sites.length) * 95));
          const pb2 = document.getElementById(sid + '_progressBar'); if (pb2) pb2.style.width = pct + '%';
          const sc  = document.getElementById(sid + '_statsCount');
          if (sc) sc.textContent = articlesProcessed + ' articles';
        }

        if (evt.type === 'error') {
          const pm = document.getElementById(sid + '_progressMsg');
          if (pm) pm.innerHTML = '<span style="color:var(--danger)">' + evt.message.replace(/\n/g,'<br>') + '</span>';
        }

        if (evt.type === 'warning') {
          const warnId = sid + '_rateWarn';
          if (!document.getElementById(warnId)) {
            const w = document.createElement('div');
            w.id = warnId;
            w.style.cssText = 'margin-top:8px;padding:6px 10px;border-radius:5px;background:#2a1f00;border:1px solid #fbbf24;color:#fbbf24;font-size:12px;font-family:IBM Plex Mono,monospace';
            w.textContent = evt.message;
            const psub = document.getElementById(sid + '_progressSub');
            if (psub) psub.after(w);
          }
        }

        if (evt.type === 'match') {
          currentResults.push(evt.article);
          renderLiveTable(sid);
        }

        if (evt.type === 'done') {
          const bar = document.getElementById(sid + '_progressBar');
          if (bar) bar.style.width = '100%';
          const totalMs  = Date.now() - startTime;
          const elapsed  = formatElapsed(totalMs);
          const avgMs    = articlesProcessed > 0 ? Math.round(totalMs / articlesProcessed) : 0;
          const avgLabel = avgMs >= 1000 ? (avgMs/1000).toFixed(1) + 's/article' : avgMs + 'ms/article';
          const modeLabel = evt.mode === 'keyword' ? ' [keyword fallback]' : ' [embedding]';

          if (evt.effectiveThreshold) {
            similarityThreshold = evt.effectiveThreshold;
            document.getElementById('thresholdSlider').value = evt.effectiveThreshold;
            updateThreshold(String(evt.effectiveThreshold));
          }

          // Auto-retry with lower threshold when zero results
          const RETRY_THRESHOLD = 0.30;
          if (evt.total === 0 && evt.mode !== 'keyword' && similarityThreshold > RETRY_THRESHOLD) {
            const pm = document.getElementById(sid + '_progressMsg');
            if (pm) pm.textContent = `🔍 No results at ${Math.round(similarityThreshold * 100)}% — retrying with best matches above 30%…`;
            const sites = [...document.querySelectorAll('#siteList input:checked')].map(cb => cb.value);
            const retryRes = await fetch('/api/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ keywords, sites, dateFilter: activeFilter, threshold: RETRY_THRESHOLD }),
            });
            const retryReader  = retryRes.body.getReader();
            const retryDecoder = new TextDecoder();
            let retryBuf = '';
            let retryTotal = 0;
            while (true) {
              const { done: rDone, value: rVal } = await retryReader.read();
              if (rDone) break;
              retryBuf += retryDecoder.decode(rVal, { stream: true });
              const retryLines = retryBuf.split('\n\n');
              retryBuf = retryLines.pop();
              for (const line of retryLines) {
                if (!line.startsWith('data:')) continue;
                try {
                  const re = JSON.parse(line.slice(5).trim());
                  if (re.type === 'match') { currentResults.push(re.article); retryTotal++; renderLiveTable(sid); }
                  if (re.type === 'done')  retryTotal = re.total;
                } catch {}
              }
            }
            const pm2 = document.getElementById(sid + '_progressMsg');
            if (pm2) pm2.textContent = retryTotal === 0
              ? `🔍 No matching articles found even at 30%.${modeLabel}`
              : `⚠️ No results at ${Math.round(similarityThreshold * 100)}% — showing ${retryTotal} best match${retryTotal > 1 ? 'es' : ''} above 30%`;
            clearInterval(timerInterval); timerInterval = null;
            setSearching(false);
            postSearchKeywordCheck();
            return;
          }

          const pm = document.getElementById(sid + '_progressMsg');
          if (pm) pm.textContent = evt.total === 0
            ? `🔍 No matching articles found. (${elapsed})${modeLabel}`
            : `✅ Found ${evt.total} matching article${evt.total > 1 ? 's' : ''}. (${elapsed})${modeLabel}`;
          const psub = document.getElementById(sid + '_progressSub');
          if (psub) psub.textContent = '';
          const el = document.getElementById(sid + '_elapsedTime');
          if (el) el.textContent = `⏱ ${elapsed}`;
          const sc = document.getElementById(sid + '_statsCount');
          if (sc) sc.textContent = `📄 ${articlesProcessed} articles · ${avgLabel}`;

          const topScore = currentResults.length
            ? Math.max(...currentResults.map(r => r.score || 0)) : 0;
          sessionHistory.unshift({
            query:     keywords.join(', '),
            keywords,
            results:   currentResults.slice(),
            count:     evt.total,
            topScore:  Math.round(topScore * 100),
            threshold: similarityThreshold,
            filter:    activeFilter,
            elapsed,
            mode:      evt.mode || 'embedding',
            time:      new Date().toLocaleTimeString(),
          });
          if (sessionHistory.length > 20) sessionHistory.pop();

          sortCol = 'score'; sortDir = -1;
          currentResults.sort((a, b) => (parseFloat(b.score) || 0) - (parseFloat(a.score) || 0));
          renderLiveTable(sid);
          ['source','region','score','title','pubDate'].forEach(c => {
            const el = document.getElementById('sort_' + c);
            if (el) el.textContent = c === 'score' ? '\u25bc' : '';
          });
          postSearchKeywordCheck();
        }
      }
    }
  } catch (err) {
    const pm = document.getElementById(sid + '_progressMsg');
    if (pm) pm.innerHTML = '<span style="color:var(--danger)">❌ Error: ' + err.message + '</span>';
  }

  clearInterval(timerInterval); timerInterval = null;
  setSearching(false);
  scrollBottom();
  updateCacheStatus();
}

// ── Sort ──────────────────────────────────────────────────────────────────────
function sortResults(col) {
  if (sortCol === col) { sortDir *= -1; } else { sortCol = col; sortDir = col === 'score' ? -1 : 1; }
  ['source','region','score','title','pubDate'].forEach(c => {
    const el = document.getElementById('sort_' + c); if (el) el.textContent = '';
  });
  const icon = document.getElementById('sort_' + col);
  if (icon) icon.textContent = sortDir === -1 ? '▼' : '▲';

  currentResults.sort((a, b) => {
    let va = a[col] || '', vb = b[col] || '';
    if (col === 'score')   { va = parseFloat(va)||0; vb = parseFloat(vb)||0; return sortDir * (vb - va); }
    if (col === 'pubDate') { va = new Date(va).getTime()||0; vb = new Date(vb).getTime()||0; return sortDir * (vb - va); }
    return sortDir * String(va).localeCompare(String(vb));
  });

  const liveDiv = document.querySelector('[id$="_liveResults"]');
  if (liveDiv) renderLiveTable(liveDiv.id.replace('_liveResults', ''));
}

function fmtArticleDate(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d)) return '';
  const ageDays = Math.floor((Date.now() - d) / 86400000);
  const time    = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (ageDays === 0) return time;
  if (ageDays === 1) return 'yesterday';
  if (ageDays < 30)  return ageDays + 'd ago';
  if (ageDays < 365) return Math.floor(ageDays/30) + 'mo ago';
  return Math.floor(ageDays/365) + 'yr ago';
}

function renderLiveTable(sid) {
  const wrap = document.getElementById((sid||'sr1') + '_liveResults');
  if (!currentResults.length) { wrap.innerHTML = ''; return; }

  const rows = currentResults.map((a, i) => `
    <tr>
      <td style="width:32px;text-align:center">
        <input type="checkbox" class="result-cb" data-idx="${i}" style="accent-color:var(--accent);cursor:pointer">
      </td>
      <td class="td-thumb">${thumbImg(a.thumbnail, 'article-thumb')}</td>
      <td class="td-source">${esc(a.source)}</td>
      <td class="td-region">${esc(a.region)}</td>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--accent2);text-align:center">
        ${a.score ? (Math.round(a.score * 100) + '%') : ''}
      </td>
      <td class="td-title"><a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.title)}</a></td>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);white-space:nowrap">${fmtArticleDate(a.pubDate)}</td>
      <td><button class="summarise-btn" onclick="summariseArticle(${i})" title="Summarise with AI">🤖</button></td>
    </tr>`).join('');

  const mobCards = currentResults.map((a, i) => `
    <div class="mob-card">
      <div class="mob-card-row1">
        <input type="checkbox" class="result-cb" data-idx="${i}" style="accent-color:var(--accent);cursor:pointer;flex-shrink:0">
        <span class="mob-card-source">${esc(a.source)}</span>
        <span class="mob-card-score">${a.score ? (Math.round(a.score * 100) + '%') : ''}</span>
        <button class="summarise-btn" onclick="summariseArticle(${i})" title="Summarise with AI" style="flex-shrink:0">🤖</button>
      </div>
      <div class="mob-card-row2">${esc(a.region)}</div>
      <div class="mob-card-title-row">
        ${thumbImg(a.thumbnail, 'mob-card-thumb')}
        <div class="mob-card-title"><a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.title)}</a></div>
      </div>
    </div>`).join('');

  wrap.innerHTML = `
    <div class="results-wrap" style="margin-top:12px">
      <div class="results-header">
        <div style="display:flex;gap:8px;align-items:center">
          <span id="resultCount">${currentResults.length} result${currentResults.length > 1 ? 's' : ''}</span>
          <button class="export-btn" onclick="selectResults(true)">✓ All</button>
          <button class="export-btn" onclick="selectResults(false)">✗ None</button>
        </div>
        <div class="export-btns">
          <button class="export-btn" onclick="exportCSV()">⬇ CSV</button>
          <button class="export-btn" onclick="exportJSON()">⬇ JSON</button>
        </div>
      </div>
      <div class="desktop-table" style="overflow-x:auto;overflow-y:auto;max-height:calc(100vh - 420px);min-height:120px">
        <table>
          <thead><tr>
            <th style="width:32px"></th>
            <th style="width:56px"></th>
            <th class="sortable" onclick="sortResults('source')">Source <span class="sort-icon" id="sort_source"></span></th>
            <th class="sortable" onclick="sortResults('region')">Region <span class="sort-icon" id="sort_region"></span></th>
            <th class="sortable" onclick="sortResults('score')" style="width:60px">Score <span class="sort-icon" id="sort_score">▼</span></th>
            <th class="sortable" onclick="sortResults('title')">Title / Link <span class="sort-icon" id="sort_title"></span></th>
            <th class="sortable" onclick="sortResults('pubDate')" style="white-space:nowrap">Published <span class="sort-icon" id="sort_pubDate"></span></th>
            <th style="width:40px"></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="mobile-cards">${mobCards}</div>
    </div>`;
}

// ── Export ────────────────────────────────────────────────────────────────────
function getSelectedCount() { return document.querySelectorAll('.result-cb:checked').length; }

function selectResults(checked) {
  document.querySelectorAll('.result-cb').forEach(cb => cb.checked = checked);
}

function getSelectedItems() {
  const selected = [];
  document.querySelectorAll('.result-cb:checked').forEach(cb => {
    selected.push(currentResults[parseInt(cb.dataset.idx)]);
  });
  return selected;
}

function exportCSV() {
  const items = getSelectedItems();
  if (!items.length) { alert('Please select at least one item to export.'); return; }
  const header = ['Source','Region','Topic','Title','URL'];
  const rows   = items.map(a =>
    [a.source, a.region, a.topic, a.title, a.link].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
  download(`newslookup-${items.length}-results.csv`, 'text/csv', [header.join(','), ...rows].join('\n'));
}

function exportJSON() {
  const items = getSelectedItems();
  if (!items.length) { alert('Please select at least one item to export.'); return; }
  download(`newslookup-${items.length}-results.json`, 'application/json', JSON.stringify(items, null, 2));
}

function download(filename, mime, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
}

// ── Clear ─────────────────────────────────────────────────────────────────────
function clearChat() {
  if (isSearching) return;
  currentResults = [];
  document.getElementById('chatLog').innerHTML = `
    <div class="msg bot">
      <div class="msg-icon">📡</div>
      <div class="msg-body">
        <div class="msg-label">newsLookup</div>
        <div class="msg-text">
          Chat cleared. Enter new keywords to search.<br><br>
          <span style="color:var(--muted);font-size:12px">Example: <em>香港樓市, interest rate hike, 炒樓</em></span>
        </div>
      </div>
    </div>`;
}

// ── History hint ──────────────────────────────────────────────────────────────
function showHistoryHint() {
  const hint = document.getElementById('historyHint');
  if (hint && searchHistory.length)
    hint.textContent = '↑ ' + searchHistory.length + ' saved prompt' + (searchHistory.length > 1 ? 's' : '') + ' — use ↑↓ to browse';
}
function hideHistoryHint() {
  setTimeout(() => { const hint = document.getElementById('historyHint'); if (hint) hint.textContent = ''; }, 200);
}

// ── Session History Panel ─────────────────────────────────────────────────────
function openHistory() { renderHistoryPanel(); document.getElementById('historyOverlay').classList.add('open'); }
function closeHistoryPanel(e) { if (e.target === document.getElementById('historyOverlay')) closeHistoryOverlay(); }
function closeHistoryOverlay() { document.getElementById('historyOverlay').classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHistoryOverlay(); });

function clearSessionHistory() {
  if (!confirm('Clear all search history for this session?')) return;
  sessionHistory = [];
  renderHistoryPanel();
}

function renderHistoryPanel() {
  const body  = document.getElementById('historyBody');
  const badge = document.getElementById('historyCountBadge');
  badge.textContent = sessionHistory.length ? '(' + sessionHistory.length + ')' : '';

  if (!sessionHistory.length) {
    body.innerHTML = '<div class="history-empty">No searches yet this session.<br><br>Results appear here after each search.</div>';
    document.getElementById('historyFooterStats').textContent = '';
    return;
  }

  const totalResults = sessionHistory.reduce((s, h) => s + h.count, 0);
  document.getElementById('historyFooterStats').textContent =
    sessionHistory.length + ' searches · ' + totalResults + ' total results';

  body.innerHTML = sessionHistory.map((h, i) => `
    <div class="history-card">
      <div class="history-card-header">
        <div class="history-query">${esc(h.query)}</div>
        <div class="history-time">${h.time}</div>
      </div>
      <div class="history-meta">
        <span class="history-badge results">${h.count} result${h.count !== 1 ? 's' : ''}</span>
        ${h.topScore ? '<span class="history-badge score">top ' + h.topScore + '%</span>' : ''}
        <span class="history-badge">threshold ${h.threshold}</span>
        <span class="history-badge">${h.filter}</span>
        <span class="history-badge time">⏱ ${h.elapsed}</span>
        <span class="history-badge">${h.mode}</span>
      </div>
      <div class="history-actions">
        <button class="history-btn rerun" onclick="rerunSearch(${i})">↺ Re-run</button>
        ${h.count > 0 ? '<button class="history-btn" onclick="viewHistoryResults(' + i + ')">📋 View Results</button>' : ''}
      </div>
    </div>
  `).join('');
}

function rerunSearch(i) {
  const h = sessionHistory[i];
  closeHistoryOverlay();
  const input = document.getElementById('inputBox');
  input.value = h.query;
  autoResize(input);
  similarityThreshold = h.threshold;
  document.getElementById('thresholdSlider').value = h.threshold;
  updateThreshold(h.threshold.toString());
  startSearch();
}

function viewHistoryResults(i) {
  const h    = sessionHistory[i];
  closeHistoryOverlay();
  const log  = document.getElementById('chatLog');
  const card = document.createElement('div');
  card.className = 'search-card';
  card.style.borderColor = 'var(--warn)';
  card.innerHTML = `
    <div class="search-card-query" style="background:#2a1f00">
      <span>📋 ${esc(h.query)} <span style="color:var(--muted);font-size:10px">(from ${h.time})</span></span>
    </div>
    <div class="search-card-body">${buildResultsTable(h.results)}</div>`;
  log.appendChild(card);
  scrollBottom();
}

function buildResultsTable(results) {
  if (!results || !results.length) return '<div style="color:var(--muted);font-size:12px;padding:8px 0">No results</div>';
  const rows = results.map((a, i) => `
    <tr>
      <td style="width:32px;text-align:center">
        <input type="checkbox" class="result-cb" data-idx="${i}" style="accent-color:var(--accent);cursor:pointer">
      </td>
      <td class="td-source">${esc(a.source)}</td>
      <td class="td-region">${esc(a.region)}</td>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--accent2);text-align:center">
        ${a.score ? (Math.round(a.score * 100) + '%') : ''}
      </td>
      <td class="td-title"><a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.title)}</a></td>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);white-space:nowrap">${fmtArticleDate(a.pubDate)}</td>
      <td><button class="summarise-btn" onclick="summariseArticle(${i})" title="Summarise with AI">🤖</button></td>
    </tr>`).join('');
  const mobCards = results.map((a, i) => `
    <div class="mob-card">
      <div class="mob-card-row1">
        <input type="checkbox" class="result-cb" data-idx="${i}" style="accent-color:var(--accent);cursor:pointer;flex-shrink:0">
        <span class="mob-card-source">${esc(a.source)}</span>
        <span class="mob-card-score">${a.score ? (Math.round(a.score * 100) + '%') : ''}</span>
        <button class="summarise-btn" onclick="summariseArticle(${i})" title="Summarise with AI" style="flex-shrink:0">🤖</button>
      </div>
      <div class="mob-card-row2">${esc(a.region)}</div>
      <div class="mob-card-title"><a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.title)}</a></div>
    </div>`).join('');
  return `<div class="results-wrap">
    <div class="results-header">
      <div style="display:flex;gap:8px;align-items:center">
        <span>${results.length} result${results.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
    <div class="desktop-table" style="overflow-x:auto"><table>
      <thead><tr>
        <th style="width:32px"></th>
        <th>Source</th><th>Region</th><th style="width:60px">Score</th>
        <th>Title / Link</th><th>Published</th><th style="width:40px"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="mobile-cards">${mobCards}</div>
  </div>`;
}

// ── Collection ────────────────────────────────────────────────────────────────
let currentSummaryArticle = null;

async function addToCollection() {
  if (!currentSummaryArticle) return;
  const btn = document.getElementById('addToCollectionBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Saving...';
  try {
    const summaryText = document.getElementById('summaryBody')?.innerText || '';
    const res = await fetch('/api/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url:       currentSummaryArticle.link,
        title:     currentSummaryArticle.title,
        summary:   summaryText,
        score:     currentSummaryArticle.score,
        threshold: similarityThreshold,
        source:    currentSummaryArticle.source,
        region:    currentSummaryArticle.region,
        pubDate:   currentSummaryArticle.pubDate,
        thumbnail: currentSummaryArticle.thumbnail || null,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      btn.textContent = '✅ Clipped!';
      btn.style.borderColor = 'var(--accent)';
    } else {
      btn.textContent = '❌ ' + (data.error || 'Failed');
      btn.disabled = false;
    }
  } catch(err) {
    btn.textContent = '❌ Error';
    btn.disabled = false;
  }
}

// ── Summarise ─────────────────────────────────────────────────────────────────
async function summariseArticle(idx) {
  const article = currentResults[idx];
  if (!article) return;
  currentSummaryArticle = article;

  const addBtn = document.getElementById('addToCollectionBtn');
  if (addBtn) { addBtn.disabled = true; addBtn.textContent = '⏳ Summarising...'; addBtn.style.opacity = '0.4'; }

  document.getElementById('summaryTitle').textContent = article.title;
  document.getElementById('summaryBody').innerHTML =
    '<div style="color:var(--muted);font-family:IBM Plex Mono,monospace;font-size:12px">⏳ Summarising with ' + article.title.slice(0,40) + '...</div>';
  document.getElementById('summaryModel').textContent = '';
  document.getElementById('summaryLink').href = article.link;
  document.getElementById('summaryOverlay').classList.add('open');

  const btn = document.querySelector(`.summarise-btn[onclick="summariseArticle(${idx})"]`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }

  try {
    const res = await fetch('/api/summarise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: article.title, link: article.link, rssDescription: article.summary || '' }),
    });
    const data = await res.json();

    if (data.error) {
      document.getElementById('summaryBody').innerHTML = '<span style="color:var(--danger)">❌ ' + esc(data.error) + '</span>';
      return;
    }

    const lines   = data.summary.split('\n').filter(l => l.trim());
    const bullets = lines.map(line => {
      const text = line.replace(/^[-•*·▪▸]+\s*/, '').trim();
      return text ? '<div class="bullet"><span class="bullet-dot">▸</span><span>' + esc(text) + '</span></div>' : '';
    }).join('');
    document.getElementById('summaryBody').innerHTML = bullets || esc(data.summary);

    const levelLabel = { full_article: '📄 full article', rss_description: '📰 RSS description', title_only: '📝 title only' };
    const cacheLabel = data.cached ? ' · ⚡ cached' : '';
    document.getElementById('summaryModel').textContent =
      '🤖 ' + (data.model || 'AI') +
      (data.level ? ' · ' + (levelLabel[data.level] || data.level) : '') + cacheLabel;

    const addBtnDone = document.getElementById('addToCollectionBtn');
    if (addBtnDone) { addBtnDone.disabled = false; addBtnDone.textContent = '✂️ Add to Clippings'; addBtnDone.style.opacity = '1'; }

  } catch (err) {
    document.getElementById('summaryBody').innerHTML = '<span style="color:var(--danger)">❌ ' + esc(err.message) + '</span>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖'; }
  }
}

function closeSummaryModal(e) { if (e.target === document.getElementById('summaryOverlay')) closeSummaryOverlay(); }
function closeSummaryOverlay() { document.getElementById('summaryOverlay').classList.remove('open'); }

// ── About Modal ──────────────────────────────────────────────────────────────
function openAboutModal() {
  document.getElementById('aboutVersion').textContent = 'v' + APP_VERSION;
  document.getElementById('aboutDesc').textContent = APP_DESCRIPTION;
  document.getElementById('aboutOverlay').classList.add('open');
}
function closeAboutModal(e) { if (e.target === document.getElementById('aboutOverlay')) closeAboutOverlay(); }
function closeAboutOverlay() { document.getElementById('aboutOverlay').classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAboutOverlay(); });

// ── Cache Status ──────────────────────────────────────────────────────────────
async function updateCacheStatus() {
  try {
    const res  = await fetch('/api/cache-status');
    const data = await res.json();
    const el   = document.getElementById('cacheAge');
    if (!el) return;
    const { rssCache, vectorCache } = data;
    if (rssCache.sites === 0) {
      el.textContent = '📡 Feed data: not loaded yet';
      el.className   = 'cache-age empty';
    } else {
      const vec = vectorCache.titles > 0 ? ` · ${vectorCache.titles} vectors` : '';
      el.textContent = `📡 Feed data: ${rssCache.label} · ${rssCache.sites} sites${vec}`;
      el.className   = 'cache-age ' + (rssCache.ageMins < 5 ? 'fresh' : rssCache.ageMins < 15 ? '' : 'stale');
      el.title       = `Cache expires in ${rssCache.expiresIn}s · TTL: ${Math.floor(rssCache.ttlMs/60000)} mins`;
    }
  } catch(e) {}
}

async function refreshCache() {
  const btn = document.getElementById('refreshBtn');
  btn.textContent = '⏳'; btn.disabled = true;
  try {
    await fetch('/api/cache-refresh', { method: 'POST' });
    document.getElementById('cacheAge').textContent = '📡 Feed data: refreshed — will reload on next search';
    document.getElementById('cacheAge').className   = 'cache-age empty';
  } catch(e) {}
  btn.textContent = '🔄'; btn.disabled = false;
}

updateCacheStatus();
setInterval(updateCacheStatus, 30000);

// ── Drag to Select ────────────────────────────────────────────────────────────
let dragSelecting = false, dragPending = false, dragStartState = null, dragStartItem = null;

function endDrag() {
  dragSelecting = dragPending = false; dragStartState = dragStartItem = null;
  document.querySelectorAll('.site-item.drag-hover').forEach(el => el.classList.remove('drag-hover'));
}

document.addEventListener('mousedown', e => {
  const item = e.target.closest('.site-item'); if (!item) return;
  const cb = item.querySelector('input[type=checkbox]'); if (!cb) return;
  dragPending = true; dragStartItem = item; dragStartState = !cb.checked;
});

document.addEventListener('mousemove', e => {
  if (!dragPending && !dragSelecting) return;
  const item = e.target.closest('.site-item'); if (!item) return;
  if (dragPending && item !== dragStartItem) {
    dragPending = false; dragSelecting = true;
    const firstCb = dragStartItem?.querySelector('input[type=checkbox]');
    if (firstCb) { firstCb.checked = dragStartState; dragStartItem.classList.add('drag-hover'); }
  }
  if (dragSelecting) {
    const cb = item.querySelector('input[type=checkbox]');
    if (cb) { cb.checked = dragStartState; item.classList.add('drag-hover'); }
  }
});

document.addEventListener('mouseup', endDrag);
document.addEventListener('mouseleave', endDrag);

// ── Clip from Preview ─────────────────────────────────────────────────────────
async function clipArticle(btn, articleJson) {
  const article = typeof articleJson === 'string' ? JSON.parse(decodeURIComponent(articleJson)) : articleJson;
  btn.className = 'clip-btn saving'; btn.textContent = '⏳'; btn.disabled = true;

  try {
    const saveRes = await fetch('/api/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: article.link, title: article.title, summary: '', source: article.source, region: article.region, pubDate: article.pubDate, thumbnail: article.thumbnail || null }),
    });
    const saveData = await saveRes.json();
    if (!saveData.ok) throw new Error(saveData.error || 'Save failed');

    fetch('/api/collection/embed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: article.title, newsId: saveData.newsId }),
    });

    btn.className = 'clip-btn saved'; btn.textContent = '🤖'; btn.title = 'Summarising…';

    try {
      const sumRes  = await fetch('/api/summarise', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: article.title, link: article.link, rssDescription: article.summary || '' }),
      });
      const sumData = await sumRes.json();
      if (sumData.summary && !sumData.error) {
        await fetch('/api/collection/summary', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: saveData.newsId, summary: sumData.summary }),
        });
        fetch('/api/collection/update-vector', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: article.title, summary: sumData.summary, newsId: saveData.newsId }),
        });
        btn.textContent = '✅'; btn.title = 'Clipped + summarised!';
      } else {
        btn.textContent = '✅'; btn.title = 'Clipped! (summary unavailable)';
      }
    } catch { btn.textContent = '✅'; btn.title = 'Clipped! (summary failed)'; }

  } catch(err) {
    btn.className = 'clip-btn error'; btn.textContent = '❌'; btn.title = 'Error: ' + err.message; btn.disabled = false;
  }
}

// ── Sidebar Toggle (mobile) ───────────────────────────────────────────────────
function toggleSidebar() {
  const aside = document.querySelector('aside');
  const btn   = document.getElementById('sidebarToggle');
  const open  = aside.classList.toggle('open');
  btn.textContent = open ? '✕ Sources' : '☰ Sources';
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadSites();
setTimeout(() => loadSuggestedKeywords(), 500);
