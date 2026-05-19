/**
 * routes/keywords.js — AI-generated trending keyword suggestions.
 *
 * ROLE:    Analyses today's RSS headlines and uses the cloud AI to extract
 *          the most discussed topics as searchable keyword suggestions.
 *          Results are cached in the DB so the AI is only called once per
 *          region/dateFilter combination per TTL window.
 * MOUNTS AT: /api/suggested-keywords  (registered in server.js)
 * TALKS TO:  db/articlesDb.js (keyword cache), lib/rss.js, lib/ai.js
 *
 * SHARED STATE: ALL_SITES is injected by server.js via init() after the
 *               sites JSON file is loaded. Never import sites directly here.
 *
 * ROUTE SUMMARY:
 *   GET  /api/suggested-keywords          — read cached keywords
 *   POST /api/suggested-keywords/generate — regenerate via AI + RSS
 */

import { Router } from "express";
import { AI_API_KEY, SUGGESTED_KEYWORDS_TTL_MS } from "../config.js";
import { db, saveDB } from "../db/articlesDb.js";
import { fetchRSS }   from "../lib/rss.js";
import { callAI }     from "../lib/ai.js";
import { getSetting } from "../lib/settings.js";

export const router = Router();

/**
 * Module-level sites list — populated by server.js calling init().
 * WHY: Routes need the sites array but cannot import it directly from
 *      server.js (circular dep). server.js calls init() after loading the JSON.
 */
let ALL_SITES = [];

/**
 * Injects the sites list from server.js into this module.
 * Must be called before any route handler runs.
 *
 * @param {Array<{ name: string, region: string, rss: string }>} sites
 */
export function init(sites) { ALL_SITES = sites; }

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/suggested-keywords
 *
 * Returns the most recently cached AI keyword suggestions for a given
 * region and date filter combination.
 *
 * WHY:    Lets the frontend display cached keywords instantly on load without
 *         triggering an AI call. The client can check `status` to decide if
 *         it should call /generate to refresh.
 * GOTCHA: Returns { keywords: null, status: "none" } when there is no cache
 *         entry yet (first run). Does not auto-generate — caller must POST
 *         to /generate explicitly.
 *
 * Query params:
 *   region     {string} - Region name or "all" (default: "all")
 *   dateFilter {string} - Date range key (default: "today")
 *
 * Returns:
 *   { keywords: [{keyword, count}]|null, generatedAt: string|null,
 *     ageMs: number|null, status: "fresh"|"stale"|"none" }
 */
