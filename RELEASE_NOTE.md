
## newsLookup Release Note
#### Date format: yyyy/MM/dd (Hong Kong Locale date/time)
#### Version: Major.{Minor/Enhancement}.{Bug fix}
---

Release Date: 2026/06/18
Version: 1.4.0

This release adds per-site enable/disable control for RSS sources. Each entry
in rss-sites.json (and the master rss-sites_json.template used at setup time)
now carries an enabled flag. When a site is disabled, the app skips it entirely
— no RSS fetch, no in-memory cache entry, no entry in the main search page's
site checklist.

Filtering happens at the route layer rather than inside lib/rss.js, keeping
fetchRSS() source-agnostic per the existing dependency rules. Both
routes/search.js (the main search endpoint) and routes/keywords.js (trending
keyword generation) build their targetSites list by filtering out
enabled:false entries before calling fetchRSS() or fetchRSS()-derived headline
collection. Sites missing the enabled field entirely are treated as enabled,
so existing installs upgrading from 1.4.0 are unaffected until the migration
script (or a manual edit) adds the field.

On the main search page, public/js/index.js filters allSites to enabled-only
immediately after fetching /api/sites, inside loadSites(). Because every other
function on that page — renderSiteList(), filterByRegion(), the region
dropdown, drag-to-select, and all four quick-scan previews (Today / Yesterday
/ Week / All Time) — reads from allSites, disabled sites disappear from the
entire page with this single change, and can never be included in the `sites`
array sent to POST /api/search.

The RSS Site Editor (editor.html / editor.js / editor.css) gained the controls
to manage this flag: a toggle switch on each row in the site list saves
immediately on click (no need to open the edit form), and the edit form itself
has a matching Enabled toggle that's included when a site is saved or created.
A new status filter dropdown (Enabled / Disabled / Any) sits next to the
existing region filter and search box, defaulting to Enabled so newly disabled
sites don't clutter the default view. The duplicate-feed finder modal also now
shows each duplicate's enabled/disabled status, since a duplicate pair where
one copy is disabled is a different cleanup decision than two active
duplicates.

1. Added - `enabled` field (boolean, default true) on every site in `rss-sites.json` and `rss-sites_json.template`
2. Added - `routes/search.js` filters `targetSites` to `enabled !== false` before any `fetchRSS()` call
3. Added - `routes/keywords.js` applies the same filter before collecting headlines for AI keyword generation
4. Added - `public/js/index.js` `loadSites()` filters `allSites` to enabled-only, removing disabled sites from the checklist, region filter, drag-select, and all quick-scan previews
5. Added - Toggle switch per site row in the RSS Site Editor — saves instantly via `PUT /api/sites`
6. Added - Enabled toggle in the Site Editor's edit/new-site form
7. Added - Status filter (Enabled / Disabled / Any) in the RSS Site Editor, default Enabled
8. Added - Enabled/Disabled status badge shown per entry in the duplicate-feed finder modal
9. Changed - New sites created in the editor default to `enabled: true`

This release adds article thumbnail images throughout the app — in search
results, preview modals, and My Clippings — with a configurable size setting
and a per-session show/hide toggle.

Thumbnails are extracted directly from RSS feed data using a 5-pattern priority
chain: media:thumbnail → media:content → enclosure → plain image URL (e.g. CBS
News) → first img tag found inside the description HTML (e.g. Google News). A
bug was fixed in the XML parser configuration where ignoreAttributes defaulted
to true, silently discarding all XML element attributes including the url field
on media:thumbnail and enclosure tags — this affected every feed using those
conventions. The parser is now correctly configured with ignoreAttributes:false
and attributeNamePrefix @_ throughout both lib/rss.js and routes/search.js.

For feeds with multiple thumbnail candidates (e.g. ABC News which supplies
several media:thumbnail tags at different resolutions), only the first match is
used. The extractThumbnail() function is exported so both the live RSS pipeline
and the test-rss endpoint in routes/search.js share the same logic.

A new ui settings domain was introduced with a thumbnailSize key of type
select — the first select-type control in the settings system. This required
adding select support to lib/settings.js (validation against options array),
js/settings.js buildControl() (dropdown rendering), and app-settings.json/
app-settings.default.json (new ui domain with _meta). Thumbnail size is driven
by a CSS custom property (--thumb-size) set via a body-level class, so a single
Settings change propagates consistently across the main search page and My
Clippings without per-component logic.

The collection database was migrated to add a thumbnail column with an
ALTER TABLE guard that is safe to run against existing databases. Both clip
paths (the ✂️ row button and the Add to Clippings button in the AI summary
modal) were updated to pass thumbnail through to the API.

