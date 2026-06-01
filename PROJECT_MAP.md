# PROJECT_MAP.md — newsLookup Gen2
> Paste this file at the start of any new AI chat to instantly establish full system context.
> Then feed individual files only when needed. **Do not dump all files at once.**

**Companion documents:**
- `ROADMAP.md` — planned features and completed milestones
- `RELEASE_NOTE.md` — detailed per-version changelogs
- `README.md` — setup guide, configuration reference, API endpoints

---

## 🗺 What This App Does
A local news search engine that:
1. Fetches RSS feeds from configurable news sites
2. Uses a **local Ollama embedding model** to semantically match articles to user queries
3. Streams matched results in real-time via SSE
4. Lets users save articles to a **clippings collection** with AI-generated summaries and tags
5. Suggests trending keywords from today's headlines via an AI reasoning model
6. Exposes a **runtime settings system** — all tuneable parameters stored in a JSON file, manageable via REST API and a settings UI page

---

## 🏗 File Structure & Responsibility

```
newsLookup/
│
├── server.js               # Entry point. Calls loadSettings() FIRST, then loads
│                           # sites JSON, inits DBs, mounts all routers, starts Express.
│                           # Imports getSetting() for startup log (embed threshold).
│
├── config.js               # Single source of truth for all env vars:
│                           # AI_MODEL, AI_API_KEY, AI_BASE_URL (cloud AI)
│                           # EMBED_MODEL, EMBED_BASE_URL (local)
│                           # DB_PATH, COLLECTION_PATH, SITES_PATH, PROFILES_PATH
│                           # NOTE: secrets/infra only — tuneable runtime values
│                           #       live in config/app-settings.json instead.
│                           # REMOVED: EMBED_THRESHOLD, RSS_CACHE_TTL (moved to app-settings.json)
│
├── config/
│   ├── app-settings.default.json
│   │                       # Canonical defaults + full _meta schema.
│   │                       # Tracked in Git — update this when adding new settings.
│   │                       # Never modified by the running app.
│   │
│   └── app-settings.json   # User's live runtime values. NOT tracked in Git.
│                           # Auto-created from app-settings.default.json on first boot.
│                           # lib/settings.js deep-merges: defaults first, user values on top.
│                           # DO NOT store secrets here — env vars only for those.
│                           # search.embedThreshold range: 0.4–0.9 (slider range matches)
│
├── db/
│   ├── articlesDb.js       # SQLite: articles table (search history) +
│   │                       # suggested_keywords_cache table.
│   │                       # Exports: db, initDB(), saveDB(),
│   │                       #          insertArticle(), dateFilterSQL()
│   │
│   └── collectionDb.js     # SQLite: collection table (saved clippings) +
│                           # summary_cache table.
│                           # Exports: collectionDb, initCollectionDB(),
│                           #          saveCollectionDB(),
│                           #          getCachedSummary(), cacheSummary()
│
├── lib/
│   ├── settings.js         # Runtime settings manager.
│   │                       # Loads app-settings.default.json (Git) as base, then
│   │                       # merges app-settings.json (user) on top at startup.
│   │                       # Keeps in-memory copy for synchronous reads.
│   │                       # Exports: loadSettings(), getSetting(dotPath),
│   │                       #          setSetting(dotPath, value), getAllSettings(),
│   │                       #          getSchema(), resetToDefaults()
│   │                       # RULE: getSetting() is synchronous — safe on hot paths.
│   │                       # RULE: No imports from routes/* or db/*.
│   │                       # RULE: flushToDisk() only writes app-settings.json (never default).
│   │
│   ├── embedding.js        # Local Ollama embed client (ollamaLocal).
│   │                       # In-memory: rssCache, articleVectorCache, embedCache.
│   │                       # Exports: getEmbedding(), cosineSimilarity(),
│   │                       #          isRelevant(), getRssCacheAge()
│   │                       # NOTE: isRelevant() logs articles scoring ≥30% to console
│   │                       #       (debug only — does not affect returned results)
│   │
│   ├── rss.js              # RSS fetch + in-process cache.
│   │                       # TTL read live via getSetting('rss.cacheTtlMinutes') —
│   │                       # settings UI changes take effect immediately, no restart.
│   │                       # Exports: fetchRSS(), fetchRSSFromNet()
│   │
│   └── ai.js               # Cloud Ollama client (ollama).
│                           # Exports: callAI(), stripHtml(),
│                           #          loadModelProfiles(), getModelOptions()
│                           # ⚠ ollama npm package MUST stay at ^0.5.0 —
│                           #   newer versions load browser.mjs under Node ESM,
│                           #   causing fetch failed on all AI calls.
│
├── routes/
│   ├── settings.js         # GET    /api/settings          — full settings object
│   │                       # GET    /api/settings/schema   — flattened schema for UI
│   │                       # GET    /api/settings/:domain  — one domain object
│   │                       # PATCH  /api/settings/:domain  — partial update + disk flush
│   │                       # POST   /api/settings/reset    — restore all defaults
│   │
│   ├── search.js           # POST /api/search (SSE stream, embed + keyword fallback)
│   │                       # GET  /api/sites, PUT /api/sites
│   │                       # GET  /api/test-rss, /api/debug-embed,
│   │                       #      /api/embed-config, /api/cache-status
│   │                       # POST /api/cache-refresh
│   │                       # Needs init(sites) called by server.js
│   │                       # THRESHOLD: uses slider value directly — NO auto-scaling.
│   │                       #   effectiveThreshold = threshold (from request body)
│   │                       #   tokenToThreshold() and autoAdjustThreshold() REMOVED.
│   │
│   ├── history.js          # GET  /api/history   (filter, search, date)
│   │                       # DELETE /api/history
│   │
│   ├── summarise.js        # POST /api/summarise
│   │                       # 3-level fallback: full page → RSS desc → title only
│   │                       # Writes to summary_cache in collectionDb
│   │
│   ├── collection.js       # Full CRUD for /api/collection/*
│   │                       # Includes: save, embed, update-vector, search (semantic),
│   │                       #           suggest-tags, patch tags, delete, export/import
│   │                       # suggest-tags reads threshold via getSetting() — not hardcoded
│   │
│   └── keywords.js         # GET  /api/suggested-keywords  (read cache)
│                           # POST /api/suggested-keywords/generate (AI + RSS titles)
│                           # maxSuggested read live via getSetting() — not hardcoded
│                           # Needs init(sites) called by server.js
│                           # FILTER: keywords with count=0 are dropped before saving —
│                           #   only keywords that appear in ≥1 actual headline are kept.
│                           #   Prevents AI hallucinated keywords from appearing in UI.
│                           # MAX_TITLES_FOR_AI — configurable via getSetting("keywords.maxTitlesForAI").
│                           #   Replaces old hardcoded value. Adjustable per model via Settings screen.
│                           #   When total titles > cap, a random sample is taken so all
│                           #   sites get fair representation (not just first N feeds).
│
├── setup-windows.ps1       # Windows setup script. Checks Node/Ollama versions,
│                           # prompts Cloud or Local mode, pulls embed + AI models,
│                           # runs npm install, creates .env.
│
├── setup-linux.sh          # Linux setup script. Same flow as setup-windows.ps1
│                           # but uses bash, systemd service instructions, and ufw
│                           # firewall guidance.
│
├── uninstall-windows.ps1   # Windows uninstall script. Stops Ollama, uninstalls via
│                           # winget, optionally deletes model folder + project config
│                           # files (.env, rss-sites.json, node_modules).
│
├── uninstall-linux.sh      # Linux uninstall script. Same flow as uninstall-windows.ps1
│                           # but uses systemd/pkill and rm for cleanup.
│
└── public/
    │
    │   # ── Shared (loaded by ALL pages) ───────────────────────────
    ├── common/
    │   ├── common.css      # Design tokens (:root), reset, body, header, .logo, scrollbar.
    │   │                   # Single source of truth — fixes token drift that existed in
    │   │                   # settings.html (was --bg:#0e0f11 vs others #0d0f12).
    │   └── common.js       # Shared utilities: esc(s) HTML-escape function.
    │
    │   # ── Page-specific CSS ────────────────────────────────────────
    ├── css/
    │   ├── index.css       # All styles for index.html (layout, chat, results, modals,
    │   │                   # keywords bar, mobile cards, responsive breakpoints).
    │   ├── collection.css  # All styles for collection.html (cards, tag editor,
    │   │                   # tag autocomplete, filters, responsive).
    │   ├── editor.css      # All styles for editor.html (site list, form fields,
    │   │                   # test result panel, duplicate modal, responsive).
    │   └── settings.css    # All styles for settings.html (topbar, domain cards,
    │                       # setting rows, sliders, toggles, skeleton loader).
    │
    │   # ── Page-specific JS ─────────────────────────────────────────
    ├── js/
    │   ├── index.js        # All JS for index.html: search (SSE streaming), results
    │   │                   # table + mobile cards, sort/export, suggested keywords,
    │   │                   # history panel, summary modal, preview modal, clip,
    │   │                   # sidebar toggle, drag-select, cache status.
    │   │                   # AUTO-RETRY: zero results → retries at 30% threshold.
    │   │                   # showKwError(msg) — displays AI error in keyword area
    │   │                   #   when /generate returns error or empty keywords.
    │   ├── collection.js   # All JS for collection.html: load/filter/render clippings,
    │   │                   # AI search, tag editor + autocomplete + AI suggestions,
    │   │                   # summarise, export/import, re-embed missing vectors.
    │   ├── editor.js       # All JS for editor.html: site list CRUD, RSS test,
    │   │                   # duplicate feed finder, dirty tracking, toast notifications.
    │   └── settings.js     # All JS for settings.html: schema-driven card render,
    │                       # boolean toggles, numeric sliders, save/reset.
    │
    │   # ── HTML (structure only — no inline CSS or JS) ──────────────
    ├── index.html          # Main search UI. Loads: common.css → index.css → common.js → index.js
    │                       # Toolbar: Clippings | History | Settings | Clear.
    │                       # Similarity slider: 40%–90%, default 50%, step 5%.
    │                       #   Shows "score ≥ N%" label. Value sent directly as threshold.
    │                       #   NO auto-scaling — slider value = effective threshold.
    ├── collection.html     # Saved clippings manager ("My Clippings").
    │                       # Loads: common.css → collection.css → common.js → collection.js
    ├── settings.html       # App settings UI — auto-renders from /api/settings/schema.
    │                       # Loads: common.css → settings.css → common.js → settings.js
    │                       # Grouped cards per domain, sliders + toggles per type,
    │                       # per-row save, reset-all button.
    │                       # hidden:true items in _meta are filtered out before rendering.
    └── editor.html         # RSS site editor.
                            # Loads: common.css → editor.css → common.js → editor.js
```

