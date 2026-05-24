
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

**🤖 RAG Model (`gpt-oss:120b-cloud`) — Summarisation**
`gpt-oss:120b-cloud` retrieves and reads article content then generates concise 3-bullet summaries — Retrieval-Augmented Generation in action. Intelligent fallback chain: full article page → RSS description → title-only for paywalled sites. Summaries cached permanently in SQLite — never pay twice for the same article.

---

## ✨ Features

- **Semantic search** — `qwen3-embedding:8b` running 100% locally, free forever
- **RAG summarisation** — `gpt-oss:120b-cloud` generates 3-bullet summaries with intelligent fallback
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
| Ollama | Latest | For local embedding model |
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
| **Reasoning** (RAG summaries) | `gpt-oss:120b-cloud` or `gpt-oss:120b` | Cloud or local |

> The embedding model **always runs locally** — it never uses cloud API quota.

**Ollama Cloud reasoning** — get your free API key at [ollama.com/settings/keys](https://ollama.com/settings/keys):
```cmd
set AI_MODEL=gpt-oss:120b-cloud
set AI_API_KEY=your_ollama_cloud_key
set AI_BASE_URL=https://ollama.com
```

**Ollama Local reasoning** — requires 80GB RAM for 120b model:
```cmd
ollama pull gpt-oss:120b
set AI_MODEL=gpt-oss:120b
set AI_API_KEY=ollama
set AI_BASE_URL=http://localhost:11434
```

---

## 🚀 Quick Start

**1. Install prerequisites**
- copy rss-sites.json.template rss-sites.json
- Node.js v22+ — [nodejs.org](https://nodejs.org)
- Ollama — [ollama.com/download](https://ollama.com/download)

**2. Pull the embedding model**
```cmd
ollama pull qwen3-embedding:8b
```

**3. Clone and install**
```cmd
git clone https://github.com/Thomas-Leung-852/newsLookup-Gen2.git
cd newsLookup-Gen2
npm install
```

**4. Set your AI provider and run**

Option A — Ollama Cloud *(free tier)*:
```cmd
set AI_API_KEY=your_ollama_cloud_api_key
set AI_MODEL=gpt-oss:120b-cloud
set AI_BASE_URL=https://ollama.com
set EMBED_MODEL=qwen3-embedding:8b
npm start
```

Option B — Ollama Local *(fully offline)*:
```cmd
ollama pull gpt-oss:120b
set AI_API_KEY=ollama
set AI_MODEL=gpt-oss:120b
set AI_BASE_URL=http://localhost:11434
set EMBED_MODEL=qwen3-embedding:8b
npm start
```

Open your browser at `http://localhost:3000`

---

### 🐧 Ubuntu 24.x

**1. Install prerequisites**
```bash
# Use RSS templates 
cp rss-sites.json.template rss-sites.json

# Node.js v22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull embedding model (best quality)
ollama pull qwen3-embedding:8b

# Pull reasoning model for local use (optional — needs 80GB RAM)
ollama pull gpt-oss:120b
```

**2. Clone and install**
```bash
git clone https://github.com/Thomas-Leung-852/newsLookup-Gen2.git
cd newsLookup-Gen2
npm install
```

**3. Run**

Option A — Ollama Cloud:
```bash
export AI_API_KEY=your_ollama_cloud_api_key
export AI_MODEL=gpt-oss:120b-cloud
export AI_BASE_URL=https://ollama.com
export EMBED_MODEL=qwen3-embedding:8b
npm start
```

Option B — Ollama Local:
```bash
export AI_API_KEY=ollama
export AI_MODEL=gpt-oss:120b
export AI_BASE_URL=http://localhost:11434
export EMBED_MODEL=qwen3-embedding:8b
npm start
```

Open your browser at `http://localhost:3000`

---

## ⚙️ Configuration

| Variable | Default | Description |
|---|---|---|
| `AI_API_KEY` | *(required)* | Ollama Cloud API key or `ollama` for local |
| `AI_BASE_URL` | `https://ollama.com` | Reasoning model base URL — set to `http://localhost:11434` for local Ollama |
| `AI_MODEL` | `gpt-oss:120b-cloud` | Reasoning model for RAG summaries |
| `EMBED_MODEL` | `qwen3-embedding:8b` | Local embedding model for semantic search |
| `EMBED_BASE_URL` | `http://localhost:11434` | Local Ollama URL for embedding |
| `PORT` | `3000` | HTTP server port |

> **Note:** RSS cache TTL and other tuneable parameters are managed via the in-app Settings UI (`http://localhost:3000/settings.html`), not environment variables.

---

## 📁 Project Structure

```
newsLookup-Gen2/
├── server.js                   # Express server — RSS, embedding, search, RAG API
├── rss-sites.json.template     # RSS Template (make a copy and editable via built-in editor)
├── model-profiles.json         # Per-model parameters — hot-reloaded, no restart
├── articles.db                 # SQLite — article history (auto-created)
├── collection.db               # SQLite — My Clippings + summary cache (auto-created)
├── config/
│   └── app-settings.json       # Runtime tuneable settings — persisted to disk
├── package.json
└── public/
    ├── index.html              # Main search UI
    ├── editor.html             # RSS Site Editor
    ├── settings.html           # App settings UI
    └── collection.html         # My Clippings
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

## 🗺️ Screenshot

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

*Built with Node.js · Express · Ollama · qwen3-embedding:8b · gpt-oss:120b · SQLite · RSS · 港式奶茶 ☕*