/**
 * lib/rss.js — RSS feed fetching with in-process TTL cache.
 *
 * ROLE:    Fetches and normalises RSS/Atom articles from external news sites.
 *          Caches results in memory so repeated searches within the TTL window
 *          don't re-fetch the same feed over the network.
 * TALKS TO: External RSS URLs (via node-fetch), lib/embedding.js (shared caches)
 * DO NOT:  Import from routes/* or db/* — this layer has no HTTP or DB knowledge.
 *
 * GOTCHA:  rssCache and articleVectorCache are imported FROM lib/embedding.js
 *          (not defined here) to avoid a circular dependency. Both live as
 *          module-level singletons in embedding.js.
 */

import fetch       from "node-fetch";
import { XMLParser } from "fast-xml-parser";
import { getSetting } from "./settings.js";
import { rssCache, articleVectorCache } from "./embedding.js";

/**
 * XML parser options shared across all feed parses.
 * WHY: entityExpansionLimit prevents XML bomb attacks from malicious feeds.
 *      htmlEntities ensures HTML-encoded characters in titles render correctly.
 */
const XML_PARSER_OPTIONS = {
  processEntities:        true,
  htmlEntities:           true,
  allowBooleanAttributes: true,
  parseAttributeValue:    false,
  entityExpansionLimit:   10000,
};

/**
 * Fetches and parses a single RSS/Atom feed directly from the network.
 *
 * WHY:    Separated from fetchRSS() so the cache layer and network layer
 *         are independently testable and replaceable.
 * GOTCHA: Handles both RSS 2.0 (channel.item) and Atom (feed.entry) formats.
 *         Atom link elements can be objects ({ href }) or plain strings —
 *         both are handled. Throws on non-2xx HTTP status so fetchRSS()
 *         can catch and fall back to stale cache.
 * RETURNS: Array of up to 50 normalised article objects.
 *
 * @param {{ name: string, region: string, rss: string }} site
 * @returns {Promise<Array<{ title, link, summary, pubDate, source, region }>>}
 */
export async function fetchRSSFromNet(site) {
  const res = await fetch(site.rss, {
    timeout: 8000,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; newsLookup/2.0)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const xml     = await res.text();
  const parsed  = new XMLParser(XML_PARSER_OPTIONS).parse(xml);
  const channel = parsed?.rss?.channel || parsed?.feed;
  const items   = channel?.item || channel?.entry || [];

  // Normalise single item to array (some feeds return object not array for 1 item)
  const list = Array.isArray(items) ? items : [items];

  return list.slice(0, 50).map(item => ({
    title:   item.title?.["#text"] || item.title   || "",
    link:    item.link?.href       || item.link    || item.guid || "",
    summary: item.description      || item.summary?.["#text"] || item.summary || "",
    pubDate: item.pubDate          || item.updated?.["#text"] || item.updated || "",
    source:  site.name,
    region:  site.region,
  }));
}

/**
 * Returns articles for a site, using the in-memory cache when fresh.
 *
 * WHY:    Prevents hammering news sites with repeated fetches during a
 *         multi-keyword search session. TTL is read live from
 *         getSetting('rss.cacheTtlMinutes') so the settings UI takes effect
 *         immediately without a restart.
 * GOTCHA: On network failure, returns stale cached articles if available,
 *         or an empty array if there is no prior cache — never throws.
 *         forceRefresh=true bypasses the TTL check but still catches errors.
 *         New articles (titles not yet in articleVectorCache) are counted
 *         and logged to help monitor embedding workload.
 *
 * @param {{ name: string, region: string, rss: string }} site
 * @param {boolean} [forceRefresh=false] - Bypass TTL and always refetch
 * @returns {Promise<Array<{ title, link, summary, pubDate, source, region }>>}
 */
export async function fetchRSS(site, forceRefresh = false) {
  const cached  = rssCache.get(site.rss);
  const now     = Date.now();
  const ttlMs   = getSetting("rss.cacheTtlMinutes") * 60 * 1000;
  const isStale = !cached || (now - cached.fetchedAt) > ttlMs;

  // Return cached data if still within TTL and not forced
  if (!forceRefresh && !isStale) {
    return cached.articles;
  }

  try {
    const freshArticles = await fetchRSSFromNet(site);

    // Count how many titles are genuinely new (not yet embedded)
    const newArticles = freshArticles.filter(
      a => a.title && !articleVectorCache.has(a.title)
    );

    if (newArticles.length > 0) {
      console.log(
        `  📥 ${site.name}: ${freshArticles.length} articles ` +
        `(${newArticles.length} new, ${freshArticles.length - newArticles.length} cached)`
      );
    } else {
      console.log(`  ✅ ${site.name}: ${freshArticles.length} articles (all cached)`);
    }

    rssCache.set(site.rss, { articles: freshArticles, fetchedAt: now });
    return freshArticles;
  } catch (err) {
    console.warn(`  ⚠ ${site.name}: ${err.message}`);
    // Degrade gracefully — return stale data rather than breaking the search
    return cached ? cached.articles : [];
  }
}
