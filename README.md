
# 📡 newsLookup Gen2 — AI-Powered News Intelligence

> Stop keyword-hunting. Start understanding your news.

**newsLookup Gen2** is an open-source, self-hosted news monitoring platform that demonstrates how **two cutting-edge AI technologies** work together in a real-world application:

- 🔍 **Semantic Embedding** (`qwen3-embedding:8b`) — converts your query and article titles into high-dimensional vectors, finding meaning through mathematics rather than keyword matching
- 🤖 **Retrieval-Augmented Generation / RAG** (`gpt-oss:120b-cloud`) — retrieves full article content and generates concise summaries, grounding the reasoning model in real retrieved facts

Unlike traditional keyword monitors that miss synonyms, abbreviations and cross-language references, Gen2 understands **meaning**. Ask `"latest AI breakthroughs this week"` and it finds relevant articles even if none of them contain those exact words. This app is a **practical demonstration** of how embedding and RAG solve different problems — and how combining them creates something greater than either alone.

---

## 🧠 The AI Stack — Two Models, Two Roles

```
RSS feeds → qwen3-embedding:8b → Vector search (cosine similarity)
                                          ↓
                              Relevant articles found
                                          ↓
                      gpt-oss:120b-cloud (RAG) → 3-bullet summary
                                          ↓
                                   My Clippings ✂️
```

**🔍 Embedding Model (`qwen3-embedding:8b`) — Semantic Search**
Converts your query and every article title into high-dimensional vectors. Similarity is pure mathematics — cosine distance computed locally in milliseconds using Float32Array optimisation. One embedding call per search, not one per article. Your CPU fan might spin, but your API bill won't.

**🤖 Reasoning Model (`gpt-oss:120b-cloud`) — Summarisation via RAG**
`gpt-oss:120b-cloud` retrieves and reads article content then generates concise 3-bullet summaries — Retrieval-Augmented Generation (RAG) in action. Intelligent fallback chain: full article page → RSS description → title-only for paywalled sites. Summaries cached permanently in SQLite — never pay twice for the same article.

---

## ✨ Features

- **Semantic search** — `qwen3-embedding:8b` running 100% locally, free forever
- **RAG summarisation** — `gpt-oss:120b-cloud` (reasoning model) generates 3-bullet summaries with intelligent fallback
- **AI keyword suggestions** — trending keywords auto-generated from today's headlines; click to search instantly
- **Multilingual** — English, 繁體中文, Cantonese or mix all three in one query
- **Intelligent caching** — RSS feeds (15 min TTL) + article vectors (permanent) = 2nd search in ~3 seconds
- **Float32Array optimised** — handles 10,000 clipping records at ~50ms per search
- **Date filters** — Today, Yesterday, This Week, 2 Weeks, Month, Year to Date, All
- **Quick Scan** — browse Today / Yesterday / Week / All Time headlines before searching
- **Drag-to-select** sites — hold and drag to select multiple sites instantly
- **Similarity threshold** — manual slider for fine-tuning (40%–90%)
- **Search history** — session memory for prompt and threshold tuning
- **✂️ My Clippings** — personal AI news archive with natural language vector search
- **Clipping tags** — tag saved articles for grouping and fast filtered search; AI suggests tags automatically
- **Summary cache** — summaries stored in SQLite, never regenerated for same article
- **RSS Site Editor** — duplicate detector, live feed testing, staleness detection
- **Export** — CSV and JSON with selectable results; full clipping export with tags
- **Runtime settings** — all tuneable parameters managed via a settings UI, no restart needed
- **Model profiles** — per-model parameters in hot-reloadable `model-profiles.json`
- **Debug endpoint** — `/api/debug-embed` for testing similarity scores directly

---

## 🖥️ Requirements

| Requirement | Version | Notes |
|---|---|---|
| Node.js | ≥ 22.0.0 | Required for ESM (`import`) support |
| npm | ≥ 8.0.0 | Comes with Node.js |
| Ollama | ≥ 0.24.0 | For local embedding model |
| Modern browser | Chrome, Edge, Firefox, Safari | For the web UI |

**Hardware for embedding model**

| RAM | Recommended model |
|---|---|
| 8 GB | `qwen3-embedding:0.6b` (~400MB, fast) |
| 16 GB+ | `qwen3-embedding:8b` (~5GB, best quality) ← recommended |

---

## 🤖 AI Provider Setup

newsLookup Gen2 uses **two separate AI roles**:

| Role | Model | Where |
|---|---|---|
| **Embedding** (semantic search) | `qwen3-embedding:8b` | Always local — free, no quota |
| **Reasoning** (summarisation via RAG) | `gpt-oss:120b-cloud` or `qwen2.5:7b` | Cloud or local |

