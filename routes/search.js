/**
 * routes/search.js — Core search engine, site management, and cache utilities.
 *
 * ROLE:    The primary search route: receives keywords from the client,
 *          embeds them, scores every article in every target RSS feed, and
 *          streams matched articles back in real-time via Server-Sent Events (SSE).
 *          Falls back to keyword matching if the local embedding model is offline.
 * MOUNTS AT: /api  (registered in server.js)
 * TALKS TO:  lib/embedding.js, lib/rss.js, db/articlesDb.js
 *
 * SHARED STATE: ALL_SITES is injected by server.js via init(). It is also
 *               mutated by PUT /api/sites and must stay in sync with the JSON file.
 *
 * ROUTE SUMMARY:
 *   POST /api/search          — main semantic search (SSE stream)
 *   GET  /api/sites           — list all configured RSS sites
 *   PUT  /api/sites           — overwrite the full sites list
 *   GET  /api/test-rss        — validate a feed URL before adding it
 *   GET  /api/debug-embed     — compute similarity score for two strings
 *   GET  /api/embed-config    — return current embedding model config
 *   GET  /api/cache-status    — show RSS and vector cache stats
 *   POST /api/cache-refresh   — force-clear the RSS cache
 */

import { Router }        from "express";
import { writeFileSync } from "fs";
import fetch             from "node-fetch";
import { XMLParser }     from "fast-xml-parser";

import {
  EMBED_MODEL, EMBED_BASE_URL, SITES_PATH, AI_API_KEY,
} from "../config.js";
import { getSetting } from "../lib/settings.js";
import { db, insertArticle } from "../db/articlesDb.js";
import {
  getEmbedding, isRelevant, cosineSimilarity,
  embedCache, rssCache, articleVectorCache, getRssCacheAge,
} from "../lib/embedding.js";
import { fetchRSS } from "../lib/rss.js";

export const router = Router();

/**
 * Module-level sites list — populated by server.js calling init().
 * Exported as mutable so PUT /api/sites can update it in-memory after
 * writing to disk, keeping the two in sync without a server restart.
 */
let ALL_SITES = [];

/**
 * Injects the sites list from server.js into this module.
 * Must be called before any route handler runs.
 *
 * @param {Array<{ name: string, region: string, rss: string }>} sites
 */
export function init(sites)     { ALL_SITES = sites; }
export function reloadSites(s)  { ALL_SITES = s; }

// ── Site management ───────────────────────────────────────────────────────────

/**
 * GET /api/sites
 * Returns the full list of configured RSS news sources.
 * Returns: Array<{ name, region, rss }>
 */
router.get("/sites", (req, res) => {
  res.json(ALL_SITES);
});

/**
 * PUT /api/sites
 *
 * Overwrites the complete sites list — both on disk and in memory.
 *
 * WHY:    The frontend site manager sends the full updated array; partial
 *         updates are not supported to keep the logic simple and atomic.
 * GOTCHA: Sorts by region then name before saving so the JSON file stays
 *         human-readable and diff-friendly in version control.
 *         Writes to SITES_PATH synchronously — if the write fails (e.g. disk
 *         full), the error is returned and ALL_SITES is NOT updated.
 *
 * Request body: Array<{ name, region, rss }>
 * Returns: { ok: true, count: number }
 */
