import 'dotenv/config';

/**
 * config.js — Single source of truth for all environment variables and constants.
 *
 * ROLE:    Centralises every tuneable value so no magic strings or numbers
 *          appear elsewhere in the codebase.
 * RULE:    No other file should call process.env directly — import from here.
 * GOTCHA:  __dirname is re-derived here because ES Modules do not expose it
 *          natively. All DB and JSON file paths are built relative to this.
 */

import { fileURLToPath } from "url";
import { dirname, join } from "path";

/** Absolute path to the project root — used to build all file paths below. */
export const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Server ────────────────────────────────────────────────────────────────────

/** TCP port Express listens on. Override with PORT env var. */
export const PORT = process.env.PORT || 3000;

// ── Cloud AI model (Ollama Cloud) ─────────────────────────────────────────────
// Used for: summaries, keyword extraction, tag suggestions.
// These calls go OUT to Ollama's cloud API and require an API key.

/** Ollama cloud model name — e.g. "qwen3.5:cloud", "llama3:cloud". */
export const AI_MODEL = process.env.AI_MODEL || "qwen3.5:cloud";

/**
 * Ollama Cloud API key.
 * GOTCHA: If empty or missing, any route that calls callAI() returns HTTP 500
 *         immediately. Routes check this before making AI calls.
 */
export const AI_API_KEY = process.env.AI_API_KEY || "";

/** Base URL for the cloud Ollama API endpoint. */
export const AI_BASE_URL = process.env.AI_BASE_URL || "https://ollama.com";

// ── Local embedding model (Ollama Local) ──────────────────────────────────────
// Used for: semantic article matching in POST /api/search.
// These calls stay LOCAL — Ollama must be running on the same machine.
// Pull the model first:
//   ollama pull qwen3-embedding:0.6b   (tiny, ~400MB, fast)
//   ollama pull qwen3-embedding:8b     (best quality, needs ~5GB RAM)

/** Ollama local model name for generating text embeddings. */
export const EMBED_MODEL = process.env.EMBED_MODEL || "qwen3-embedding:8b";

/** Base URL for the local Ollama instance — must never point to a cloud URL. */
export const EMBED_BASE_URL = process.env.EMBED_BASE_URL || "http://localhost:11434";


// ── RSS cache TTL ─────────────────────────────────────────────────────────────

/**
 * How long (ms) RSS feed data is kept in memory before a live refetch.
 * Default: 15 minutes (900,000ms).
 * GOTCHA: In-memory only — restarting the server clears all RSS cache.
 */
export const RSS_CACHE_TTL = parseInt(process.env.RSS_CACHE_TTL || "900000");

// ── File paths ────────────────────────────────────────────────────────────────

/** SQLite file for search history + keyword cache. Managed by db/articlesDb.js. */
export const DB_PATH = join(__dirname, "articles.db");

/** SQLite file for saved clippings + summary cache. Managed by db/collectionDb.js. */
export const COLLECTION_PATH = join(__dirname, "collection.db");

/**
 * JSON file listing all RSS news sources.
 * Shape per entry: { name: string, region: string, rss: string (URL) }
 * Updated at runtime via PUT /api/sites in routes/search.js.
 */
export const SITES_PATH = join(__dirname, "rss-sites.json");

/**
 * JSON file containing per-model Ollama generation options.
 * Shape: { "model-name": { temperature: 0.7, top_p: 0.9 }, _comment: "..." }
 * GOTCHA: Missing file or unknown model name is silently ignored —
 *         Ollama model defaults are used instead. Never throws.
 */
export const PROFILES_PATH = join(__dirname, "model-profiles.json");

// ── Rate limiting ─────────────────────────────────────────────────────────────

/**
 * Rate-limit settings for outbound AI API calls.
 * Currently defined but not yet wired into callAI() — reserved for future use.
 *   delayMs:      minimum pause between consecutive calls
 *   maxRetries:   max retry attempts on transient failure
 *   retryDelayMs: wait before each retry
 */
export const RATE_LIMIT = {
  delayMs:      700,
  maxRetries:   3,
  retryDelayMs: 15000,
};

// ── Keyword cache TTL ─────────────────────────────────────────────────────────

/**
 * How long (ms) AI-generated keyword suggestions stay "fresh" in the DB cache.
 * After this, GET /api/suggested-keywords returns { status: "stale" }.
 * Client should call POST /api/suggested-keywords/generate to refresh.
 * Default: 3 hours.
 */
export const SUGGESTED_KEYWORDS_TTL_MS = 3 * 60 * 60 * 1000;
