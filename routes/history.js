/**
 * routes/history.js — Search history endpoints.
 *
 * ROLE:    Read and clear the articles table which stores every article
 *          matched across all past searches.
 * MOUNTS AT: /api/history  (registered in server.js)
 * TALKS TO:  db/articlesDb.js
 * DO NOT:    Write articles here — insertArticle() in articlesDb.js is the
 *            only writer, called from routes/search.js during a live search.
 */

import { Router } from "express";
import { db, saveDB, dateFilterSQL } from "../db/articlesDb.js";

export const router = Router();

/**
 * GET /api/history
 *
 * Returns up to 500 past matched articles, with optional date and text filters.
 *
 * WHY:    Lets the frontend show what was found in previous searches without
 *         re-running the search. Useful for reviewing results across sessions.
 * GOTCHA: Uses dateFilterSQL() which operates in UTC via SQLite's date().
 *         For precise local-timezone "today" filtering use the search route
 *         instead, which does JS-side timezone-aware filtering.
 *
 * Query params:
 *   filter {string} - Date range: "today"|"yesterday"|"week"|"2weeks"|"month"|"ytd"|"all"
 *   q      {string} - Free-text search against title, topic, and source columns
 *
 * Returns: { articles: object[], total: number }
 */
router.get("/", (req, res) => {
  try {
    const { filter = "all", q = "" } = req.query;
    const dateWhere  = dateFilterSQL(filter);
    const conditions = [];
    const params     = [];

    if (dateWhere) conditions.push(dateWhere);

    if (q) {
      // Match against title, topic, and source — covers most search intentions
      conditions.push("(title LIKE ? OR topic LIKE ? OR source LIKE ?)");
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const rows  = db.exec(
      `SELECT id,source,region,title,link,pubDate,fetchedAt,topic
       FROM articles ${where}
       ORDER BY fetchedAt DESC
       LIMIT 500`,
      params
    );

    if (!rows.length) return res.json({ articles: [], total: 0 });

    // sql.js returns columnar data — zip column names with row values
    const cols     = rows[0].columns;
    const articles = rows[0].values.map(
      row => Object.fromEntries(cols.map((c, i) => [c, row[i]]))
    );
    res.json({ articles, total: articles.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/history
 *
 * Permanently deletes all rows from the articles table.
 *
 * WHY:    Lets the user wipe history to save disk space or start fresh.
 * GOTCHA: Irreversible — there is no soft-delete or recycle bin. The saved
 *         clippings in collection.db are NOT affected by this operation.
 * SIDE FX: Calls saveDB() to flush the cleared state to disk immediately.
 *
 * Returns: { ok: true }
 */
router.delete("/", (req, res) => {
  try {
    db.run("DELETE FROM articles");
    saveDB();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
