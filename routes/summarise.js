/**
 * routes/summarise.js — AI article summarisation with 3-level fallback.
 *
 * ROLE:    Fetches and summarises a news article using the cloud AI model.
 *          Implements a graceful degradation strategy so even paywalled or
 *          fetch-blocked articles get a useful summary.
 * MOUNTS AT: /api/summarise  (registered in server.js)
 * TALKS TO:  lib/ai.js (callAI, stripHtml), db/collectionDb.js (summary cache)
 *
 * FALLBACK LEVELS (attempted in order, stops at first success):
 *   Level 1 — full_article:    Fetch the article page, strip HTML, summarise
 *   Level 2 — rss_description: Use the RSS <description> field if available
 *   Level 3 — title_only:      Summarise from the headline alone
 *
 * GOTCHA:  Level 1 will fail on paywalled sites, JS-rendered pages, and sites
 *          that block non-browser user agents. The fallback chain ensures the
 *          user always gets something useful even in these cases.
 */

import { Router } from "express";
import fetch       from "node-fetch";
import { AI_MODEL } from "../config.js";
import { getCachedSummary, cacheSummary } from "../db/collectionDb.js";
import { callAI, stripHtml } from "../lib/ai.js";

export const router = Router();

/**
 * POST /api/summarise
 *
 * Generates a 3-bullet-point AI summary for a given article URL.
 * Checks the summary_cache first — if a cached entry exists, returns it
 * immediately without any network or AI calls.
 *
 * WHY:    Summaries are expensive (cloud AI call + optional page fetch).
 *         Caching by URL means repeated views of the same article are free.
 * GOTCHA: The summary language matches the article's language automatically
 *         (English, 繁體中文, or Cantonese) — this is instructed in the prompt.
 *         The `level` field in the response tells the client which fallback
 *         tier was used, so it can display a "based on headline only" notice
 *         when level is "title_only".
 *
 * Request body:
 *   title          {string} - Article headline (required)
 *   link           {string} - Canonical article URL (required, used as cache key)
 *   rssDescription {string} - Raw RSS description HTML (optional, used in Level 2)
 *
 * Returns:
 *   { summary: string, level: string, model: string, cached: boolean }
 */
router.post("/", async (req, res) => {
  const { title, link, rssDescription = "" } = req.body;
  if (!title || !link) return res.status(400).json({ error: "title and link required" });

  // Cache check — avoids any network or AI call for previously summarised articles
  const cached = getCachedSummary(link);
  if (cached) {
    console.log(`📋 Summary cache hit: ${title.slice(0, 50)}`);
    return res.json({ ...cached });
  }

  let summary = null;
  let level   = null;

  // ── Level 1: Fetch and summarise the full article page ────────────────────
  // Most likely to produce the best summary but most likely to fail (paywalls,
  // bot detection, JS-rendered pages)
  try {
    const pageRes = await fetch(link, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; newsLookup/2.0)" },
    });
    if (pageRes.ok) {
      // Slice to 3000 chars to stay within a reasonable AI context budget
      const text = stripHtml(await pageRes.text()).slice(0, 3000);
      if (text.length > 200) { // skip pages that returned mostly empty content
        console.log(`📄 Level 1 (full page): ${title.slice(0, 50)}`);
        summary = await callAI(
          `You are a multilingual news summariser. Summarise in 3 bullet points.\n` +
          `Reply in the same language as the content (English, 繁體中文, or Cantonese).\n` +
          `Be concise — one sentence per bullet.\n\n` +
          `Title: ${title}\nContent: ${text}\n\nReply with ONLY 3 bullet points:`
        );
        level = "full_article";
      }
    }
  } catch (e) {
    console.log(`⚠️  Level 1 failed (${e.message.slice(0, 50)}) — trying Level 2`);
  }

  // ── Level 2: Summarise from the RSS <description> field ──────────────────
  // RSS descriptions are often partial article text or editorial blurbs —
  // better than nothing but less accurate than the full article
  if (!summary && rssDescription && rssDescription.trim().length > 50) {
    try {
      const cleanDesc = stripHtml(rssDescription).slice(0, 1000);
      console.log(`📰 Level 2 (RSS description): ${title.slice(0, 50)}`);
      summary = await callAI(
        `You are a multilingual news summariser. Based on this RSS description, ` +
        `summarise in 3 bullet points.\n` +
        `Reply in the same language (English, 繁體中文, or Cantonese).\n\n` +
        `Title: ${title}\nRSS Description: ${cleanDesc}\n\nReply with ONLY 3 bullet points:`
      );
      level = "rss_description";
    } catch (_) {
      console.log(`⚠️  Level 2 failed — trying Level 3`);
    }
  }

  // ── Level 3: Infer from headline only ────────────────────────────────────
  // Always available as a last resort. Quality varies — the AI is essentially
  // guessing based on the title alone. The prompt explicitly notes this limitation
  // so the model hedges appropriately rather than fabricating specific facts.
  if (!summary) {
    try {
      console.log(`📝 Level 3 (title only): ${title.slice(0, 50)}`);
      summary = await callAI(
        `You are a multilingual news analyst. Based on this headline only, explain ` +
        `what this article is likely about in 3 bullet points.\n` +
        `Reply in the same language as the headline (English, 繁體中文, or Cantonese).\n` +
        `Note: This is based on the headline only, not the full article.\n\n` +
        `Headline: ${title}\n\nReply with ONLY 3 bullet points:`
      );
      level = "title_only";
    } catch (e) {
      // All three levels failed — this is unrecoverable
      return res.status(500).json({ error: "All summarisation levels failed: " + e.message });
    }
  }

  // Persist to cache so repeat requests for this URL are free
  cacheSummary(link, title, summary, level, AI_MODEL);
  console.log(`✅ Summary cached (level: ${level})`);
  res.json({ summary, level, model: AI_MODEL, cached: false });
});
