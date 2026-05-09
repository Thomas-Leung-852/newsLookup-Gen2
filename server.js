// newsLookup v2 — Express server
// POST /api/search  → fetch RSS + AI match
// GET  /api/sites   → return site list

import express from "express";
import fetch from "node-fetch";
import { XMLParser } from "fast-xml-parser";
import { Ollama } from "ollama";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import initSqlJs from "sql.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static(join(__dirname, "public")));

// Named routes for clean URLs
app.get("/collection", (req, res) => res.sendFile(join(__dirname, "public/collection.html")));
app.get("/editor",     (req, res) => res.sendFile(join(__dirname, "public/editor.html")));

// ─── CONFIG ──────────────────────────────────────────────────────────────────

// ── Chat model (Ollama Cloud) — for future summaries ──
const AI_MODEL    = process.env.AI_MODEL    || "qwen3.5:cloud";
const AI_API_KEY  = process.env.AI_API_KEY  || "";
const AI_BASE_URL = process.env.AI_BASE_URL || "https://ollama.com";
const PORT        = process.env.PORT        || 3000;

// ── Embedding model (Ollama Local) — for fast semantic matching ──
// Pull first: ollama pull qwen3-embedding:0.6b  (tiny, fast)
//         or: ollama pull qwen3-embedding:8b    (best quality, needs 5GB RAM)
const EMBED_MODEL     = process.env.EMBED_MODEL      || "qwen3-embedding:8b";
const EMBED_BASE_URL  = process.env.EMBED_BASE_URL   || "http://localhost:11434";
const EMBED_THRESHOLD = parseFloat(process.env.EMBED_THRESHOLD || "0.40");

// Cloud client — for chat/summaries
// ollama npm package config
// For cloud: host=https://ollama.com + Authorization header
// For local: host=http://localhost:11434, no header needed
const ollamaConfig = {
  host: AI_BASE_URL,
  headers: AI_API_KEY && AI_API_KEY !== "ollama"
    ? { Authorization: "Bearer " + AI_API_KEY }
    : {},
};
const ollama = new Ollama(ollamaConfig);
console.log(`🔧 Ollama client: host=${AI_BASE_URL}, auth=${AI_API_KEY && AI_API_KEY !== 'ollama' ? 'Bearer key set' : 'no auth (local)'}`);

// Local client — ALWAYS points to localhost for embedding
// This never uses cloud — embedding runs 100% locally, free forever
const ollamaLocal = new Ollama({ host: EMBED_BASE_URL });

// ─── DATABASE ────────────────────────────────────────────────────────────────
const DB_PATH = join(__dirname, "articles.db");
let db = null;

// ─── COLLECTION DB ───────────────────────────────────────────────────────────
const COLLECTION_PATH = join(__dirname, "collection.db");
let collectionDb = null;

async function initCollectionDB() {
  const SQL = await initSqlJs();
  if (existsSync(COLLECTION_PATH)) {
    collectionDb = new SQL.Database(readFileSync(COLLECTION_PATH));
  } else {
    collectionDb = new SQL.Database();
  }
  collectionDb.run(`
    CREATE TABLE IF NOT EXISTS collection (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      newsId    TEXT UNIQUE NOT NULL,
      url       TEXT NOT NULL,
      title     TEXT NOT NULL,
      summary   TEXT,
      vector    TEXT,
      score     REAL,
      threshold REAL,
      source    TEXT,
      region    TEXT,
      pubDate   TEXT,
      savedAt   TEXT NOT NULL,
      tags      TEXT
    )
  `);
  collectionDb.run('CREATE INDEX IF NOT EXISTS idx_savedAt ON collection(savedAt)');
  collectionDb.run(`
    CREATE TABLE IF NOT EXISTS summary_cache (
      url       TEXT PRIMARY KEY,
      title     TEXT,
      summary   TEXT NOT NULL,
      level     TEXT,
      model     TEXT,
      createdAt TEXT NOT NULL
    )
  `);
  saveCollectionDB();
  console.log("✂️ Clippings DB ready:", COLLECTION_PATH);
}

function saveCollectionDB() {
  const data = collectionDb.export();
  writeFileSync(COLLECTION_PATH, Buffer.from(data));
}

