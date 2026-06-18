/**
 * db/collectionDb.js — SQLite database for saved clippings and summary cache.
 *
 * ROLE:    Owns two tables:
 *            - collection    → articles the user manually saved ("clippings")
 *            - summary_cache → AI-generated summaries keyed by article URL
 * OWNS:    `collectionDb` — the live sql.js Database instance (exported for
 *          direct queries in routes/collection.js)
 * TALKS TO: sql.js (in-process SQLite), Node fs (file persistence)
 * DO NOT:  Import from routes/* or lib/* — this layer has no HTTP knowledge.
 *
 * GOTCHA:  sql.js keeps the entire DB in memory. Every write must call
 *          saveCollectionDB() immediately or changes are lost on process exit.
 */

import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { COLLECTION_PATH } from "../config.js";

/**
 * Live sql.js Database instance for the clippings collection.
 * Null until initCollectionDB() resolves — never access before awaiting it.
 * Exported so routes/collection.js can run custom .exec() queries directly.
 */
export let collectionDb = null;

/**
 * Initialises the clippings SQLite database.
 *
 * WHY:    sql.js requires an async WASM load before any DB operations.
 *         Loads existing DB from disk or creates fresh schema on first run.
 * SIDE FX: Sets the module-level `collectionDb` variable. Calls
 *          saveCollectionDB() once to flush schema to disk if the file is new.
 * CALLED BY: server.js → Promise.all([initDB(), initCollectionDB()])
 */
export async function initCollectionDB() {
  const SQL = await initSqlJs();

  if (existsSync(COLLECTION_PATH)) {
    collectionDb = new SQL.Database(readFileSync(COLLECTION_PATH));
  } else {
    collectionDb = new SQL.Database();
  }

  // collection table — one row per user-saved article ("clipping")
  // newsId is a SHA-256 hash of the URL, used as a stable dedup key
  // vector stores the embedding as a JSON-serialised float array (TEXT)
  // tags stores a comma-separated string of user/AI-assigned labels
  // thumbnail stores the article image URL extracted from the RSS feed
  collectionDb.run(`
    CREATE TABLE IF NOT EXISTS collection (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      newsId    TEXT UNIQUE NOT NULL,  -- SHA-256(url), stable dedup key
      url       TEXT NOT NULL,
      title     TEXT NOT NULL,
      summary   TEXT,                  -- AI-generated, nullable until fetched
      vector    TEXT,                  -- JSON float array, nullable until embedded
      score     REAL,                  -- cosine similarity score at save time
      threshold REAL,                  -- threshold active when article was found
      source    TEXT,
      region    TEXT,
      pubDate   TEXT,                  -- ISO8601, normalised on insert
      savedAt   TEXT NOT NULL,         -- ISO8601 insert timestamp
      tags      TEXT,                  -- comma-separated, e.g. "trade war, hk politics"
      thumbnail TEXT                   -- image URL extracted from RSS feed, nullable
    )
  `);

  // Migration: add thumbnail column to existing databases that predate this field
  try {
    collectionDb.run(`ALTER TABLE collection ADD COLUMN thumbnail TEXT`);
    console.log("✂️  Migrated collection table: added thumbnail column");
  } catch (_) {
    // Column already exists — safe to ignore
  }
  collectionDb.run(`CREATE INDEX IF NOT EXISTS idx_savedAt ON collection(savedAt)`);
  collectionDb.run(`CREATE INDEX IF NOT EXISTS idx_pubDate ON collection(pubDate)`);

  // summary_cache table — deduplicates AI summary calls by URL
  // level records which fallback tier produced the summary:
  //   "full_article" | "rss_description" | "title_only"
  collectionDb.run(`
    CREATE TABLE IF NOT EXISTS summary_cache (
      url       TEXT PRIMARY KEY,
      title     TEXT,
      summary   TEXT NOT NULL,
      level     TEXT,    -- which fallback tier produced this: full_article | rss_description | title_only
      model     TEXT,    -- AI_MODEL value at generation time
      createdAt TEXT NOT NULL
    )
  `);

  saveCollectionDB();
  console.log("✂️  Clippings DB ready:", COLLECTION_PATH);
}

/**
 * Persists the in-memory clippings database to disk.
 *
 * WHY:    sql.js is entirely in-memory — this must be called after every
 *         write or changes will be lost on process exit.
 * SIDE FX: Overwrites COLLECTION_PATH on disk synchronously.
 * CALLED BY: initCollectionDB(), cacheSummary(), and all routes/collection.js
 *            write operations.
 */
export function saveCollectionDB() {
  const data = collectionDb.export();
  writeFileSync(COLLECTION_PATH, Buffer.from(data));
}

// ── Summary cache helpers ─────────────────────────────────────────────────────

/**
 * Retrieves a cached AI summary for the given article URL.
 *
 * WHY:    Avoids re-calling the cloud AI for articles already summarised.
 *         routes/summarise.js checks this before any AI or fetch call.
 * GOTCHA: Returns null both when the URL is not in cache AND when the DB
 *         query itself throws — callers cannot distinguish the two cases.
 *         Both are treated as "cache miss, proceed to generate".
 * RETURNS: { summary, level, model, cached: true } or null on miss/error.
 *
 * @param {string} url - Canonical article URL used as the cache key.
 * @returns {{ summary: string, level: string, model: string, cached: true } | null}
 */
export function getCachedSummary(url) {
  try {
    const rows = collectionDb.exec(
      "SELECT summary, level, model FROM summary_cache WHERE url=?",
      [url]
    );
    if (!rows.length || !rows[0].values.length) return null;
    const [summary, level, model] = rows[0].values[0];
    return { summary, level, model, cached: true };
  } catch {
    return null; // treat any DB error as a cache miss
  }
}

/**
 * Writes an AI-generated summary into the summary_cache table.
 *
 * WHY:    Centralises the cache write so routes/summarise.js does not
 *         need to know the table schema.
 * SIDE FX: Uses INSERT OR REPLACE — re-summarising the same URL overwrites
 *          the old entry. Calls saveCollectionDB() immediately after write.
 * GOTCHA: Failures are logged as warnings but not re-thrown — a failed cache
 *         write will not break the summarise response to the client.
 *
 * @param {string} url     - Article URL (cache key)
 * @param {string} title   - Article headline (stored for reference only)
 * @param {string} summary - AI-generated bullet-point summary text
 * @param {string} level   - Fallback tier: "full_article" | "rss_description" | "title_only"
 * @param {string} model   - AI_MODEL value used to generate this summary
 */
export function cacheSummary(url, title, summary, level, model) {
  try {
    collectionDb.run(
      `INSERT OR REPLACE INTO summary_cache (url, title, summary, level, model, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [url, title, summary, level, model, new Date().toISOString()]
    );
    saveCollectionDB();
  } catch (e) {
    console.warn("Summary cache write failed:", e.message);
  }
}