---

## 🔗 Dependency Flow
```
config.js
  └── config/app-settings.default.json  ← base defaults, loaded by lib/settings.js at startup
  └── config/app-settings.json          ← user values, merged on top by lib/settings.js
  └── lib/settings.js           ← no db/routes imports; synchronous reads
  └── db/articlesDb.js
  └── db/collectionDb.js
        └── lib/embedding.js    ← uses ollamaLocal (local Ollama)
        └── lib/rss.js          ← uses rssCache from embedding.js; TTL via getSetting()
        └── lib/ai.js           ← uses ollama (cloud Ollama)
              └── routes/settings.js   ← lib/settings.js only
              └── routes/search.js     ← threshold passed directly from request body
              └── routes/history.js
              └── routes/summarise.js
              └── routes/collection.js ← getSetting() for suggestedTagsThreshold
              └── routes/keywords.js   ← getSetting() for maxSuggested
                    └── server.js  ← calls loadSettings() + getSetting() before mounting routes
```
> **Rule:** Routes import from `lib/` and `db/`. Libs never import from routes. No circular deps.
> **Rule:** `config.js` = secrets + infra (env vars). `app-settings.json` = tuneable runtime values. Never overlap.
> **Rule:** All tuneable values must use `getSetting()` at call time — never cache at module load.
> **Rule:** Threshold is always passed from the client slider — backend never overrides or scales it.
> **Rule:** `app-settings.default.json` is the Git-tracked canonical schema. `app-settings.json` is the user's live file — never commit it.