async function initDB() {
  const SQL = await initSqlJs();
  if (existsSync(DB_PATH)) {
    db = new SQL.Database(readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS articles (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      source     TEXT NOT NULL,
      region     TEXT,
      title      TEXT NOT NULL,
      link       TEXT UNIQUE NOT NULL,
      pubDate    TEXT,
      fetchedAt  TEXT NOT NULL,
      topic      TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pubDate ON articles(pubDate)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_fetchedAt ON articles(fetchedAt)`);
  saveDB();
  console.log("📦 SQLite DB ready:", DB_PATH);
}

function saveDB() {
  const data = db.export();
  writeFileSync(DB_PATH, Buffer.from(data));
}

function insertArticle(article) {
  try {
    db.run(
      `INSERT OR IGNORE INTO articles (source, region, title, link, pubDate, fetchedAt, topic)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [article.source, article.region, article.title, article.link,
       article.pubDate || null, new Date().toISOString(), article.topic || null]
    );
    saveDB();
  } catch(e) { /* ignore duplicate links */ }
}

// Date filter helper — returns SQL WHERE clause fragment
function dateFilterSQL(filter) {
  const f = (filter || "all").toLowerCase();
  if (f === "today")     return `date(pubDate) = date('now')`;
  if (f === "yesterday") return `date(pubDate) = date('now', '-1 day')`;
  if (f === "week")     return `pubDate >= datetime('now', '-7 days')`;
  if (f === "2weeks")   return `pubDate >= datetime('now', '-14 days')`;
  if (f === "month")    return `pubDate >= datetime('now', '-1 month')`;
  if (f === "ytd")      return `strftime('%Y', pubDate) = strftime('%Y', 'now')`;
  return null; // "all" — no filter
}

// ─── RATE LIMIT CONFIG ───────────────────────────────────────────────────────
// Ollama cloud free tier: ~10 requests/min. Adjust these if you hit limits.
const RATE_LIMIT = {
  delayMs: 700,          // wait between each AI call (ms)
  maxRetries: 3,         // retry up to 3 times on rate limit error
  retryDelayMs: 15000,   // wait 15s before retrying after a 429
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── EMBEDDING ───────────────────────────────────────────────────────────────
// ── RSS Cache — avoids re-fetching same feeds repeatedly ─────────────────────
const RSS_CACHE_TTL = parseInt(process.env.RSS_CACHE_TTL || "900000"); // 15 mins default
const rssCache = new Map(); // key: site.rss → { articles, fetchedAt }

// ── Article vector cache — keyed by title, survives RSS cache refresh ─────────
// This is the big win: same article title → reuse vector, skip embed call
const articleVectorCache = new Map(); // key: title → vector

// Cache embeddings in memory — avoids re-embedding same article twice per session
const embedCache = new Map();

function getRssCacheAge() {
  if (!rssCache.size) return null;
  const oldest = Math.min(...[...rssCache.values()].map(v => v.fetchedAt));
  return Date.now() - oldest;
}

// Cosine similarity using Float32Array for 2-3x speed improvement
// At 10,000 records × 4096 dims = 40M ops — Float32Array keeps this ~50ms
function cosineSimilarity(a, b) {
  // ensure Float32Array for typed array optimisation
  const fa = (a instanceof Float32Array) ? a : new Float32Array(a);
  const fb = (b instanceof Float32Array) ? b : new Float32Array(b);
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < fa.length; i++) {
    const ai = fa[i];
    const bi = fb[i];
    dot  += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  return (magA && magB) ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

// Get embedding vector for a text string
// qwen3-embedding uses ollama.embed() with 'input' param
// Older models use ollama.embeddings() with 'prompt' param
async function getEmbedding(text, isQuery = false) {
  const key = (isQuery ? 'Q:' : 'A:') + text.slice(0, 200);
  if (embedCache.has(key)) return embedCache.get(key);
  try {
    // qwen3-embedding supports task instructions for better quality
    // For queries: add retrieval instruction
    // For articles: add document instruction
    const isQwen3 = EMBED_MODEL.startsWith('qwen3-embedding');
    let input = text;
    if (isQwen3) {
      if (isQuery) {
        // Query instruction — tells model this is a search query
        input = 'Instruct: Retrieve relevant news articles\nQuery: ' + text;
      } else {
        // Document instruction — tells model this is a document to be retrieved
        input = 'Instruct: Represent this news article title for retrieval\nQuery: ' + text;
      }
    }

    let vec = null;

    // Try newer embed() API first (qwen3-embedding, nomic-embed-text v2)
    try {
      const res = await ollamaLocal.embed({ model: EMBED_MODEL, input });
      // embed() returns { embeddings: [[...]] }
      vec = res.embeddings?.[0] || res.embedding;
    } catch {
      // Fallback to older embeddings() API
      const res = await ollamaLocal.embeddings({ model: EMBED_MODEL, prompt: input });
      vec = res.embedding;
    }

    if (!vec || !vec.length) {
      console.warn('  Empty embedding returned for:', text.slice(0, 50));
      return null;
    }

    const typedVec = new Float32Array(vec);
    embedCache.set(key, typedVec);
    return typedVec;
  } catch (err) {
    console.warn('  Embedding error:', err.message);
    return null;
  }
}

// ─── MODEL PROFILES ──────────────────────────────────────────────────────────
// Loaded from model-profiles.json — edit that file to add/change model params.
// If a model has no profile, NO options are sent (Ollama uses model defaults).

const PROFILES_PATH = join(__dirname, "model-profiles.json");

function loadModelProfiles() {
  try {
    const raw = JSON.parse(readFileSync(PROFILES_PATH, "utf8"));
    // strip the _comment key
    const { _comment, ...profiles } = raw;
    return profiles;
  } catch (err) {
    console.warn(`⚠️  Could not load model-profiles.json: ${err.message}`);
    return {};
  }
}

function getModelOptions() {
  const profiles = loadModelProfiles();  // reloads every call — no restart needed
  const profile  = profiles[AI_MODEL];
  if (!profile || Object.keys(profile).length === 0) {
    console.log(`ℹ️  No model profile for "${AI_MODEL}" — using model defaults`);
    return {};
  }
  return profile;
}

// ─── LOAD SITES ──────────────────────────────────────────────────────────────

const SITES_PATH = join(__dirname, "rss-sites.json");
let ALL_SITES = JSON.parse(readFileSync(SITES_PATH, "utf8"));

function reloadSites() {
  ALL_SITES = JSON.parse(readFileSync(SITES_PATH, "utf8"));
}

// ─── RSS FETCHER ─────────────────────────────────────────────────────────────

async function fetchRSSFromNet(site) {
  const res = await fetch(site.rss, {
    timeout: 8000,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; newsLookup/2.0)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml    = await res.text();
  const parsed = new XMLParser({ processEntities: true, htmlEntities: true, allowBooleanAttributes: true, parseAttributeValue: false, entityExpansionLimit: 10000 }).parse(xml);
  const channel = parsed?.rss?.channel || parsed?.feed;
  const items   = channel?.item || channel?.entry || [];
  const list    = Array.isArray(items) ? items : [items];
  return list.slice(0, 50).map(item => ({
    title:   item.title?.["#text"] || item.title  || "",
    link:    item.link?.href       || item.link   || item.guid || "",
    summary: item.description      || item.summary?.["#text"] || item.summary || "",
    pubDate: item.pubDate          || item.updated?.["#text"] || item.updated || "",
    source:  site.name,
    region:  site.region,
  }));
}

async function fetchRSS(site, forceRefresh = false) {
  const cached = rssCache.get(site.rss);
  const now    = Date.now();
  const isStale = !cached || (now - cached.fetchedAt) > RSS_CACHE_TTL;

  if (!forceRefresh && !isStale) {
    return cached.articles; // ← cache hit, instant
  }

  try {
    const freshArticles = await fetchRSSFromNet(site);

    // Only embed NEW articles — compare by title
    const newArticles = freshArticles.filter(a => a.title && !articleVectorCache.has(a.title));
    if (newArticles.length > 0) {
      console.log(`  📥 ${site.name}: ${freshArticles.length} articles (${newArticles.length} new, ${freshArticles.length - newArticles.length} cached)`);
    } else {
      console.log(`  ✅ ${site.name}: ${freshArticles.length} articles (all cached)`);
    }

    rssCache.set(site.rss, { articles: freshArticles, fetchedAt: now });
    return freshArticles;
  } catch (err) {
    console.warn(`  ⚠ ${site.name}: ${err.message}`);
    // return stale cache if available rather than empty
    return cached ? cached.articles : [];
  }
}

// ─── EMBEDDING MATCHER ───────────────────────────────────────────────────────

// queryVec is pre-computed once per search — passed in to avoid re-embedding
async function isRelevant(article, queryVec, threshold) {
  try {
    // Check article vector cache first — same title never embedded twice
    let articleVec = articleVectorCache.get(article.title);
    if (!articleVec) {
      articleVec = await getEmbedding(article.title);
      if (articleVec) articleVectorCache.set(article.title, new Float32Array(articleVec));
    }
    if (!articleVec) return { relevant: false, topic: "", score: 0 };

    const score = cosineSimilarity(queryVec, articleVec);
    const relevant = score >= threshold;

    // Log all scores to console for threshold tuning
    const pct = Math.round(score * 100);
    if (pct >= 30) { // only log potentially interesting ones
      console.log(`  ${relevant ? '✅' : '  '} ${pct}% | ${article.title.slice(0, 70)}`);
    }

    return {
      relevant,
      score: Math.round(score * 100) / 100,
      topic: relevant ? article.title.slice(0, 80) : "",
    };
  } catch (err) {
    console.warn("  Match error:", err.message);
    return { relevant: false, topic: "", score: 0 };
  }
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────

// GET /api/sites — return list of available sites
app.get("/api/sites", (req, res) => {
  res.json(ALL_SITES);
});

// POST /api/search — main search endpoint
// body: { keywords: ["...", "..."], sites: ["SCMP", "BBC", ...] or [] for all }
app.post("/api/search", async (req, res) => {
  const { keywords = [], sites = [], dateFilter = "all", threshold = EMBED_THRESHOLD } = req.body;

  if (!keywords.length) {
    return res.status(400).json({ error: "Please provide at least one keyword." });
  }
  if (!AI_API_KEY) {
    return res.status(500).json({ error: "AI_API_KEY not set on server." });
  }

  // filter sites if user selected specific ones, otherwise use all
  const targetSites = sites.length
    ? ALL_SITES.filter(s => sites.includes(s.name))
    : ALL_SITES;

  // use SSE (Server-Sent Events) so the UI can show live progress
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

  const matched = [];

  // Clear cache — ensures articles re-embedded with correct instruction prefix
  embedCache.clear();

  // ── Embed the query ONCE — this is the only API call for matching ──
  const userQuery = keywords.join(" ");

  // Auto-adjust threshold based on query complexity
  // Short keywords need lower threshold — they embed differently from full sentences
  const DEFAULT_THRESHOLD = 0.40;
  let effectiveThreshold = threshold;
  const wordCount = userQuery.trim().split(/\s+/).length;

  // Auto-lower ONLY when user is using the default threshold
  // If user explicitly raised the slider, ALWAYS respect their choice
  if (Math.abs(threshold - DEFAULT_THRESHOLD) < 0.01) {
    if (wordCount === 1) {
      effectiveThreshold = 0.35;
      console.log(`ℹ️  Single word — auto threshold: ${effectiveThreshold}`);
    } else if (wordCount <= 3) {
      effectiveThreshold = 0.40;
    } else if (wordCount <= 6) {
      effectiveThreshold = 0.45;
    } else {
      effectiveThreshold = 0.50;
    }
  } else {
    console.log(`ℹ️  User threshold: ${threshold} — respecting user setting`);
  }

  send("progress", { message: `Computing query embedding for: "${userQuery.slice(0, 60)}"...` });
  const queryVec = await getEmbedding(userQuery, true);
  if (!queryVec) {
    send("error", { message: "❌ Embedding failed — model '" + EMBED_MODEL + "' not available.\n\nRun: ollama pull " + EMBED_MODEL + "\n\nFalling back to keyword matching..." });
    // ── Keyword fallback — still useful when embedding model not available ──
    for (const site of targetSites) {
      send("progress", { message: `[keyword mode] Fetching ${site.name}...` });
      let articles = await fetchRSS(site);
      if (dateFilter && dateFilter !== "all") {
        const now = new Date();
        articles = articles.filter(a => {
          if (!a.pubDate) return false;
          const d = new Date(a.pubDate); if (isNaN(d)) return false;
          const days = (now - d) / 86400000;
          if (dateFilter === 'today') {
          // compare UTC dates to avoid timezone mismatch
          return d.getUTCFullYear() === now.getUTCFullYear() &&
                 d.getUTCMonth()    === now.getUTCMonth() &&
                 d.getUTCDate()     === now.getUTCDate();
        }
          if (dateFilter === "week")   return days <= 7;
          if (dateFilter === "2weeks") return days <= 14;
          if (dateFilter === "month")  return days <= 30;
          if (dateFilter === "ytd")    return d.getFullYear() === now.getFullYear();
          return true;
        });
      }
      send("progress", { message: `[keyword mode] Checking ${articles.length} articles from ${site.name}...` });
      for (const article of articles) {
        if (!article.title) continue;
        const text = (article.title + " " + (article.summary||"")).toLowerCase();
        const hit  = keywords.some(k => text.includes(k.toLowerCase()));
        if (hit) {
          const match = { source: article.source, region: article.region, title: article.title,
            pubDate: article.pubDate||"", topic: keywords[0], score: null, link: article.link };
          matched.push(match);
          insertArticle(match);
          send("match", { article: match });
        }
      }
    }
    send("done", { total: matched.length, mode: "keyword" });
    res.end();
    return;
  }
  send("progress", { message: `Query embedded ✓ — scanning articles (threshold: ${effectiveThreshold})...` });

  for (const site of targetSites) {
    send("progress", { message: `Fetching ${site.name}...` });
    let articles = await fetchRSS(site);

    // ── Date filter BEFORE sending to AI — saves tokens ──
    if (dateFilter && dateFilter !== "all") {
      const before = articles.length;
      const now    = new Date();
      // Get local timezone offset in ms — e.g. HKT = UTC+8 = +480 mins
      const tzOffsetMs = now.getTimezoneOffset() * -60000;
      const localToday = now.getFullYear() + '-' +
        String(now.getMonth()+1).padStart(2,'0') + '-' +
        String(now.getDate()).padStart(2,'0');
      console.log('  📅 [' + site.name + '] Local today:', localToday, '| TZ offset:', (tzOffsetMs/3600000) + 'h | filter:', dateFilter);

      articles = articles.filter(a => {
        if (!a.pubDate) return false;
        const d = new Date(a.pubDate);
        if (isNaN(d)) return false;
        const diffMs   = now - d;
        const diffDays = diffMs / 86400000;

        if (dateFilter === 'today') {
          // Shift article time by local timezone offset before comparing date parts
          // e.g. Apr 30 17:51 UTC + 8h = May 1 01:51 HKT → correct local date
          const localD = new Date(d.getTime() + tzOffsetMs);
          const articleLocal = localD.getUTCFullYear() + '-' +
            String(localD.getUTCMonth()+1).padStart(2,'0') + '-' +
            String(localD.getUTCDate()).padStart(2,'0');
          const pass = articleLocal === localToday;
          console.log('  ' + (pass?'✅':'❌') + ' UTC:' + d.toISOString().slice(0,10) + ' Local:' + articleLocal + ' | ' + a.title.slice(0,50));
          return pass;
        }
        if (dateFilter === 'week')   return diffDays <= 7;
        if (dateFilter === '2weeks') return diffDays <= 14;
        if (dateFilter === 'month')  return diffDays <= 30;
        if (dateFilter === 'ytd')    return d.getFullYear() === now.getFullYear();
        return true;
      });
      const skipped = before - articles.length;
      send("progress", { message: `Checking ${articles.length} articles from ${site.name}${skipped ? ` (${skipped} filtered by date)` : ``}...` });
    } else {
      send("progress", { message: `Checking ${articles.length} articles from ${site.name}...` });
    }

    for (const article of articles) {
      if (!article.title) continue;
      const result = await isRelevant(article, queryVec, effectiveThreshold);
      if (result.relevant) {
        const match = {
          source:  article.source,
          region:  article.region,
          title:   article.title,
          pubDate: article.pubDate || "",
          topic:   result.topic,
          score:   result.score,
          link:    article.link,
        };
        matched.push(match);
        insertArticle(match);
        send("match", { article: match });
      }
    }
  }

  send("done", { total: matched.length });
  res.end();
});

// PUT /api/sites — save updated sites array to file
app.put("/api/sites", (req, res) => {
  try {
    const sites = req.body;
    if (!Array.isArray(sites)) return res.status(400).json({ error: "Expected an array." });
    // sort by region then name
    sites.sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name));
    writeFileSync(SITES_PATH, JSON.stringify(sites, null, 2), "utf8");
    reloadSites();
    res.json({ ok: true, count: sites.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/test-rss?url=... — test RSS feed, return status + parsed articles
app.get("/api/test-rss", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url param required" });
  try {
    const r = await fetch(url, {
      method: "GET",
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; newsLookup/2.0)" },
    });
    if (!r.ok) {
      return res.json({ status: r.status, ok: false, statusText: r.statusText, articles: [] });
    }
    // parse the feed and return articles
    const xml     = await r.text();
    const parsed  = new XMLParser({ processEntities: true, htmlEntities: true, allowBooleanAttributes: true, parseAttributeValue: false, entityExpansionLimit: 10000 }).parse(xml);
    const channel = parsed?.rss?.channel || parsed?.feed;
    const items   = channel?.item || channel?.entry || [];
    const list    = Array.isArray(items) ? items : [items];
    // feed-level last update (RSS: lastBuildDate, Atom: updated)
    const feedUpdated = channel?.lastBuildDate || channel?.updated || channel?.pubDate || null;

    const articles = list.slice(0, 50).map(item => ({
      title:   item.title?.["#text"] || item.title || "(no title)",
      link:    item.link?.href       || item.link  || item.guid || "",
      pubDate: item.pubDate || item.updated?.["#text"] || item.updated || "",
    })).filter(a => a.title);

    res.json({ status: r.status, ok: true, statusText: r.statusText, feedUpdated, articles });
  } catch (err) {
    res.json({ status: 0, ok: false, statusText: err.message, articles: [] });
  }
});

// GET /api/debug-embed?query=...&article=... — test similarity score
app.get('/api/debug-embed', async (req, res) => {
  const { query = '', article = '' } = req.query;
  if (!query || !article) return res.status(400).json({ error: 'query and article params required' });
  try {
    const qVec = await getEmbedding(query, true);
    const aVec = await getEmbedding(article, false);
    if (!qVec || !aVec) return res.json({ error: 'embedding failed' });
    const score = cosineSimilarity(qVec, aVec);
    res.json({ query, article, score: Math.round(score * 1000) / 1000, pct: Math.round(score * 100) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Summary Cache helpers ────────────────────────────────────────────────────
function getCachedSummary(url) {
  try {
    const rows = collectionDb.exec("SELECT summary, level, model FROM summary_cache WHERE url=?", [url]);
    if (!rows.length || !rows[0].values.length) return null;
    const [summary, level, model] = rows[0].values[0];
    return { summary, level, model, cached: true };
  } catch { return null; }
}

function cacheSummary(url, title, summary, level, model) {
  try {
    collectionDb.run(
      `INSERT OR REPLACE INTO summary_cache (url, title, summary, level, model, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [url, title, summary, level, model, new Date().toISOString()]
    );
    saveCollectionDB();
  } catch(e) { console.warn('Summary cache write failed:', e.message); }
}

async function callAI(prompt) {
  const modelOptions = getModelOptions();
  const response = await ollama.chat({
    model:    AI_MODEL,
    messages: [{ role: "user", content: prompt }],
    stream:   false,
    ...(Object.keys(modelOptions).length > 0 && { options: modelOptions }),
  });
  return response.message.content.trim();
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// POST /api/summarise — summarise with fallback chain + cache
app.post("/api/summarise", async (req, res) => {
  const { title, link, rssDescription = "" } = req.body;
  if (!title || !link) return res.status(400).json({ error: "title and link required" });

  // ── Check cache first ────────────────────────────────────────────────────
  const cached = getCachedSummary(link);
  if (cached) {
    console.log(`📋 Summary cache hit: ${title.slice(0, 50)}`);
    return res.json({ ...cached });
  }

  let summary = null;
  let level   = null;

  // ── Level 1: Full article page ───────────────────────────────────────────
  try {
    const pageRes = await fetch(link, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; newsLookup/2.0)" }
    });
    if (pageRes.ok) {
      const text = stripHtml(await pageRes.text()).slice(0, 3000);
      if (text.length > 200) { // meaningful content
        console.log(`📄 Level 1 (full page): ${title.slice(0, 50)}`);
        summary = await callAI(
          `You are a multilingual news summariser. Summarise in 3 bullet points.
` +
          `Reply in the same language as the content (English, 繁體中文, or Cantonese).
` +
          `Be concise — one sentence per bullet.

` +
          `Title: ${title}
Content: ${text}

Reply with ONLY 3 bullet points:`
        );
        level = "full_article";
      }
    }
  } catch(e) {
    console.log(`⚠️  Level 1 failed (${e.message.slice(0,50)}) — trying Level 2`);
  }

  // ── Level 2: RSS description ─────────────────────────────────────────────
  if (!summary && rssDescription && rssDescription.trim().length > 50) {
    try {
      const cleanDesc = stripHtml(rssDescription).slice(0, 1000);
      console.log(`📰 Level 2 (RSS description): ${title.slice(0, 50)}`);
      summary = await callAI(
        `You are a multilingual news summariser. Based on this RSS description, summarise in 3 bullet points.
` +
        `Reply in the same language (English, 繁體中文, or Cantonese).

` +
        `Title: ${title}
RSS Description: ${cleanDesc}

Reply with ONLY 3 bullet points:`
      );
      level = "rss_description";
    } catch(e) {
      console.log(`⚠️  Level 2 failed — trying Level 3`);
    }
  }

  // ── Level 3: Title only (always works) ───────────────────────────────────
  if (!summary) {
    try {
      console.log(`📝 Level 3 (title only): ${title.slice(0, 50)}`);
      summary = await callAI(
        `You are a multilingual news analyst. Based on this headline only, explain what this article is likely about in 3 bullet points.
` +
        `Reply in the same language as the headline (English, 繁體中文, or Cantonese).
` +
        `Note: This is based on the headline only, not the full article.

` +
        `Headline: ${title}

Reply with ONLY 3 bullet points:`
      );
      level = "title_only";
    } catch(e) {
      return res.status(500).json({ error: "All summarisation levels failed: " + e.message });
    }
  }

  // ── Cache and return ──────────────────────────────────────────────────────
  cacheSummary(link, title, summary, level, AI_MODEL);
  console.log(`✅ Summary saved to cache (level: ${level})`);
  res.json({ summary, level, model: AI_MODEL, cached: false });
});

// GET /api/cache-status — return RSS and vector cache stats for UI
app.get("/api/cache-status", (req, res) => {
  const ageMs  = getRssCacheAge();
  const ageSec = ageMs ? Math.floor(ageMs / 1000) : null;
  const ageMins = ageMs ? Math.floor(ageMs / 60000) : null;
  res.json({
    rssCache: {
      sites:     rssCache.size,
      ageMs,
      ageSec,
      ageMins,
      label:     ageMs === null ? 'empty' :
                 ageSec < 60   ? ageSec + 's ago' :
                 ageMins + ' min' + (ageMins !== 1 ? 's' : '') + ' ago',
      ttlMs:     RSS_CACHE_TTL,
      expiresIn: ageMs ? Math.max(0, Math.floor((RSS_CACHE_TTL - ageMs) / 1000)) : null,
    },
    vectorCache: {
      titles: articleVectorCache.size,
    },
    embedCache: {
      entries: embedCache.size,
    },
  });
});

// POST /api/cache-refresh — force refresh all cached RSS feeds
app.post("/api/cache-refresh", async (req, res) => {
  rssCache.clear();
  console.log("🔄 RSS cache cleared — will refetch on next search");
  res.json({ ok: true, message: "RSS cache cleared" });
});

// GET /api/embed-config — return current embedding config for UI
app.get("/api/embed-config", (req, res) => {
  res.json({ model: EMBED_MODEL, threshold: EMBED_THRESHOLD, baseUrl: EMBED_BASE_URL });
});

// GET /api/history?filter=today|week|2weeks|month|ytd|all&q=keyword
app.get("/api/history", (req, res) => {
  try {
    const { filter = "all", q = "" } = req.query;
    const dateWhere = dateFilterSQL(filter);
    const conditions = [];
    const params     = [];
    if (dateWhere) conditions.push(dateWhere);
    if (q) { conditions.push("(title LIKE ? OR topic LIKE ? OR source LIKE ?)"); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const rows = db.exec(`SELECT id,source,region,title,link,pubDate,fetchedAt,topic FROM articles ${where} ORDER BY fetchedAt DESC LIMIT 500`, params);
    if (!rows.length) return res.json({ articles: [], total: 0 });
    const cols = rows[0].columns;
    const articles = rows[0].values.map(row => Object.fromEntries(cols.map((c,i) => [c, row[i]])));
    res.json({ articles, total: articles.length });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/history — clear all saved articles
app.delete("/api/history", (req, res) => {
  try {
    db.run("DELETE FROM articles");
    saveDB();
    res.json({ ok: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── COLLECTION API ──────────────────────────────────────────────────────────

// GET /api/collection — list all saved items
app.get("/api/collection", (req, res) => {
  try {
    const rows = collectionDb.exec(
      "SELECT id,newsId,url,title,summary,score,threshold,source,region,pubDate,savedAt,tags FROM collection ORDER BY savedAt DESC"
    );
    if (!rows.length) return res.json({ items: [], total: 0 });
    const cols  = rows[0].columns;
    const items = rows[0].values.map(r => Object.fromEntries(cols.map((c,i) => [c, r[i]])));
    res.json({ items, total: items.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET /api/collection/unembedded — list items missing vectors (for re-embed prompt)
app.get("/api/collection/unembedded", (req, res) => {
  try {
    const rows = collectionDb.exec(
      "SELECT id,newsId,url,title FROM collection WHERE vector IS NULL ORDER BY savedAt DESC"
    );
    if (!rows.length) return res.json({ items: [], total: 0 });
    const cols  = rows[0].columns;
    const items = rows[0].values.map(r => Object.fromEntries(cols.map((c,i) => [c, r[i]])));
    res.json({ items, total: items.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET /api/get-vector?title=... — return cached vector for a title
app.get("/api/get-vector", async (req, res) => {
  const { title } = req.query;
  if (!title) return res.status(400).json({ error: "title required" });
  try {
    // check articleVectorCache first
    let vec = articleVectorCache.get(title);
    if (!vec) {
      // not cached yet — embed it now
      vec = await getEmbedding(title);
      if (vec) articleVectorCache.set(title, vec);
    }
    if (!vec) return res.json({ vector: null });
    res.json({ vector: vec });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/collection — save item to collection
app.post("/api/collection", (req, res) => {
  try {
    const { newsId, url, title, summary, vector, score, threshold, source, region, pubDate } = req.body;
    if (!url || !title) return res.status(400).json({ error: "url and title required" });

    const id = newsId || createHash('sha256').update(url).digest('hex');

    let articleVec = articleVectorCache.get(title);
    var v1 = null;
    if (articleVec) {
      v1 = JSON.stringify(Array.from(articleVec));
    }

    collectionDb.run(
      `INSERT OR REPLACE INTO collection (newsId,url,title,summary,vector,score,threshold,source,region,pubDate,savedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, url, title, summary || '', v1,
        score || null, threshold || null, source || '', region || '', pubDate || '',
        new Date().toISOString()]
    );
    saveCollectionDB();
    res.json({ ok: true, newsId: id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/collection/summary — update summary for existing item
app.post("/api/collection/summary", (req, res) => {
  try {
    const { id, summary } = req.body;
    if (!id) return res.status(400).json({ error: "id required" });
    collectionDb.run("UPDATE collection SET summary=? WHERE id=?", [summary, id]);
    saveCollectionDB();
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/collection/embed — embed + cache an article vector server-side
// Call after clipping so the vector is ready for semantic search
app.post("/api/collection/embed", async (req, res) => {
  const { title, newsId } = req.body;
  if (!title) return res.status(400).json({ error: "title required" });

  try {
    // Return cached vector immediately if already computed
    let vec = articleVectorCache.get(title);

    if (!vec) {
      vec = await getEmbedding(title);
      if (!vec) return res.status(500).json({ error: "Embedding failed — is EMBED_MODEL running?" });
      articleVectorCache.set(title, vec);
    }

    // Persist vector to DB if newsId provided
    if (newsId) {
      collectionDb.run(
        "UPDATE collection SET vector=? WHERE newsId=?",
        [JSON.stringify(Array.from(vec)), newsId]
      );
      saveCollectionDB();
    }

    res.json({ ok: true, cached: true, dims: vec.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/collection/update-vector — re-embed any text and overwrite vector for a newsId
app.post("/api/collection/update-vector", async (req, res) => {
  const { title, summary, newsId } = req.body;
  if (!title)   return res.status(400).json({ error: "title required" });
  if (!summary)   return res.status(400).json({ error: "summary required" });
  if (!newsId) return res.status(400).json({ error: "newsId required" });

  try {
    const vec = await getEmbedding(title +' '+ summary);
    if (!vec) return res.status(500).json({ error: "Embedding failed — is EMBED_MODEL running?" });

    // Update DB
    collectionDb.run(
      "UPDATE collection SET vector=? WHERE newsId=?",
      [JSON.stringify(Array.from(vec)), newsId]
    );
    saveCollectionDB();

    // Sync in-memory cache — key by text so future searches can reuse it
    articleVectorCache.set(title, vec);

    res.json({ ok: true, newsId, dims: vec.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// DELETE /api/collection/:id — remove item
app.delete("/api/collection/:id", (req, res) => {
  try {
    collectionDb.run("DELETE FROM collection WHERE id=?", [req.params.id]);
    saveCollectionDB();
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/collection — clear all
app.delete("/api/collection", (req, res) => {
  try {
    collectionDb.run("DELETE FROM collection");
    saveCollectionDB();
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/collection/search — semantic search using embeddings
app.post("/api/collection/search", async (req, res) => {
  try {
    const { query, topN = 20 } = req.body;
    if (!query) return res.status(400).json({ error: "query required" });

    // embed the query
    const queryVec = await getEmbedding(query, true);
    if (!queryVec) return res.status(500).json({ error: "Embedding failed — is EMBED_MODEL running?" });

    // load all items with vectors
    const rows = collectionDb.exec(
      "SELECT id,newsId,url,title,summary,vector,score,threshold,source,region,pubDate,savedAt,tags FROM collection WHERE vector IS NOT NULL"
    );
    if (!rows.length) return res.json({ items: [], total: 0, query });
    const cols  = rows[0].columns;
    const items = rows[0].values.map(r => Object.fromEntries(cols.map((c,i) => [c, r[i]])));

    // compute cosine similarity using Float32Array for performance
    // 10,000 records × 4096 dims ≈ 40M ops — typed arrays keep this ~50ms
    const scored = items.map(item => {
      try {
        const parsed = JSON.parse(item.vector);
        const vecArray = Array.isArray(parsed) ? parsed : Object.values(parsed);
        const sim = cosineSimilarity(queryVec, new Float32Array(vecArray));

        return { ...item, searchScore: Math.round(sim * 100) };
      } catch { return { ...item, searchScore: 0 }; }
    });

    // sort by score, return top N
    scored.sort((a, b) => b.searchScore - a.searchScore);
    const top = scored.slice(0, topN).filter(i => i.searchScore > 20);
    res.json({ items: top, total: top.length, query });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── START ───────────────────────────────────────────────────────────────────

Promise.all([initDB(), initCollectionDB()]).then(() => app.listen(PORT, () => {
  const profiles = loadModelProfiles();
  const profile  = profiles[AI_MODEL];
  const isCloud = AI_API_KEY && AI_API_KEY !== 'ollama';
  console.log(`\n🔍 newsLookup Gen2 running at http://localhost:${PORT}`);
  console.log(`🧮 Embed:     ${EMBED_MODEL} @ ${EMBED_BASE_URL} (threshold: ${EMBED_THRESHOLD})`);
  console.log(`🤖 Reasoning: ${AI_MODEL} @ ${AI_BASE_URL} (${isCloud ? 'Ollama Cloud' : 'Ollama Local'})`);
  console.log(`🔑 API key:   ${AI_API_KEY ? (AI_API_KEY === 'ollama' ? 'ollama (local)' : AI_API_KEY.slice(0, 8) + '...') : '❌ NOT SET'}`);
  console.log(`\n💡 Embedding: ollama pull ${EMBED_MODEL}`);
  console.log(`💡 Reasoning: ${isCloud ? 'set AI_MODEL=<model>-cloud on ollama.com' : 'ollama pull ' + AI_MODEL}\n`);
}));
