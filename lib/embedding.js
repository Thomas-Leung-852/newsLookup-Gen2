/**
 * lib/embedding.js — Semantic matching engine: embeddings, similarity, relevance.
 *
 * ROLE:    Core intelligence layer. Converts text to vectors and scores how
 *          semantically close an article title is to the user's search query.
 * OWNS:    Three in-memory Maps (all lost on server restart):
 *            rssCache          — RSS fetch results, TTL-bounded
 *            articleVectorCache — per-title embedding vectors
 *            embedCache        — raw embedding results keyed by text prefix
 * TALKS TO: Ollama LOCAL only (never the cloud AI client in lib/ai.js)
 * DO NOT:  Import from routes/* — this layer has no HTTP knowledge.
 *
 * GOTCHA:  All three caches are module-level singletons. They are shared
 *          across all route handlers in the same process. Clearing one
 *          (e.g. embedCache.clear() in search.js) affects all callers.
 */

import { Ollama } from "ollama";
import { EMBED_MODEL, EMBED_BASE_URL } from "../config.js";

/**
 * Ollama client pointed at the LOCAL instance.
 * WHY: Embeddings must run locally for latency and privacy reasons.
 *      Never swap this for the cloud client in lib/ai.js.
 */
export const ollamaLocal = new Ollama({ host: EMBED_BASE_URL });

// ── In-memory caches ──────────────────────────────────────────────────────────

/**
 * RSS feed cache — stores fetched articles per feed URL.
 * Shape: Map<feedUrl: string, { articles: object[], fetchedAt: number }>
 * Managed by lib/rss.js (reads TTL from config.RSS_CACHE_TTL).
 * Exported here because rss.js imports it to avoid a circular dep.
 */
export const rssCache = new Map();

/**
 * Article vector cache — stores Float32Array embeddings per article title.
 * Shape: Map<title: string, Float32Array>
 * WHY: Avoids re-embedding the same title on every search. Titles are stable
 *      identifiers for articles so this key is safe and collision-resistant.
 */
export const articleVectorCache = new Map();

/**
 * Embed call cache — deduplicates raw Ollama embed API calls.
 * Shape: Map<"Q:"+text | "A:"+text, Float32Array>
 * Keys are prefixed with "Q:" (query) or "A:" (article) to prevent
 * cross-contamination when the same string appears as both.
 * WHY: Embedding the same query string multiple times per search is wasteful.
 */
export const embedCache = new Map();

// ── Cache utilities ───────────────────────────────────────────────────────────

/**
 * Returns the age in milliseconds of the oldest entry in rssCache.
 *
 * WHY:    Used by GET /api/cache-status to report how stale the RSS data is.
 * RETURNS: Age in ms, or null if rssCache is empty.
 */
export function getRssCacheAge() {
  if (!rssCache.size) return null;
  const oldest = Math.min(...[...rssCache.values()].map(v => v.fetchedAt));
  return Date.now() - oldest;
}

// ── Core math ─────────────────────────────────────────────────────────────────

/**
 * Computes the cosine similarity between two embedding vectors.
 *
 * WHY:    Cosine similarity measures the angle between vectors, not magnitude,
 *         making it robust to different text lengths. Range: -1.0 to 1.0,
 *         where 1.0 = identical direction, 0 = unrelated.
 * GOTCHA: Accepts both plain arrays and Float32Array — normalises internally.
 *         Returns 0 (not an error) if either vector has zero magnitude.
 *
 * @param {number[]|Float32Array} a
 * @param {number[]|Float32Array} b
 * @returns {number} Similarity score between -1.0 and 1.0
 */
export function cosineSimilarity(a, b) {
  const fa = (a instanceof Float32Array) ? a : new Float32Array(a);
  const fb = (b instanceof Float32Array) ? b : new Float32Array(b);
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < fa.length; i++) {
    dot  += fa[i] * fb[i];
    magA += fa[i] * fa[i];
    magB += fb[i] * fb[i];
  }
  return (magA && magB) ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

// ── Embedding ─────────────────────────────────────────────────────────────────