---

## ⚙️ Key Runtime Behaviours

| Behaviour | Where it lives |
|---|---|
| ~~Auto threshold scaling by query word count~~ | **REMOVED** — `tokenToThreshold()` and `autoAdjustThreshold()` deleted |
| Slider value used directly as threshold | `routes/search.js` → `effectiveThreshold = threshold` (no offsets) |
| Slider range: 40%–90%, default 50% | `public/css/index.css` + `public/js/index.js` → slider HTML in index.html, updateThreshold() in index.js |
| Slider label: "score ≥ N%" | `public/js/index.js` → updateThreshold() shows percentage format |
| Auto-retry at 30% on zero results | `public/js/index.js` → done handler retry block (RETRY_THRESHOLD = 0.30) |
| RSS TTL cache (configurable, in-memory) | `lib/rss.js` → `getSetting('rss.cacheTtlMinutes')` read on every fetch |
| Embedding cache (per title, in-memory) | `lib/embedding.js` (articleVectorCache, embedCache) |
| Keyword fallback when embed model offline | `routes/search.js` → keyword mode branch (hidden in UI, active in backend) |
| 3-level summarise fallback | `routes/summarise.js` |
| Summary dedup cache (SQLite) | `db/collectionDb.js` → summary_cache table |
| Sites list shared across routers | `server.js` → calls `init(sites)` on search + keywords routers |
| Keyword hallucination filter | `routes/keywords.js` → `.filter(k => k.count > 0)` before DB save |
| **AI titles cap (configurable)** | `routes/keywords.js` → `getSetting("keywords.maxTitlesForAI")`; random sample when titles exceed cap. Default 350, range 50–400 (step 50). Tune down for smaller/local models to avoid overload; tune up for better keyword coverage on cloud models. |
| **Keyword error shown in UI** | `public/js/index.js` → `showKwError()` on API error or empty result |
| **Suggested tags threshold (configurable)** | `getSetting('collection.suggestedTagsThreshold')` (default: 80) |
| **Embed threshold (configurable, UI-hidden)** | `getSetting('search.embedThreshold')` (default: 0.5, hidden from settings UI) |
| **Max keywords (configurable)** | `getSetting('keywords.maxSuggested')` (default: 10, range: 10–20) |
| **RSS TTL (configurable)** | `getSetting('rss.cacheTtlMinutes')` (default: 15, range: 15–60 min) |
| **Runtime settings load** | `server.js` → `loadSettings()` before any route mounts |
| **Settings persist to disk** | `lib/settings.js` → flushes to `config/app-settings.json` on every write |
| **Settings UI hidden items** | `hidden:true` in `_meta` → filtered in `settings.html` before render |

