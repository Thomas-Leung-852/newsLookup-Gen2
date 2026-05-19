/**
 * db/articlesDb.js — SQLite database for search history and keyword cache.
 *
 * ROLE:    Owns two tables:
 *            - articles            → every article matched during a search session
 *            - suggested_keywords_cache → AI-generated keyword results per region/date
 * OWNS:    `db` — the live sql.js Database instance (exported for direct queries
 *          in routes that need custom SQL, e.g. routes/history.js)
 * TALKS TO: sql.js (in-process SQLite), Node fs (file persistence)
 * DO NOT:  Import from routes/* or lib/* — this layer has no knowledge of HTTP
 *          or embeddings.
 *
 * GOTCHA:  sql.js keeps the entire DB in memory. Every write must call saveDB()
 *          immediately or changes are lost on process exit.
 */

import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { DB_PATH } from "../config.js";

/**
 * Live sql.js Database instance.
 * Null until initDB() resolves — never access before awaiting initDB().
 * Exported so routes can run custom .exec() queries directly.
 */
export let db = null;

/**
 * Initialises the articles SQLite database.
 *
 * WHY:    sql.js requires an async WASM load before any DB operations.
 *         This function handles both: loading an existing DB file from disk
 *         or creating a fresh one with the correct schema.
 * SIDE FX: Sets the module-level `db` variable. Calls saveDB() once to
 *          flush the schema to disk if the file is new.
 * CALLED BY: server.js → Promise.all([initDB(), initCollectionDB()])
 */
export async function initDB() {
  const SQL = await initSqlJs();

  // Load existing file or start fresh
  if (existsSync(DB_PATH)) {
    db = new SQL.Database(readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  // articles table — one row per matched article per search
  // `link` is UNIQUE so duplicate URLs from repeated searches are silently ignored
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
  db.run(`CREATE INDEX IF NOT EXISTS idx_pubDate   ON articles(pubDate)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_fetchedAt ON articles(fetchedAt)`);

  // suggested_keywords_cache — stores AI keyword results keyed by (region, dateFilter)
  // UNIQUE constraint means re-generating keywords for the same region+date
  // overwrites the old row via INSERT OR REPLACE
  db.run(`
    CREATE TABLE IF NOT EXISTS suggested_keywords_cache (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      region      TEXT NOT NULL,
      dateFilter  TEXT NOT NULL,
      keywords    TEXT NOT NULL,       -- JSON string: [{keyword, count}]
      generatedAt TEXT NOT NULL,       -- ISO8601 timestamp
      UNIQUE(region, dateFilter)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_skw_region ON suggested_keywords_cache(region, dateFilter)`);

  saveDB();
  console.log("📦 SQLite articles DB ready:", DB_PATH);
}

/**
 * Persists the in-memory sql.js database to disk.
 *
 * WHY:    sql.js is entirely in-memory — calling this after every write
 *         is the only way to survive a process restart.
 * SIDE FX: Overwrites DB_PATH on disk synchronously.
 * CALLED BY: initDB(), insertArticle(), and keyword routes after any write.
 */
export function saveDB() {
  const data = db.export();
  writeFileSync(DB_PATH, Buffer.from(data));
}

/**
 * Inserts a matched article into the articles table.
 *
 * WHY:    Centralises the insert + save so callers (routes/search.js) do not
 *         need to know the table schema or handle duplicate-link errors.
 * GOTCHA: Uses INSERT OR IGNORE — if the same link already exists in the DB
 *         (from a previous search), the row is silently skipped. No error thrown.
 * SIDE FX: Calls saveDB() on every successful insert.
 *
 * @param {object} article
 * @param {string} article.source   - RSS feed name (e.g. "SCMP")
 * @param {string} article.region   - Geographic tag (e.g. "HK", "Global")
 * @param {string} article.title    - Article headline
 * @param {string} article.link     - Canonical article URL (must be unique)
 * @param {string} [article.pubDate]- ISO8601 publish date or empty string
 * @param {string} [article.topic]  - Matched topic/keyword label
 */
export function insertArticle(article) {
  try {
    db.run(
      `INSERT OR IGNORE INTO articles (source, region, title, link, pubDate, fetchedAt, topic)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        article.source,
        article.region,
        article.title,
        article.link,
        article.pubDate || null,
        new Date().toISOString(),
        article.topic || null,
      ]
    );
    saveDB();
  } catch (_) {
    // Silently ignore constraint violations (duplicate link)
  }
}

/**
 * Builds a SQL WHERE clause fragment for date-range filtering.
 *
 * WHY:    Multiple routes need the same date filter logic against pubDate.
 *         Centralising it here prevents drift between routes/history.js
 *         and routes/keywords.js.
 * GOTCHA: Uses SQLite's date() and datetime() functions — these operate in UTC.
 *         For "today" filtering in local time, routes/search.js does its own
 *         JS-side timezone-aware filtering instead of relying on this function.
 * RETURNS: A SQL string fragment suitable for WHERE clauses, or null for "all"
 *          (meaning no date filter should be applied).
 *
 * @param {string} filter - One of: "today","yesterday","week","2weeks","month","ytd","all"
 * @returns {string|null}
 */
export function dateFilterSQL(filter) {
  const f = (filter || "all").toLowerCase();
  if (f === "today")     return `date(pubDate) = date('now')`;
  if (f === "yesterday") return `date(pubDate) = date('now', '-1 day')`;
  if (f === "week")      return `pubDate >= datetime('now', '-7 days')`;
  if (f === "2weeks")    return `pubDate >= datetime('now', '-14 days')`;
  if (f === "month")     return `pubDate >= datetime('now', '-1 month')`;
  if (f === "ytd")       return `strftime('%Y', pubDate) = strftime('%Y', 'now')`;
  return null; // "all" — caller should omit the WHERE clause entirely
}