router.put("/sites", (req, res) => {
  try {
    const sites = req.body;
    if (!Array.isArray(sites)) return res.status(400).json({ error: "Expected an array." });
    sites.sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name));
    writeFileSync(SITES_PATH, JSON.stringify(sites, null, 2), "utf8");
    ALL_SITES = sites;
    res.json({ ok: true, count: sites.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Main search ───────────────────────────────────────────────────────────────

/**
 * POST /api/search
 *
 * The core search flow. Embeds the user's keywords, fetches articles from
 * all target RSS feeds, and streams matching articles as SSE events.
 *
 * WHY SSE (Server-Sent Events): Search can take 30–90 seconds for large
 *     site lists. SSE lets the frontend show results as they arrive rather
 *     than waiting for the full response.
 *
 * THRESHOLD AUTO-SCALING:
 *     The default EMBED_THRESHOLD (0.40) is adjusted based on query word count
 *     to compensate for embedding space density differences between short
 *     (1-word) and long (7+ word) queries. User-supplied thresholds that
 *     differ from the default are respected as-is.
 *
 * KEYWORD FALLBACK:
 *     If getEmbedding() returns null (Ollama offline, model not pulled),
 *     the route automatically switches to simple substring keyword matching.
 *     Quality is lower but the search still works.
 *
 * GOTCHA: embedCache is cleared at the start of each search to prevent
 *         stale query vectors from a previous session affecting results.
 *         articleVectorCache is NOT cleared — article embeddings persist
 *         across searches and are reused for performance.
 *
 * Request body:
 *   keywords   {string[]} - Search terms (at least one required)
 *   sites      {string[]} - Site names to search (empty = all sites)
 *   dateFilter {string}   - "today"|"yesterday"|"week"|"2weeks"|"month"|"ytd"|"all"
 *   threshold  {number}   - Cosine similarity cutoff (default: EMBED_THRESHOLD)
 *
 * SSE event types:
 *   { type: "progress", message: string }   - status update
 *   { type: "match",    article: object }   - a matched article
 *   { type: "error",    message: string }   - non-fatal error (e.g. embed failed)
 *   { type: "done",     total: number }     - search complete
 */
router.post("/search", async (req, res) => {
  const {
    keywords   = [],
    sites      = [],
    dateFilter = "all",
    threshold  = getSetting("search.embedThreshold"),
  } = req.body;

  if (!keywords.length) return res.status(400).json({ error: "Please provide at least one keyword." });
  if (!AI_API_KEY)      return res.status(500).json({ error: "AI_API_KEY not set on server." });

  const targetSites = sites.length
    ? ALL_SITES.filter(s => sites.includes(s.name))
    : ALL_SITES;

  // Set up SSE headers
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");

  /** Sends a single SSE event as a JSON data line */
  const send = (type, data) =>
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

  const matched = [];

  // Clear query-level embed cache — article vectors are preserved
  embedCache.clear();

  // ── Threshold — use slider value directly, no auto-scaling ─────────────
  const userQuery        = keywords.join(" ");
  const effectiveThreshold = threshold;
  console.log(`ℹ️  Threshold: ${effectiveThreshold}`);

  send("progress", { message: `Computing query embedding for: "${userQuery.slice(0, 60)}"...` });

  const queryVec = await getEmbedding(userQuery, true);

  // ── Fallback: keyword mode (Ollama offline or model not pulled) ──────────
  if (!queryVec) {
    send("error", {
      message:
        `❌ Embedding failed — model '${EMBED_MODEL}' not available.\n\n` +
        `Run: ollama pull ${EMBED_MODEL}\n\nFalling back to keyword matching...`,
    });

    for (const site of targetSites) {
      send("progress", { message: `[keyword mode] Fetching ${site.name}...` });
      let articles = await fetchRSS(site);

      // Client-side date filter for keyword mode
      if (dateFilter && dateFilter !== "all") {
        const now = new Date();
        articles  = articles.filter(a => {
          if (!a.pubDate) return false;
          const d = new Date(a.pubDate);
          if (isNaN(d)) return false;
          const days = (now - d) / 86400000;
          if (dateFilter === "today") {
            return (
              d.getUTCFullYear() === now.getUTCFullYear() &&
              d.getUTCMonth()    === now.getUTCMonth() &&
              d.getUTCDate()     === now.getUTCDate()
            );
          }
          if (dateFilter === "week")   return days <= 7;
          if (dateFilter === "2weeks") return days <= 14;
          if (dateFilter === "month")  return days <= 30;
          if (dateFilter === "ytd")    return d.getFullYear() === now.getFullYear();
          return true;
        });
      }

      send("progress", {
        message: `[keyword mode] Checking ${articles.length} articles from ${site.name}...`,
      });

      for (const article of articles) {
        if (!article.title) continue;
        const text = (article.title + " " + (article.summary || "")).toLowerCase();
        if (keywords.some(k => text.includes(k.toLowerCase()))) {
          const match = {
            source:  article.source,
            region:  article.region,
            title:   article.title,
            pubDate: article.pubDate || "",
            topic:   keywords[0],
            score:   null,
            link:    article.link,
          };
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

  // ── Embedding mode ───────────────────────────────────────────────────────
  send("progress", {
    message: `Query embedded ✓ — scanning articles (threshold: ${effectiveThreshold})...`,
  });

  for (const site of targetSites) {
    send("progress", { message: `Fetching ${site.name}...` });
    let articles = await fetchRSS(site);

    // Timezone-aware date filtering — pubDate stored as UTC, filter in local time
    if (dateFilter && dateFilter !== "all") {
      const before     = articles.length;
      const now        = new Date();
      const tzOffsetMs = now.getTimezoneOffset() * -60000;
      const localToday = now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, "0") + "-" +
        String(now.getDate()).padStart(2, "0");

      console.log(
        `  📅 [${site.name}] Local today: ${localToday} | ` +
        `TZ offset: ${tzOffsetMs / 3600000}h | filter: ${dateFilter}`
      );

      articles = articles.filter(a => {
        if (!a.pubDate) return false;
        const d = new Date(a.pubDate);
        if (isNaN(d)) return false;
        const diffDays = (now - d) / 86400000;

        if (dateFilter === "today") {
          // Convert UTC pubDate to local date string for accurate "today" matching
          const localD      = new Date(d.getTime() + tzOffsetMs);
          const articleLocal = localD.getUTCFullYear() + "-" +
            String(localD.getUTCMonth() + 1).padStart(2, "0") + "-" +
            String(localD.getUTCDate()).padStart(2, "0");
          const pass = articleLocal === localToday;
          console.log(
            `  ${pass ? "✅" : "❌"} UTC:${d.toISOString().slice(0, 10)} ` +
            `Local:${articleLocal} | ${a.title.slice(0, 50)}`
          );
          return pass;
        }
        if (dateFilter === "week")   return diffDays <= 7;
        if (dateFilter === "2weeks") return diffDays <= 14;
        if (dateFilter === "month")  return diffDays <= 30;
        if (dateFilter === "ytd")    return d.getFullYear() === now.getFullYear();
        return true;
      });

      const skipped = before - articles.length;
      send("progress", {
        message:
          `Checking ${articles.length} articles from ${site.name}` +
          (skipped ? ` (${skipped} filtered by date)` : "") + "...",
      });
    } else {
      send("progress", { message: `Checking ${articles.length} articles from ${site.name}...` });
    }

    // Score each article — isRelevant handles caching and silent failures
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

// ── Diagnostics and utilities ─────────────────────────────────────────────────

/**
 * GET /api/test-rss
 *
 * Validates that a feed URL is reachable and parseable before the user
 * adds it to their site list.
 *
 * WHY:    Prevents silent failures from bad feed URLs in the sites list.
 * GOTCHA: Returns { ok: false } (not HTTP error) on fetch failure so the
 *         client can display a user-friendly message without try/catch.
 *
 * Query params:
 *   url {string} - Full RSS/Atom feed URL to test (required)
 *
 * Returns: { ok: bool, status: number, statusText: string,
 *             feedUpdated: string|null, articles: [{title, link, pubDate}] }
 */
router.get("/test-rss", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url param required" });

  const parser = new XMLParser({
    processEntities: true, htmlEntities: true,
    allowBooleanAttributes: true, parseAttributeValue: false,
    entityExpansionLimit: 10000,
  });

  try {
    const r = await fetch(url, {
      method: "GET", timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; newsLookup/2.0)" },
    });
    if (!r.ok) {
      return res.json({ status: r.status, ok: false, statusText: r.statusText, articles: [] });
    }

    const xml        = await r.text();
    const parsed     = parser.parse(xml);
    const channel    = parsed?.rss?.channel || parsed?.feed;
    const items      = channel?.item || channel?.entry || [];
    const list       = Array.isArray(items) ? items : [items];
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

/**
 * GET /api/debug-embed
 *
 * Computes and returns the cosine similarity between two arbitrary strings.
 *
 * WHY:    Helps developers tune the threshold by testing specific query/article
 *         pairs and seeing their exact similarity score before adjusting config.
 *
 * Query params:
 *   query   {string} - Search query string
 *   article {string} - Article title or text to compare against
 *
 * Returns: { query, article, score: float, pct: integer }
 */
router.get("/debug-embed", async (req, res) => {
  const { query = "", article = "" } = req.query;
  if (!query || !article) {
    return res.status(400).json({ error: "query and article params required" });
  }
  try {
    const qVec = await getEmbedding(query, true);
    const aVec = await getEmbedding(article, false);
    if (!qVec || !aVec) return res.json({ error: "embedding failed" });
    const score = cosineSimilarity(qVec, aVec);
    res.json({
      query, article,
      score: Math.round(score * 1000) / 1000,
      pct:   Math.round(score * 100),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/embed-config
 * Returns the currently active embedding configuration.
 * Useful for the frontend to display which model and threshold are active.
 * Returns: { model: string, threshold: number, baseUrl: string }
 */
router.get("/embed-config", (req, res) => {
  res.json({ model: EMBED_MODEL, threshold: getSetting("search.embedThreshold"), baseUrl: EMBED_BASE_URL });
});

/**
 * GET /api/cache-status
 *
 * Returns the current state of all three in-memory caches.
 *
 * WHY:    Lets the frontend show users when results might be stale and
 *         offer a "refresh" option.
 * RETURNS:
 *   rssCache:    { sites, ageMs, ageSec, ageMins, label, ttlMs, expiresIn }
 *   vectorCache: { titles }    — number of article titles with cached vectors
 *   embedCache:  { entries }   — number of raw embed API responses cached
 */
router.get("/cache-status", (req, res) => {
  const ageMs   = getRssCacheAge();
  const ageSec  = ageMs ? Math.floor(ageMs / 1000)  : null;
  const ageMins = ageMs ? Math.floor(ageMs / 60000) : null;

  res.json({
    rssCache: {
      sites:     rssCache.size,
      ageMs, ageSec, ageMins,
      label:
        ageMs === null  ? "empty" :
        ageSec < 60     ? ageSec + "s ago" :
        ageMins + " min" + (ageMins !== 1 ? "s" : "") + " ago",
      ttlMs:     60000 * getSetting("rss.cacheTtlMinutes"),
      expiresIn: ageMs ? Math.max(0, Math.floor((60000 * getSetting("rss.cacheTtlMinutes") - ageMs) / 1000)) : null,
    },
    vectorCache: { titles:  articleVectorCache.size },
    embedCache:  { entries: embedCache.size },
  });
});

/**
 * POST /api/cache-refresh
 *
 * Clears the in-memory RSS cache, forcing all feeds to be re-fetched on
 * the next search.
 *
 * WHY:    Useful when breaking news drops and the user wants fresh articles
 *         without waiting for the natural TTL to expire.
 * GOTCHA: Only clears rssCache — articleVectorCache and embedCache are
 *         intentionally preserved because re-embedding is expensive.
 *
 * Returns: { ok: true, message: string }
 */
router.post("/cache-refresh", (req, res) => {
  rssCache.clear();
  console.log("🔄 RSS cache cleared — will refetch on next search");
  res.json({ ok: true, message: "RSS cache cleared" });
});