---

## 🌐 External Services

| Service | Used for | Config key |
|---|---|---|
| Ollama (local) | Embedding (always) | `EMBED_BASE_URL` (default: localhost:11434) |
| Ollama (local) | Summaries, keywords, tags (local mode) | `AI_BASE_URL=http://localhost:11434` + `AI_MODEL=qwen2.5:7b` |
| Ollama (cloud) | Summaries, keywords, tags (cloud mode) | `AI_BASE_URL=https://ollama.com` + `AI_API_KEY` |
| RSS feeds | Article source | `rss-sites.json` (managed via `/api/sites`) |

---

## 🗄 Databases (SQLite via sql.js)

**articles.db** — `db/articlesDb.js`
- `articles` — search history (source, title, link, pubDate, topic, score)
- `suggested_keywords_cache` — AI keyword results keyed by (region, dateFilter)

**collection.db** — `db/collectionDb.js`
- `collection` — saved clippings with vector, tags, summary, score
- `summary_cache` — deduped summaries keyed by URL

**config/app-settings.json** — `lib/settings.js` (file-backed, not SQLite)

| Key | Default | Range | UI Visible | Notes |
|---|---|---|---|---|
| `collection.suggestedTagsThreshold` | 80 | 0–100 | ✅ | Min AI tag confidence score |
| `search.embedThreshold` | 0.5 | 0.4–0.9 | ❌ hidden | index.html slider controls this at search time |
| `search.keywordFallbackEnabled` | true | boolean | ❌ hidden | Fallback when embed model offline |
| `rss.cacheTtlMinutes` | 15 | 15–60 | ✅ | RSS in-memory cache TTL in minutes |
| `keywords.maxSuggested` | 10 | 10–20 | ✅ | Max trending keywords returned |
| `keywords.maxTitlesForAI` | 350 | 50–400 (step 50) | ✅ | Max headlines sent to AI for keyword extraction |