router.get("/", (req, res) => {
  try {
    const { region = "all", dateFilter = "today" } = req.query;
    const rows = db.exec(
      "SELECT keywords, generatedAt FROM suggested_keywords_cache WHERE region=? AND dateFilter=?",
      [region, dateFilter]
    );
    if (!rows.length || !rows[0].values.length) {
      return res.json({ keywords: null, generatedAt: null, status: "none" });
    }
    const [keywordsJson, generatedAt] = rows[0].values[0];
    const ageMs  = Date.now() - new Date(generatedAt).getTime();
    // "stale" means cached but older than SUGGESTED_KEYWORDS_TTL_MS — client
    // should offer a refresh button but can still display the stale keywords
    const status = ageMs > SUGGESTED_KEYWORDS_TTL_MS ? "stale" : "fresh";
    res.json({ keywords: JSON.parse(keywordsJson), generatedAt, ageMs, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/suggested-keywords/generate
 *
 * Fetches current RSS headlines, sends them to the cloud AI, and extracts
 * the top 15 most-discussed keyword phrases. Saves the result to the DB cache.
 *
 * WHY:    Gives users a one-click way to discover what news topics are trending
 *         right now in their chosen region, without needing to read headlines.
 * GOTCHA: Requires AI_API_KEY — returns 500 immediately if not configured.
 *         Date filtering is done in JS (not SQL) for timezone accuracy —
 *         same approach as routes/search.js for "today" filtering.
 *         The AI is instructed to return raw JSON only, but some models add
 *         markdown fences anyway — these are stripped before parsing.
 *         Keyword counts are computed post-AI by matching keywords against
 *         the actual titles — this verifies the AI's claims and provides
 *         a frequency signal for sorting.
 *
 * Request body:
 *   region     {string} - Region name or "all" (default: "all")
 *   dateFilter {string} - "today"|"yesterday"|"week"|"2weeks"|"month"|"ytd"|"all"
 *
 * Returns:
 *   { keywords: [{keyword: string, count: number}], generatedAt: string, status: "fresh" }
 */
router.post("/generate", async (req, res) => {
  const { region = "all", dateFilter = "today" } = req.body;

  if (!AI_API_KEY) return res.status(500).json({ error: "AI_API_KEY not set on server." });

  try {
    const targetSites = (region && region !== "all")
      ? ALL_SITES.filter(s => s.region === region)
      : ALL_SITES;

    if (!targetSites.length) {
      return res.status(400).json({ error: "No sites found for region: " + region });
    }

    console.log(`🔑 Generating keywords: region="${region}" dateFilter="${dateFilter}"`);
    const allTitles = [];

    // Fetch all target feeds concurrently — uses cached RSS where available
    await Promise.all(targetSites.map(async site => {
      try {
        let articles = await fetchRSS(site);

        // JS-side date filter — timezone-aware for "today" and "yesterday"
        if (dateFilter && dateFilter !== "all") {
          const now        = new Date();
          const tzOffsetMs = now.getTimezoneOffset() * -60000;
          const localToday = now.getFullYear() + "-" +
            String(now.getMonth() + 1).padStart(2, "0") + "-" +
            String(now.getDate()).padStart(2, "0");

          articles = articles.filter(a => {
            if (!a.pubDate) return false;
            const d = new Date(a.pubDate);
            if (isNaN(d)) return false;
            const diffDays = (now - d) / 86400000;

            if (dateFilter === "today") {
              const localD   = new Date(d.getTime() + tzOffsetMs);
              const artLocal = localD.getUTCFullYear() + "-" +
                String(localD.getUTCMonth() + 1).padStart(2, "0") + "-" +
                String(localD.getUTCDate()).padStart(2, "0");
              return artLocal === localToday;
            }
            if (dateFilter === "yesterday") {
              const yest   = new Date(now);
              yest.setDate(yest.getDate() - 1);
              const yLabel = yest.getFullYear() + "-" +
                String(yest.getMonth() + 1).padStart(2, "0") + "-" +
                String(yest.getDate()).padStart(2, "0");
              const localD   = new Date(d.getTime() + tzOffsetMs);
              const artLocal = localD.getUTCFullYear() + "-" +
                String(localD.getUTCMonth() + 1).padStart(2, "0") + "-" +
                String(localD.getUTCDate()).padStart(2, "0");
              return artLocal === yLabel;
            }
            if (dateFilter === "week")   return diffDays <= 7;
            if (dateFilter === "2weeks") return diffDays <= 14;
            if (dateFilter === "month")  return diffDays <= 30;
            if (dateFilter === "ytd")    return d.getFullYear() === now.getFullYear();
            return true;
          });
        }

        articles.forEach(a => { if (a.title) allTitles.push(a.title); });
      } catch (e) {
        console.warn(`  ⚠ Keywords: ${site.name}: ${e.message}`);
      }
    }));

    if (!allTitles.length) {
      return res.status(404).json({
        error: "No articles found for this region/date combination.",
      });
    }

    // Read live from settings so the UI slider takes effect immediately
    const maxKeywords = getSetting("keywords.maxSuggested");

    // Deduplicate and cap at 300 titles to keep AI prompt size manageable
    const uniqueTitles = [...new Set(allTitles)].slice(0, 300);
    console.log(`  📰 Sending ${uniqueTitles.length} unique titles to AI`);

    const prompt =
      `You are a news analyst. Below are ${uniqueTitles.length} news article headlines from ` +
      `${region !== "all" ? region : "multiple regions"} for: ${dateFilter}.\n\n` +
      `Extract the TOP ${maxKeywords} most frequently discussed keywords or short phrases (1-4 words).\n` +
      `Focus on: people, organisations, countries, policy topics, economic themes, events.\n` +
      `Include both English and Chinese terms if present in the headlines.\n\n` +
      `Headlines:\n${uniqueTitles.join("\n")}\n\n` +
      `Reply with ONLY a JSON array of exactly ${maxKeywords} keyword strings.\n` +
      `No explanation, no markdown fences. Example:\n` +
      `["keyword1","keyword2","keyword3"]`;

    const rawReply = await callAI(prompt);

    // Parse AI response — strip markdown fences models add despite instructions
    let keywords;
    try {
      const clean = rawReply.replace(/```json|```/g, "").trim();
      const match = clean.match(/\[[\s\S]*\]/);
      if (!match) throw new Error("No JSON array found in response");
      keywords = JSON.parse(match[0]);
      if (!Array.isArray(keywords)) throw new Error("Not an array");
      keywords = keywords.slice(0, maxKeywords).map(k => String(k).trim()).filter(Boolean);
    } catch (e) {
      console.warn("  ⚠ Keywords parse failed:", e.message, "| raw:", rawReply.slice(0, 200));
      return res.status(500).json({ error: "AI returned invalid keyword format: " + e.message });
    }

    // Verify AI keywords against actual titles and compute real occurrence counts
    // WHY: The AI may hallucinate keywords not actually present — counting confirms them
    const titlesLower = allTitles.map(t => t.toLowerCase());
    const keywordsWithCount = keywords
      .map(kw => ({
        keyword: kw,
        count: titlesLower.filter(t => t.includes(kw.toLowerCase())).length,
      }))
      .filter(k => k.count > 0)           // drop AI hallucinations — keyword must appear in at least 1 title
      .sort((a, b) => b.count - a.count); // highest frequency first

    console.log(
      `  📊 Keyword counts: ${keywordsWithCount.map(k => `${k.keyword}×${k.count}`).join(", ")}`
    );

    // Persist to DB cache — INSERT OR REPLACE so same region+dateFilter overwrites old row
    const generatedAt = new Date().toISOString();
    db.run(
      `INSERT OR REPLACE INTO suggested_keywords_cache
         (region, dateFilter, keywords, generatedAt)
       VALUES (?, ?, ?, ?)`,
      [region, dateFilter, JSON.stringify(keywordsWithCount), generatedAt]
    );
    saveDB();

    console.log(`  ✅ Keywords saved: [${keywordsWithCount.map(k => k.keyword).join(", ")}]`);
    res.json({ keywords: keywordsWithCount, generatedAt, status: "fresh" });
  } catch (err) {
    console.error("Keywords generate error:", err.message);
    res.status(500).json({ error: err.message });
  }
});
