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
  ignoreAttributes:       false,
  attributeNamePrefix:    "@_",
};

/**
 * Extracts a thumbnail image URL from a single RSS/Atom <item> using a
 * priority list of common feed conventions.
 *
 * WHY:    Different sources encode item images differently — there is no
 *         single standard tag. This checks the most common patterns in
 *         order of reliability/quality and returns the first match.
 * GOTCHA: fast-xml-parser represents attributes with a "@_" prefix by
 *         default, but XML_PARSER_OPTIONS has parseAttributeValue:false —
 *         attribute VALUES stay as strings, attribute KEYS still use "@_".
 *         media:thumbnail/media:content/enclosure become "media:thumbnail"
 *         etc. as object keys (colons are preserved as-is by fast-xml-parser).
 *         When multiple <enclosure>/<media:content> tags exist (HK01 feeds
 *         can have many), only the FIRST is used.
 *
 * Priority order:
 *   1. <media:thumbnail url="...">
 *   2. <media:content url="..." medium="image"> (or type="image/...")
 *   3. <enclosure url="..." type="image/...">
 *   4. <image>https://...</image> (plain URL text content — e.g. CBS News)
 *   5. First <img src="..."> found inside <description> / <content:encoded>
 *
 * @param {object} item - Single parsed RSS/Atom item
 * @returns {string|null} Thumbnail image URL, or null if none found
 */
export function extractThumbnail(item) {
  if (!item) return null;

  // Helper: pick the first element if the field is an array (multiple tags)
  const first = val => Array.isArray(val) ? val[0] : val;

  // 1. media:thumbnail
  const mediaThumb = first(item["media:thumbnail"]);
  if (mediaThumb) {
    const url = mediaThumb["@_url"] || mediaThumb.url || (typeof mediaThumb === "string" ? mediaThumb : null);
    if (url) return url;
  }

  // 2. media:content (medium="image" or type starts with image/)
  const mediaContentRaw = item["media:content"];
  const mediaContents   = Array.isArray(mediaContentRaw) ? mediaContentRaw : (mediaContentRaw ? [mediaContentRaw] : []);
  for (const mc of mediaContents) {
    if (!mc) continue;
    const medium = mc["@_medium"] || "";
    const type   = mc["@_type"]   || "";
    const url    = mc["@_url"]    || mc.url;
    if (url && (medium === "image" || type.startsWith("image/") || (!medium && !type))) {
      return url;
    }
  }

  // 3. enclosure (type="image/...")
  const enclosureRaw = item.enclosure;
  const enclosures   = Array.isArray(enclosureRaw) ? enclosureRaw : (enclosureRaw ? [enclosureRaw] : []);
  for (const enc of enclosures) {
    if (!enc) continue;
    const type = enc["@_type"] || "";
    const url  = enc["@_url"]  || enc.url;
    if (url && (type.startsWith("image/") || !type)) {
      return url;
    }
  }

  // 4. <image>URL</image> as plain text content (e.g. CBS News)
  const imageField = first(item.image);
  if (imageField) {
    if (typeof imageField === "string" && /^https?:\/\//.test(imageField.trim())) {
      return imageField.trim();
    }
    if (imageField["#text"] && /^https?:\/\//.test(String(imageField["#text"]).trim())) {
      return String(imageField["#text"]).trim();
    }
    // channel-level <image><url>...</url></image> form — only honour if it
    // looks like a per-item structure (has a url child)
    if (imageField.url && /^https?:\/\//.test(String(imageField.url).trim())) {
      return String(imageField.url).trim();
    }
  }

  // 5. First <img src="..."> inside description / content:encoded HTML
  const html = item["content:encoded"] || item.description || "";
  const text = typeof html === "string" ? html : (html["#text"] || "");
  const match = text.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (match) return match[1];

  return null;
}

/**
 * Fetches and parses a single RSS/Atom feed directly from the network.
 *
 * WHY:    Separated from fetchRSS() so the cache layer and network layer
 *         are independently testable and replaceable.
 * GOTCHA: Handles both RSS 2.0 (channel.item) and Atom (feed.entry) formats.
 *         Atom link elements can be objects ({ href }) or plain strings —
 *         both are handled. Throws on non-2xx HTTP status so fetchRSS()
 *         can catch and fall back to stale cache.
 * RETURNS: Array of up to `rss.maxArticlesPerFeed` normalised article objects.
 *          The array also carries a non-enumerable-in-JSON `totalAvailable`
 *          property (total `<item>` count in the raw feed) so callers can
 *          detect and surface truncation to the user.
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

  const maxArticles = getSetting("rss.maxArticlesPerFeed") || 50;

  const articles = list.slice(0, maxArticles).map(item => ({
    title:     item.title?.["#text"] || item.title   || "",
    link:      item.link?.["@_href"] || item.link?.href || item.link || item.guid || "",
    summary:   item.description      || item.summary?.["#text"] || item.summary || "",
    pubDate:   item.pubDate          || item.updated?.["#text"] || item.updated || "",
    thumbnail: extractThumbnail(item),
    source:    site.name,
    region:    site.region,
  }));

  // Attached (not a real array index) so JSON.stringify(articles) and
  // .map/.filter callers are unaffected — only callers that explicitly
  // check articles.totalAvailable will see it.
  articles.totalAvailable = list.length;

  return articles;
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