---

## 🧩 Context-on-Demand Cheat Sheet

| Task | Files to provide |
|---|---|
| Fix search ranking / threshold logic | `routes/search.js` + `lib/embedding.js` |
| Change how RSS is fetched or cached | `lib/rss.js` |
| Modify summary levels or caching | `routes/summarise.js` + `db/collectionDb.js` |
| Add a new API route | `server.js` (mount) + new `routes/xxx.js` |
| Change AI model or auth | `config.js` + `lib/ai.js` + `setup-windows.ps1` + `setup-linux.sh` + `uninstall-windows.ps1` + `uninstall-linux.sh` |
| Fix collection save / tag logic | `routes/collection.js` |
| Keyword generation changes | `routes/keywords.js` + `lib/ai.js` — note: ollama@0.5.0 only, MAX_TITLES_FOR_AI via `getSetting("keywords.maxTitlesForAI")` |
| Schema changes | `db/articlesDb.js` or `db/collectionDb.js` |
| Env vars / constants | `config.js` only |
| **Add a new tuneable parameter** | `lib/settings.js` (HARDCODED_DEFAULTS) + `config/app-settings.default.json` |
| **Change settings API behaviour** | `routes/settings.js` + `lib/settings.js` |
| **Fix settings UI rendering** | `public/js/settings.js` + `public/css/settings.css` |
| **Hide/show a setting in UI** | `config/app-settings.default.json` → `_meta.hidden: true/false` |
| **Fix index.html threshold/slider** | `public/js/index.js` → updateThreshold() + slider HTML in index.html |
| **Fix zero-results auto-retry** | `public/js/index.js` → done handler retry block (RETRY_THRESHOLD = 0.30) |
| **Fix keyword hallucinations** | `routes/keywords.js` → `.filter(k => k.count > 0)` in keywordsWithCount |
| **Update planned / completed tasks** | `ROADMAP.md` |
| **Add a release entry** | `RELEASE_NOTE.md` |

---

## 💬 Suggested Chat Openers (copy & paste)

**For a focused fix:**
> "Here is my `PROJECT_MAP.md`. I want to [fix / optimise / add] X.
> Acknowledge the architecture first, then I'll paste the relevant file."

**For a bug hunt:**
> "Here is my `PROJECT_MAP.md`. I'm seeing [symptom]. Based on the map,
> which file is most likely responsible? I'll paste that file next."

**For a new feature:**
> "Here is my `PROJECT_MAP.md`. I want to add [feature].
> Tell me which files I need to create or modify before I paste any code."