/**
 * Converts a text string into a Float32Array embedding vector via local Ollama.
 *
 * WHY:    Abstracts the Ollama API version differences (embed vs embeddings)
 *         and applies qwen3-specific instruction prefixes when needed.
 * GOTCHA: Returns null (does NOT throw) on any failure — Ollama offline,
 *         model not pulled, empty response. Callers must handle null.
 *         embedCache is keyed on the first 200 chars of text — extremely long
 *         strings with identical prefixes will share a cache entry.
 *
 * @param {string}  text    - The text to embed (article title or search query)
 * @param {boolean} isQuery - True for search queries, false for article titles.
 *                            Controls the instruction prefix for qwen3 models
 *                            and the embedCache key prefix ("Q:" vs "A:").
 * @returns {Promise<Float32Array|null>}
 */
export async function getEmbedding(text, isQuery = false) {
  const key = (isQuery ? "Q:" : "A:") + text.slice(0, 200);
  if (embedCache.has(key)) return embedCache.get(key);

  try {
    // qwen3-embedding models require a task-specific instruction prefix
    // to produce high-quality asymmetric query/document embeddings
    const isQwen3 = EMBED_MODEL.startsWith("qwen3-embedding");
    let input = text;
    if (isQwen3) {
      input = isQuery
        ? "Instruct: Retrieve relevant news articles\nQuery: " + text
        : "Instruct: Represent this news article title for retrieval\nQuery: " + text;
    }

    // Try new API first (ollama.embed), fall back to older API (ollama.embeddings)
    let vec = null;
    try {
      const res = await ollamaLocal.embed({ model: EMBED_MODEL, input });
      vec = res.embeddings?.[0] || res.embedding;
    } catch {
      const res = await ollamaLocal.embeddings({ model: EMBED_MODEL, prompt: input });
      vec = res.embedding;
    }

    if (!vec || !vec.length) {
      console.warn("  Empty embedding returned for:", text.slice(0, 50));
      return null;
    }

    const typedVec = new Float32Array(vec);
    embedCache.set(key, typedVec);
    return typedVec;
  } catch (err) {
    console.warn("  Embedding error:", err.message);
    return null; // caller must treat null as "embedding unavailable"
  }
}

// ── Relevance scoring ─────────────────────────────────────────────────────────

/**
 * Determines whether a single article is semantically relevant to a query.
 *
 * WHY:    Wraps getEmbedding + cosineSimilarity with caching and structured
 *         return value so routes/search.js doesn't manage vector logic inline.
 * GOTCHA: If getEmbedding returns null (Ollama offline), this returns
 *         { relevant: false, score: 0 } silently — the search continues in
 *         degraded mode without surfacing an error to the user per article.
 *         The route-level fallback to keyword mode handles the offline case.
 *         Only articles scoring >= 30% are logged to avoid console noise.
 *
 * @param {object}      article   - Article object with at least a `title` string
 * @param {Float32Array} queryVec - Pre-computed query embedding from getEmbedding()
 * @param {number}       threshold - Minimum score to consider relevant (0.0–1.0)
 * @returns {Promise<{ relevant: boolean, score: number, topic: string }>}
 */
export async function isRelevant(article, queryVec, threshold) {
  try {
    // Check articleVectorCache before calling Ollama
    let articleVec = articleVectorCache.get(article.title);
    if (!articleVec) {
      articleVec = await getEmbedding(article.title);
      if (articleVec) articleVectorCache.set(article.title, new Float32Array(articleVec));
    }

    // If embedding failed, mark as not relevant rather than throwing
    if (!articleVec) return { relevant: false, topic: "", score: 0 };

    const score    = cosineSimilarity(queryVec, articleVec);
    const relevant = score >= threshold;
    const pct      = Math.round(score * 100);

    // Log articles scoring 30%+ to help debug threshold tuning
    if (pct >= 30) {
      console.log(`  ${relevant ? "✅" : "  "} ${pct}% | ${article.title.slice(0, 70)}`);
    }

    return {
      relevant,
      score: Math.round(score * 100) / 100,
      // topic is only populated on relevant matches — used as a label in history
      topic: relevant ? article.title.slice(0, 80) : "",
    };
  } catch (err) {
    console.warn("  Match error:", err.message);
    return { relevant: false, topic: "", score: 0 };
  }
}
