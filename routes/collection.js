/**
 * routes/collection.js — Full CRUD for the user's saved clippings collection.
 *
 * ROLE:    Manages the collection table: saving, deleting, tagging, embedding,
 *          semantic search within saved articles, and AI tag suggestions.
 * MOUNTS AT: /api/collection  (registered in server.js)
 * TALKS TO:  db/collectionDb.js, lib/embedding.js, lib/ai.js
 *
 * ROUTE SUMMARY:
 *   GET    /api/collection                  — list all saved clippings
 *   GET    /api/collection/unembedded       — list clippings missing a vector
 *   GET    /api/collection/get-vector       — get/generate vector for a title
 *   POST   /api/collection                  — save a new clipping
 *   POST   /api/collection/summary          — update summary text by row id
 *   POST   /api/collection/embed            — generate+store vector for a clipping
 *   POST   /api/collection/update-vector    — re-embed using title+summary combined
 *   POST   /api/collection/search           — semantic search within collection
 *   POST   /api/collection/suggest-tags     — AI-suggested tags for a clipping
 *   PATCH  /api/collection/:id/tags         — update tags for a clipping
 *   DELETE /api/collection/:id              — delete one clipping
 *   DELETE /api/collection                  — delete all clippings
 */

import { Router }     from "express";
import { createHash } from "crypto";
import { AI_API_KEY } from "../config.js";
import { collectionDb, saveCollectionDB } from "../db/collectionDb.js";
import { getEmbedding, articleVectorCache, cosineSimilarity } from "../lib/embedding.js";
import { callAI } from "../lib/ai.js";
import { getSetting } from "../lib/settings.js";

export const router = Router();

/**
 * GET /api/collection
 *
 * Returns saved clippings ordered by pubDate (falling back to savedAt),
 * with optional date range filtering.
 *
 * WHY:    pubDate is preferred over savedAt so the collection timeline reflects
 *         when news happened, not when the user saved it.
 * GOTCHA: dateFrom/dateTo filtering is done in JS after the DB query (not SQL)
 *         because pubDate values can be malformed or empty, and JS's Date
 *         constructor is more forgiving than SQLite's date() function.
 *
 * Query params:
 *   dateFrom {string} - ISO date string e.g. "2024-01-01" (inclusive)
 *   dateTo   {string} - ISO date string e.g. "2024-01-31" (inclusive, end of day)
 *   limit    {number} - Max rows to return (default: 500)
 *
 * Returns: { items: object[], total: number }
 */