> The embedding model **always runs locally** — it never uses cloud API quota.

**Ollama Cloud reasoning** — get your free API key at [ollama.com/settings/keys](https://ollama.com/settings/keys)

**Ollama Local reasoning** — requires sufficient RAM; set `AI_MODEL` in `.env` to your preferred local model

---

## 🚀 Installation

### Step 1 — Prerequisites

Install the following before running the setup script:

- **Node.js v22+** — [nodejs.org/en/download](https://nodejs.org/en/download) · if using nvm: `nvm install 22 && nvm use 22`
- **Ollama ≥ 0.24.0** — [ollama.com/download](https://ollama.com/download)
  - Windows: launch Ollama from the Start Menu (runs in system tray)
  - Linux: `sudo systemctl start ollama && sudo systemctl enable ollama`

### Step 2 — Clone the repository

```bash
git clone https://github.com/Thomas-Leung-852/newsLookup-Gen2.git
cd newsLookup-Gen2
```

### Step 3 — Run the setup script

The setup script handles everything: version checks, model pulls, `rss-sites.json`, `.env` creation and `npm install`.

**Windows (PowerShell):**
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\setup-windows.ps1
```

**Linux:**
```bash
chmod +x setup-linux.sh
./setup-linux.sh
```

**What the setup script does:**

| Step | Action |
|---|---|
| 1 | Check Node.js ≥ 22.0.0 and npm ≥ 8.0.0 |
| 2 | Check Ollama ≥ 0.24.0 |
| 3 | Ask: Cloud or Local AI mode → sets correct `.env` values |
| 4 | Offer to pull `qwen3-embedding:8b` (embed model) |
| 4 | Offer to pull `qwen2.5:7b` (local AI mode only) |
| 5 | Run `npm install` |
| 6 | Copy `rss-sites.json.template` → `rss-sites.json` if missing |
| 7 | Set server port (default: 3000) |
| 8 | Create `.env` with correct values (backs up existing `.env` if present) |

### Step 4 — Start the server

```bash
node server.js
```

Open your browser at `http://localhost:3000`

---

## 🗑️ Uninstall

To remove Ollama and project config files, run the uninstall script:

**Windows:**
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\uninstall-windows.ps1
```

**Linux:**
```bash
chmod +x uninstall-linux.sh
./uninstall-linux.sh
```

The uninstall script will ask for confirmation before removing each item: Ollama, pulled models (`~/.ollama`), `.env`, `rss-sites.json`, and `node_modules`. Node.js is never touched.

---

## ⚙️ Configuration

| Variable | Default | Description |
|---|---|---|
| `AI_API_KEY` | *(required)* | Ollama Cloud API key or `ollama` for local |
| `AI_BASE_URL` | `https://ollama.com` | Reasoning model base URL — set to `http://localhost:11434` for local Ollama |
| `AI_MODEL` | `gpt-oss:120b-cloud` | Reasoning model — performs summarisation via RAG |
| `EMBED_MODEL` | `qwen3-embedding:8b` | Local embedding model for semantic search |
| `EMBED_BASE_URL` | `http://localhost:11434` | Local Ollama URL for embedding |
| `PORT` | `3000` | HTTP server port |

> **Note:** RSS cache TTL and other tuneable parameters are managed via the in-app Settings UI (`http://localhost:3000/settings.html`), not environment variables. Settings are stored in `config/app-settings.json` (user file, not tracked in Git). Defaults and schema live in `config/app-settings.default.json` (tracked in Git). On startup, the app merges both — your changes are always preserved when you pull updates.

---

## 📁 Project Structure

```
newsLookup-Gen2/
├── server.js                   # Entry point — loads settings, mounts all routers, starts Express
├── config.js                   # Single source of truth for all env vars (AI, embed, paths)
├── package.json
├── package-lock.json
├── rss-sites.json.template     # RSS sites template — copy to rss-sites.json before first run
├── rss-sites.json              # Active RSS sites list (editable via built-in editor)
├── model-profiles.json         # Per-model Ollama parameters — hot-reloaded, no restart needed
├── articles.db                 # SQLite — search history + keyword cache (auto-created)
├── collection.db               # SQLite — My Clippings + summary cache (auto-created)
├── PROJECT_MAP.md              # Architecture reference — paste into any new AI chat for context
├── RELEASE_NOTE.md             # Release history
├── README.md
├── .gitignore
│
├── config/
│   ├── app-settings.default.json   # Canonical defaults + schema — tracked in Git, never modified by app
│   └── app-settings.json           # User's live runtime settings — not tracked in Git (in .gitignore)
│
├── public/
│   ├── index.html              # Main search UI
│   ├── collection.html         # My Clippings
│   ├── settings.html           # App settings UI
│   └── editor.html             # RSS Site Editor
│
├── routes/
│   ├── search.js               # POST /api/search (SSE), sites, cache, debug endpoints
│   ├── collection.js           # Full CRUD for /api/collection/*
│   ├── summarise.js            # POST /api/summarise — 3-level fallback + cache
│   ├── keywords.js             # GET/POST /api/suggested-keywords
│   ├── history.js              # GET/DELETE /api/history
│   └── settings.js             # GET/PATCH /api/settings
│
├── lib/
│   ├── embedding.js            # Local Ollama embed client, cosine similarity, RSS vector cache
│   ├── rss.js                  # RSS fetch + in-memory cache (TTL via getSetting)
│   ├── ai.js                   # Cloud Ollama client, model profiles
│   └── settings.js             # Runtime settings manager — synchronous getSetting()
│
├── db/
│   ├── articlesDb.js           # SQLite: articles + suggested_keywords_cache tables
│   └── collectionDb.js         # SQLite: collection + summary_cache tables
│

├── setup-windows.ps1           # Windows setup script
├── setup-linux.sh              # Linux setup script
├── uninstall-windows.ps1       # Windows uninstall script
└── uninstall-linux.sh          # Linux uninstall script
```

---

## 🌏 Supported Languages

| Language | Example query |
|---|---|
| English | `latest AI breakthroughs this week` |
| 繁體中文 | `香港樓市, 加息, 政府政策` |
| 廣東話 | `炒樓, 大跌市, 派錢` |
| Natural language | `any news about electric vehicle market?` |
| Mixed | `香港科技行業 latest developments` |

---

## 🔌 API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sites` | Return all RSS sites |
| `PUT` | `/api/sites` | Save + sort sites to file |
| `POST` | `/api/search` | Stream search (SSE) — `{ keywords, sites, dateFilter, threshold }` |
| `GET` | `/api/test-rss?url=` | Test RSS feed — articles, dates, staleness |
| `GET` | `/api/embed-config` | Current embedding config |
| `GET` | `/api/debug-embed?query=&article=` | Test similarity score between two texts |
| `POST` | `/api/summarise` | RAG summarise — fallback chain + cache |
| `GET` | `/api/get-vector?title=` | Get embedding vector for a title |
| `GET` | `/api/collection` | List My Clippings |
| `POST` | `/api/collection` | Save to My Clippings |
| `DELETE` | `/api/collection/:id` | Remove clipping |
| `POST` | `/api/collection/search` | Vector search across clippings |
| `POST` | `/api/collection/summary` | Update summary for clipping |
| `GET` | `/api/suggested-keywords` | Get AI-generated trending keywords |
| `POST` | `/api/suggested-keywords/generate` | Trigger keyword generation from headlines |
| `GET` | `/api/settings` | Get all runtime settings |
| `PATCH` | `/api/settings/:domain` | Update a settings domain |
| `GET` | `/api/cache-status` | RSS + vector cache stats |
| `POST` | `/api/cache-refresh` | Force RSS cache refresh |
| `GET` | `/api/history?filter=&q=` | Query article history |

---

## 📸 Screenshots

![](https://static.wixstatic.com/media/0d7edc_55a7c75278fd41a3bcc446d2d6e9505d~mv2.png)
![](https://static.wixstatic.com/media/0d7edc_20411a528eb742b9bd65a4a16db7c034~mv2.png)
![](https://static.wixstatic.com/media/0d7edc_429d230a1bdf4821ba5f6d086ef4f1a8~mv2.png)

---

## 🗺️ Roadmap

- [ ] Scheduled auto-scan with daily digest
- [ ] Sentiment analysis per result
- [ ] Duplicate / same-story detection across sites
- [ ] Telegram / WhatsApp digest bot
- [ ] History browser UI

---

## 📜 History

| Version | Notes |
|---|---|
| Gen2 Ver 1.3.0 | Setup & uninstall scripts for Windows and Linux; `dotenv` integration so `.env` is loaded correctly; README restructured with setup guide and accurate project structure; configurable `keywords.maxTitlesForAI` setting; mobile UI refinements |
| Gen2 Ver 1.2.0 | Tags for clippings, AI keyword suggestions, monolith-to-modules refactor, export fix |
| Gen2 Ver 1.1.0 | Import/export for My Clippings, responsive UI, re-embedding API |
| Gen2 Ver 1.0.0 | Full rewrite — RAG + embedding, Express UI, SQLite, My Clippings, RSS Editor |
| v1.x (retired) | Node.js CLI, exact keyword matching, HTML crawling |

The original version is archived at [newsLookup (retired)](https://github.com/Thomas-Leung-852/newsLookup).

---

## 🤝 Vibe Coding — Built Entirely Through Conversation

**Vibe coding** is a development workflow where you direct *what* to build through natural language, and the AI figures out *how*. No syntax memorisation, no manual code writing — just architecture decisions, honest feedback, and precise description of symptoms when things go wrong.

This application was **entirely built through vibe coding** using [Claude Desktop](https://claude.ai) (Anthropic's Claude Sonnet) — every file, every feature, every bug fix was generated through conversation and reviewed by a human before being applied.

### Why Claude Desktop, not an IDE integration?

Several local-AI coding setups were tried before settling on Claude Desktop — including VS Code with the continue.dev extension running a QWEN code agent via Ollama. On a machine with no GPU and 32 GB RAM, local code agents were too slow for an iterative workflow, and code application was sometimes incorrect, requiring rollbacks. Claude Desktop with cloud inference removed the hardware bottleneck entirely and kept the feedback loop fast enough to stay productive.

This also shaped a core architectural decision: keep the embedding model local and lightweight (free, no quota, runs on CPU), while routing the reasoning workload to the cloud — the same trade-off that made the development workflow viable applies to the app itself.

v1.2.0 also included a full refactor from a monolithic single file to a modular project structure — a deliberate decision to reduce context window pressure in future development sessions, not just a code quality improvement.

### The Author's Role

- **Direct the architecture** — deciding what to build and why
- **Review every change** — reading and understanding generated code before applying it
- **Catch design flaws** — questioning decisions, pushing back when something felt wrong
- **Prompt for quality** — using natural language to optimise performance (e.g. Float32Array for vector operations) and ensure code safety
- **Hunt bugs by reading** — tracing actual runtime behaviour to identify root causes the AI had missed, then describing the symptom precisely enough for the AI to diagnose and fix it
- **Manage context window decay** — recognising when a conversation had grown too long to be reliable; solving problem A would silently introduce problem B, and the only escape was to open a fresh context and re-state the problem cleanly
- **Know when not to over-prompt** — keeping requests focused (e.g. "code block only") to preserve context quality

### Traditional vs. Vibe Coding

| Phase | Traditional Development | Vibe Coding |
|---|---|---|
| **Bottleneck** | Learning syntax & debugging typos | Context window decay & logical loops |
| **Primary Skill** | Memorising APIs & libraries | Architecture design & code auditing |
| **Debugging** | Breakpoints & IDE tools | Tracing logic by reading & precise prompting |
| **Speed** | Linear — feature by feature | Non-linear — systems designed top-down |
| **Knowledge Floor** | Must understand the full stack | Must understand *what* to build and *why* — the AI handles *how* |

### What This Project Proves

The developer directed *what* to build and *why*; the AI figured out *how*. Neither could have produced *this* app alone — because the architecture decisions, the tolerance for technical debt, the choice of SQLite over Postgres, the decision to keep embedding local and free — those judgements shaped everything. The AI executed; you designed.

> *"Your design is correct. The whole point of Gen2 is that users can type anything naturally."*  
> — Claude, during development

> *"line 968 always returns zero."*  
> — Thomas, finding the Float32Array serialisation bug by reading the code

### 💡 Lessons for Vibe Coding

- The AI writes fast but **you** catch the subtle bugs — read every change
- When fixes start creating new problems, **the context is the problem** — start fresh
- Describing a symptom precisely (`"always returns zero"`) is more effective than asking for a feature
- Knowing *what* is wrong matters more than knowing *how* to fix it — the AI handles the how
- A human who understands the domain will always out-prompt one who doesn't
- **Refactor a monolith into modules before the codebase grows** — a single large file forces the AI to load everything into context every session; smaller, hyper-focused files mean the AI only loads what's relevant to the task, rather than wasting context window tokens on unrelated code
- **A PROJECT_MAP pays for itself** — a single markdown file describing your architecture, file responsibilities, and dependency rules lets you bootstrap a fresh AI conversation in seconds; without it, re-establishing context after a reset costs time, tokens, and risks the AI making assumptions about structure it can no longer see

---

**Development environment:** Claude Desktop (claude.ai)  
**Author:** Thomas Leung  
**AI Assistant:** Claude Sonnet by Anthropic

---

## 📄 License

MIT — free to use, modify, and distribute.

---

*Built with Node.js · Express · Ollama · qwen3-embedding:8b · gpt-oss:120b-cloud · qwen2.5:7b · SQLite · RSS · 港式奶茶 ☕*