1. Added - `extractThumbnail()` in `lib/rss.js` — 5-pattern RSS image extraction supporting media:thumbnail, media:content, enclosure, plain image URL, and img-in-description fallback
2. Fixed - XML parser missing `ignoreAttributes:false` — feed attributes (url, type, medium) were silently discarded across all sources
3. Added - Thumbnails rendered in search results table (desktop + mobile cards)
4. Added - Thumbnails rendered in all four preview modals (Today / Yesterday / Week / All Time)
5. Added - Thumbnails rendered in My Clippings cards
6. Added - Session-based thumbnail show/hide toggle button on main search page
7. Added - `ui.thumbnailSize` setting (Small 48px / Medium 80px / Large 120px / Extra Large 160px) in Settings UI — default Medium
8. Added - `select` control type to settings schema system (`lib/settings.js` validation + `js/settings.js` dropdown renderer)
9. Added - New `ui` domain in `app-settings.json` and `app-settings.default.json`
10. Added - `thumbnail` column to `collection` DB table with auto-migration for existing databases
11. Fixed - `addToCollection()` (summary modal clip path) was not passing thumbnail to the collection API
12. Fixed - Per-feed article cap was hardcoded at 50, silently truncating high-volume feeds (e.g. HK01) regardless of date filter — now a configurable `rss.maxArticlesPerFeed` setting (default 200)
13. Added - Feed-truncation notice: live SSE message during search + a second line in the News Preview footer, so users know when a feed was capped and where to raise it

---

Release Date: 2026/05/29
Version: 1.3.0

This release focuses on deployment quality and operational reliability — making
newsLookup Gen2 easier to install, configure, and maintain across Windows and
Linux environments.

A two-script setup system (setup-windows.ps1 / setup-linux.sh) and matching
uninstall scripts were added to guide users through environment checks, model
pulls, port configuration, and .env generation. The scripts perform version
checks for Node.js (≥ 22.0.0), npm (≥ 8.0.0) and Ollama (≥ 0.24.0) without
touching the user's system if requirements are not met.

dotenv integration was added to config.js so .env is correctly loaded on
startup — previously environment variables were only read from the system
environment, causing .env to be silently ignored on Windows.

The settings system was upgraded to a two-file merge pattern:
app-settings.default.json (tracked in Git) holds the canonical schema and
defaults; app-settings.json (ignored by Git) holds the user's live values.
On every startup, user values are merged on top of defaults — new keys added
in future releases are picked up automatically without overwriting user changes.

1. Added - Setup script for Windows (setup-windows.ps1)
2. Added - Setup script for Linux (setup-linux.sh)
3. Added - Uninstall script for Windows (uninstall-windows.ps1)
4. Added - Uninstall script for Linux (uninstall-linux.sh)
5. Fixed - dotenv not loaded in config.js — .env was silently ignored on Windows
6. Added - app-settings.default.json as canonical defaults tracked in Git
7. Changed - lib/settings.js now merges default + user settings files on startup
8. Updated - README restructured with setup guide, uninstall section, and accurate project structure
9. Updated - .gitignore updated to exclude user-specific runtime files
10. Changed - Default local reasoning model in setup scripts changed from `gpt-oss:20b` to `qwen2.5:7b`
11. Added - `keywords.maxTitlesForAI` setting — configurable via Settings UI, range 50–400 (step 50), default 350
12. Changed - Mobile UI: welcome card hidden on screens ≤768px width
13. Changed - Mobile UI: "Suggested Keywords:" label hidden on screens ≤768px width

---

Release Date: 2026/05/19
Version: 1.2.0

This release completes the core clipping workflow — tags, keyword suggestions,
and export integrity — bringing newsLookup Gen2 to a stable, self-contained state
beyond its initial MVP. All primary user journeys (search → clip → tag → export)
now work end-to-end without known gaps.

The codebase was also refactored from a monolithic single file into a modular
project structure — routes, database, lib, and config each in their own focused
files. For vibe coding, this is a significant workflow improvement: smaller,
hyper-focused files mean the AI only loads what's relevant to the task at hand,
rather than wasting context window tokens on unrelated code. A PROJECT_MAP.md
was created alongside to document file responsibilities and dependency rules,
making it fast to bootstrap a fresh AI session without losing context.

1. Added - Suggested keywords are automatically generated from news titles.
2. Added - News clipping now supports tags for grouping and search.
3. Fixed - News clipping search now works correctly for published date ranges.
4. Fixed - Missing tags field when exporting news clipping records.

---
Release Date: 2026/05/09    
Version: 1.1.0

1. My Clippings - Added import/export function
2. The App added responsive UI
3. New API - find out no vector articles for re-embedding

---
Release Date: 2026/05/06    	  
Version: 1.0.0        

Initial Release