router.get("/", (req, res) => {
  try {
    const { dateFrom, dateTo, limit = 500 } = req.query;
    const rows = collectionDb.exec(
      `SELECT id,newsId,url,title,summary,score,threshold,source,region,pubDate,savedAt,tags,thumbnail
       FROM collection
       ORDER BY COALESCE(NULLIF(pubDate,''), savedAt) DESC
       LIMIT ?`,
      [parseInt(limit)]
    );
    if (!rows.length) return res.json({ items: [], total: 0 });

    const cols = rows[0].columns;
    let items  = rows[0].values.map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));

    // JS-side date filter — more robust than SQL for inconsistent pubDate formats
    if (dateFrom || dateTo) {
      const from = dateFrom ? new Date(dateFrom) : null;
      const to   = dateTo   ? new Date(dateTo + "T23:59:59") : null;
      items = items.filter(item => {
        const d = new Date(item.pubDate);
        if (isNaN(d)) return false;
        if (from && d < from) return false;
        if (to   && d > to)   return false;
        return true;
      });
    }
    res.json({ items, total: items.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/collection/unembedded
 *
 * Returns clippings that have no embedding vector yet (vector IS NULL).
 *
 * WHY:    The frontend uses this to identify articles that need embedding
 *         before semantic search will work on them. Typically called on
 *         startup or after a bulk import.
 *
 * Returns: { items: [{ id, newsId, url, title }], total: number }
 */
router.get("/unembedded", (req, res) => {
  try {
    const rows = collectionDb.exec(
      "SELECT id,newsId,url,title FROM collection WHERE vector IS NULL ORDER BY savedAt DESC"
    );
    if (!rows.length) return res.json({ items: [], total: 0 });
    const cols  = rows[0].columns;
    const items = rows[0].values.map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
    res.json({ items, total: items.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/collection/get-vector
 *
 * Returns (or generates on-demand) the embedding vector for a given title.
 *
 * WHY:    Allows the frontend to pre-warm the vector cache for a title before
 *         saving it to the collection.
 * GOTCHA: Returns { vector: null } (not an error) if embedding fails —
 *         callers should treat null as "embedding unavailable, try later".
 *
 * Query params:
 *   title {string} - Article headline to embed (required)
 *
 * Returns: { vector: number[]|null }
 */
router.get("/get-vector", async (req, res) => {
  const { title } = req.query;
  if (!title) return res.status(400).json({ error: "title required" });
  try {
    let vec = articleVectorCache.get(title);
    if (!vec) {
      vec = await getEmbedding(title);
      if (vec) articleVectorCache.set(title, vec);
    }
    res.json({ vector: vec || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/collection
 *
 * Saves a new article clipping to the collection, or replaces an existing one
 * with the same newsId (via INSERT OR REPLACE).
 *
 * WHY:    newsId is a SHA-256 hash of the URL, making it a stable dedup key
 *         that survives re-saves and imports without needing the DB row id.
 * GOTCHA: vector is stored as a JSON string (TEXT column) not a BLOB because
 *         sql.js doesn't support typed array storage natively.
 *         pubDate is normalised to ISO8601 on insert — malformed dates become "".
 *         tags are normalised: trimmed, deduplicated spaces, comma-separated.
 *
 * Request body:
 *   url     {string}  - Article URL (required)
 *   title   {string}  - Headline (required)
 *   newsId  {string}  - Optional stable ID; SHA-256(url) used if omitted
 *   summary {string}  - AI summary text
 *   vector  {string}  - JSON float array string (optional, pre-computed)
 *   score   {number}  - Cosine similarity score at save time
 *   threshold {number}- Threshold active when article was found
 *   source  {string}  - RSS feed name
 *   region  {string}  - Geographic tag
 *   pubDate {string}  - Article publish date (any parseable format)
 *   tags    {string}  - Comma-separated tag string
 *
 * Returns: { ok: true, newsId: string }
 */
router.post("/", (req, res) => {
  try {
    const { newsId, url, title, summary, vector, score, threshold,
            source, region, pubDate, tags, thumbnail } = req.body;
    if (!url || !title) return res.status(400).json({ error: "url and title required" });

    // Stable dedup key — SHA-256 of URL if not supplied by caller
    const id = newsId || createHash("sha256").update(url).digest("hex");

    // Prefer the live articleVectorCache over the caller-supplied vector string
    // (cache may be more recent if the article was just embedded this session)
    let articleVec = articleVectorCache.get(title);
    let v1 = null;
    if (articleVec) {
      v1 = JSON.stringify(Array.from(articleVec));
    } else if (vector && typeof vector === "string" && vector.startsWith("[")) {
      v1 = vector;
    }

    // Normalise pubDate to ISO8601 — store empty string if unparseable
    let normalizedPubDate = "";
    if (pubDate) {
      const d = new Date(pubDate);
      normalizedPubDate = isNaN(d) ? pubDate : d.toISOString();
    }

    // Normalise tags: trim whitespace, filter empty, rejoin with ", "
    const normalisedTags = tags
      ? tags.split(",").map(t => t.trim()).filter(Boolean).join(", ") || null
      : null;

    collectionDb.run(
      `INSERT OR REPLACE INTO collection
         (newsId,url,title,summary,vector,score,threshold,source,region,pubDate,savedAt,tags,thumbnail)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, url, title, summary || "", v1,
       score || null, threshold || null, source || "", region || "",
       normalizedPubDate, new Date().toISOString(), normalisedTags,
       thumbnail || null]
    );
    saveCollectionDB();
    res.json({ ok: true, newsId: id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/collection/summary
 *
 * Updates the summary text of an existing collection row by row id.
 *
 * WHY:    Allows the frontend to back-fill a summary after it is generated
 *         asynchronously, without re-saving the whole article object.
 *
 * Request body:
 *   id      {number} - DB row id (required)
 *   summary {string} - New summary text
 *
 * Returns: { ok: true }
 */
router.post("/summary", (req, res) => {
  try {
    const { id, summary } = req.body;
    if (!id) return res.status(400).json({ error: "id required" });
    collectionDb.run("UPDATE collection SET summary=? WHERE id=?", [summary, id]);
    saveCollectionDB();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/collection/embed
 *
 * Generates an embedding vector for a given title and optionally stores it
 * against the matching collection row by newsId.
 *
 * WHY:    Decouples embedding from saving — the frontend can embed articles
 *         in the background after saving, or batch-embed unembedded articles.
 * GOTCHA: If newsId is omitted, the vector is generated and cached in memory
 *         but NOT written to the DB. The caller must provide newsId if
 *         persistence is needed.
 *
 * Request body:
 *   title  {string} - Article headline to embed (required)
 *   newsId {string} - Collection row newsId for DB update (optional)
 *
 * Returns: { ok: true, cached: true, dims: number }
 */
router.post("/embed", async (req, res) => {
  const { title, newsId } = req.body;
  if (!title) return res.status(400).json({ error: "title required" });
  try {
    let vec = articleVectorCache.get(title);
    if (!vec) {
      vec = await getEmbedding(title);
      if (!vec) return res.status(500).json({ error: "Embedding failed — is EMBED_MODEL running?" });
      articleVectorCache.set(title, vec);
    }
    if (newsId) {
      collectionDb.run(
        "UPDATE collection SET vector=? WHERE newsId=?",
        [JSON.stringify(Array.from(vec)), newsId]
      );
      saveCollectionDB();
    }
    res.json({ ok: true, cached: true, dims: vec.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/collection/update-vector
 *
 * Re-embeds an article using title + summary combined for a richer vector.
 *
 * WHY:    Embedding title alone misses topical detail in the summary. After
 *         a summary is generated, calling this improves semantic search quality
 *         for that article significantly.
 * GOTCHA: Overwrites the existing vector — there is no rollback. The old
 *         title-only vector is lost. articleVectorCache is updated in-memory too.
 *
 * Request body:
 *   newsId  {string} - Collection row newsId (required)
 *   title   {string} - Article headline (required)
 *   summary {string} - AI-generated summary text (required)
 *
 * Returns: { ok: true, newsId: string, dims: number }
 */
router.post("/update-vector", async (req, res) => {
  const { title, summary, newsId } = req.body;
  if (!title)   return res.status(400).json({ error: "title required" });
  if (!summary) return res.status(400).json({ error: "summary required" });
  if (!newsId)  return res.status(400).json({ error: "newsId required" });
  try {
    // Combine title + summary for a denser semantic representation
    const vec = await getEmbedding(title + " " + summary);
    if (!vec) return res.status(500).json({ error: "Embedding failed — is EMBED_MODEL running?" });
    collectionDb.run(
      "UPDATE collection SET vector=? WHERE newsId=?",
      [JSON.stringify(Array.from(vec)), newsId]
    );
    saveCollectionDB();
    articleVectorCache.set(title, vec); // keep cache consistent
    res.json({ ok: true, newsId, dims: vec.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/collection/search
 *
 * Performs semantic similarity search across all embedded clippings.
 *
 * WHY:    Lets users find saved articles by meaning rather than exact keyword.
 *         Only rows with a stored vector participate — unembedded rows are skipped.
 * GOTCHA: Similarity scores are re-computed in JS, not in SQL. For large
 *         collections (thousands of rows) this will get slow — consider a
 *         dedicated vector DB if collection grows beyond ~5000 articles.
 *         Results with searchScore <= 20% are filtered out as noise.
 *
 * Request body:
 *   query {string} - Natural language search query (required)
 *   topN  {number} - Max results to return (default: 20)
 *
 * Returns: { items: object[], total: number, query: string }
 *   Each item includes a `searchScore` field (0–100 integer).
 */
router.post("/search", async (req, res) => {
  try {
    const { query, topN = 20 } = req.body;
    if (!query) return res.status(400).json({ error: "query required" });

    const queryVec = await getEmbedding(query, true);
    if (!queryVec) return res.status(500).json({ error: "Embedding failed — is EMBED_MODEL running?" });

    const rows = collectionDb.exec(
      `SELECT id,newsId,url,title,summary,vector,score,threshold,source,region,pubDate,savedAt,tags,thumbnail
       FROM collection WHERE vector IS NOT NULL`
    );
    if (!rows.length) return res.json({ items: [], total: 0, query });

    const cols  = rows[0].columns;
    const items = rows[0].values.map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));

    // Score each item and sort descending
    const scored = items.map(item => {
      try {
        const parsed   = JSON.parse(item.vector);
        // Handle both array and object-keyed JSON (legacy save format)
        const vecArray = Array.isArray(parsed) ? parsed : Object.values(parsed);
        const sim      = cosineSimilarity(queryVec, new Float32Array(vecArray));
        return { ...item, searchScore: Math.round(sim * 100) };
      } catch {
        return { ...item, searchScore: 0 };
      }
    });

    scored.sort((a, b) => b.searchScore - a.searchScore);
    // Filter noise: anything below 20% is likely irrelevant
    const top = scored.slice(0, topN).filter(i => i.searchScore > 20);
    res.json({ items: top, total: top.length, query });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/collection/suggest-tags
 *
 * Asks the cloud AI to suggest relevant tags for a clipping based on its
 * title, summary, source, and region.
 *
 * WHY:    Manual tagging is slow. AI suggestions with confidence scores let
 *         the user one-click-apply high-confidence tags and review lower ones.
 * GOTCHA: Requires AI_API_KEY — returns 500 immediately if not set.
 *         Parses the AI response as a JSON array — if the model returns
 *         malformed JSON, returns a 500 with the raw response for debugging.
 *         Only tags with score >= 85 are returned to the client.
 *
 * Request body:
 *   title       {string} - Article headline (required)
 *   summary     {string} - AI summary text (optional but improves quality)
 *   source      {string} - RSS feed name (optional context)
 *   region      {string} - Geographic tag (optional context)
 *   existingTags {string} - Current tags to avoid duplicating (optional)
 *
 * Returns: { suggestions: [{ tag: string, score: number }] }
 *   Sorted by score descending, max 10 items, all scores >= 85.
 */
router.post("/suggest-tags", async (req, res) => {
  const { title, summary, source, region, existingTags } = req.body;
  if (!title)      return res.status(400).json({ error: "title required" });
  if (!AI_API_KEY) return res.status(500).json({ error: "AI_API_KEY not set on server." });

  // Strip any <think> blocks from summary before sending to AI
  const summaryText = summary
    ? summary.replace(/<think>[\s\S]*?<\/think>/gi, "").slice(0, 600)
    : "";

  const threshold = getSetting("collection.suggestedTagsThreshold") ?? 80;

  const prompt =
    `You are a news article tagger. Given the article below, suggest relevant tags ` +
    `with a confidence score (0–100%).\n\n` +
    `Article title: ${title}\n` +
    `Source: ${source || ""}  Region: ${region || ""}\n` +
    `${summaryText ? "Summary: " + summaryText : ""}\n` +
    `${existingTags ? "Already tagged: " + existingTags : ""}\n\n` +
    `Return ONLY a JSON array. Each element: {"tag": "...", "score": 0-100}\n` +
    `Rules:\n` +
    `- Tags should be short (1-3 words), lowercase\n` +
    `- Cover: topics, entities, themes, regions, industries\n` +
    `- Only include tags with score >= ${threshold}\n` +
    `- Do not repeat already-existing tags\n` +
    `- Return 5-10 tags max\n` +
    `- No markdown fences, no explanation — raw JSON array only\n\n` +
    `Example: [{"tag":"us politics","score":82},{"tag":"trade war","score":71}]`;

  try {
    const rawReply = await callAI(prompt);

    let suggestions;
    try {
      // Strip any residual markdown fences the model may add despite instructions
      const match = rawReply.replace(/```json|```/g, "").trim().match(/\[[\s\S]*\]/);
      if (!match) throw new Error("No JSON array in response");
      suggestions = JSON.parse(match[0]);
      if (!Array.isArray(suggestions)) throw new Error("Not an array");
    } catch (e) {
      return res.status(500).json({
        error: "AI returned unexpected format: " + e.message,
        raw: rawReply.slice(0, 200),
      });
    }

    const filtered = suggestions
      .filter(s => typeof s.tag === "string" && s.tag.trim() && Number(s.score) >= threshold)
      .map(s => ({ tag: String(s.tag).trim().toLowerCase(), score: Number(s.score) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    console.log(
      `🏷  Suggested tags for "${title.slice(0, 50)}": ` +
      filtered.map(s => `${s.tag}(${s.score}%)`).join(", ")
    );
    res.json({ suggestions: filtered });
  } catch (err) {
    console.error("suggest-tags error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/collection/:id/tags
 *
 * Replaces the tags of a specific clipping by DB row id.
 *
 * WHY:    Allows the frontend to save tag edits without re-POSTing the
 *         entire article object. Uses PATCH semantics — only tags change.
 * GOTCHA: Passing an empty string clears all tags (sets column to NULL).
 *         The `tags` field is required in the body — omitting it returns 400
 *         to prevent accidental silent no-ops.
 *
 * URL params: id {number} - DB row id
 * Request body:
 *   tags {string} - Comma-separated tags, or "" to clear all tags
 *
 * Returns: { ok: true, id: number, tags: string|null }
 */
router.patch("/:id/tags", (req, res) => {
  try {
    const { id }   = req.params;
    const { tags } = req.body;
    if (typeof tags === "undefined") {
      return res.status(400).json({ error: "tags field required (use empty string to clear)" });
    }
    const normalised = tags.split(",").map(t => t.trim()).filter(Boolean).join(", ");
    collectionDb.run(
      "UPDATE collection SET tags=? WHERE id=?",
      [normalised || null, id]
    );
    saveCollectionDB();
    console.log(`🏷  Tags updated — id=${id} tags="${normalised}"`);
    res.json({ ok: true, id: parseInt(id), tags: normalised || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * DELETE /api/collection/:id
 *
 * Permanently removes a single clipping by DB row id.
 *
 * WHY:    Lets the user remove individual articles from their collection.
 * GOTCHA: Irreversible — no soft-delete. The summary_cache entry for this
 *         article's URL is NOT removed, so the summary remains available if
 *         the article is saved again.
 *
 * URL params: id {number} - DB row id
 * Returns: { ok: true }
 */
router.delete("/:id", (req, res) => {
  try {
    collectionDb.run("DELETE FROM collection WHERE id=?", [req.params.id]);
    saveCollectionDB();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * DELETE /api/collection
 *
 * Permanently removes ALL clippings from the collection.
 *
 * WHY:    Bulk clear for when the user wants to start fresh.
 * GOTCHA: Irreversible. Does NOT clear the summary_cache table — cached
 *         summaries are preserved since they are keyed by URL and may still
 *         be useful if articles are re-saved.
 *
 * Returns: { ok: true }
 */
router.delete("/", (req, res) => {
  try {
    collectionDb.run("DELETE FROM collection");
    saveCollectionDB();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
