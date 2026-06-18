# ROADMAP.md — newsLookup Gen2
> Tracks planned features and completed milestones.
> Update this file when a task is started, completed, or reprioritised.

---

## 🔖 Completed

| Version | Task |
|---|---|
| 1.0.0 | Initial release — RAG + embedding, Express UI, SQLite, My Clippings, RSS Editor |
| 1.1.0 | Import/export for My Clippings |
| 1.1.0 | Responsive UI |
| 1.1.0 | Re-embedding API for clippings without vectors |
| 1.2.0 | AI-suggested trending keywords from today's headlines |
| 1.2.0 | Tags for clippings — AI auto-suggest + manual edit |
| 1.2.0 | Fixed date range filtering in clippings search |
| 1.2.0 | Fixed missing tags field in clipping export |
| 1.2.0 | Refactored monolithic server into modular routes / lib / db structure |
| 1.2.0 | Created PROJECT_MAP.md for AI session bootstrapping |
| 1.3.0 | Setup script for Windows (`setup-windows.ps1`) |
| 1.3.0 | Setup script for Linux (`setup-linux.sh`) |
| 1.3.0 | Uninstall script for Windows (`uninstall-windows.ps1`) |
| 1.3.0 | Uninstall script for Linux (`uninstall-linux.sh`) |
| 1.3.0 | Fixed `dotenv` not loaded in `config.js` — `.env` silently ignored on Windows |
| 1.3.0 | Two-file settings merge — `app-settings.default.json` (Git) + `app-settings.json` (user) |
| 1.3.0 | README restructured with setup guide, uninstall section, accurate project structure |
| 1.3.0 | `.gitignore` updated to exclude user-specific runtime files |
| 1.3.0 | Replaced default local reasoning model from `gpt-oss:20b` to `qwen2.5:7b` in setup scripts |
| 1.3.0 | Configurable `keywords.maxTitlesForAI` setting — adjustable per model via Settings UI |
| 1.3.0 | Mobile UI: welcome card hidden on small screens |
| 1.3.0 | Mobile UI: keyword label hidden on small screens |
| 1.4.0 | Article thumbnails extracted from RSS feeds — multi-pattern support (media:thumbnail, media:content, enclosure, plain image URL, img-in-description) |
| 1.4.0 | Fixed XML parser config — `ignoreAttributes:false` added so feed attributes (url, type, medium) are correctly parsed across all sources |
| 1.4.0 | Thumbnails shown in search results table (desktop + mobile), all four preview modals (Today / Yesterday / Week / All Time), and My Clippings cards |
| 1.4.0 | Session-based thumbnail show/hide toggle button on main search page |
| 1.4.0 | Configurable thumbnail size (Small / Medium / Large / Extra Large) in Settings — new `ui` domain with `select` type; CSS variable drives size consistently across all pages |
| 1.4.0 | `select` control type added to settings schema system (`lib/settings.js` + `js/settings.js`) |
| 1.4.0 | `thumbnail` field persisted to `collection` DB table — auto-migration for existing databases |
| 1.4.0 | Both clip paths (`clipArticle()` + `addToCollection()`) pass thumbnail to the collection API |
| 1.4.0 | RSS site enable/disable toggle — per-site `enabled` flag in `rss-sites.json` / `rss-sites_json.template` |
| 1.4.0 | Disabled sites excluded from RSS fetch/cache in `/api/search` and `/api/suggested-keywords/generate` |
| 1.4.0 | Disabled sites excluded from the main search page site checklist, region filter, and previews |
| 1.4.0 | RSS Site Editor: toggle switch per site row (instant save) + Enabled field in edit form |
| 1.4.0 | RSS Site Editor: status filter (Enabled / Disabled / Any, default Enabled) alongside region filter |
| 1.4.0 | About layer on main page — toolbar button opens a modal with app description, version (sourced from `APP_VERSION` constant), developer credit, "100% Vibe Coded" badge, and GitHub/portfolio links (open in new tab) |
| 1.4.0 | Fixed RSS per-feed article cap hardcoded at 50 — now a configurable `rss.maxArticlesPerFeed` setting (default 200), fixing high-volume feeds (e.g. HK01) appearing truncated under Week/All Time |
| 1.4.0 | Added feed-truncation notice — SSE progress message during search + second line in the News Preview footer, so users see when a feed hit the cap and where to raise it |

---

## 🗺️ Planned

| Priority | Task |
|---|---|
| High | Scheduled auto-scan with daily digest |
| High | Duplicate / same-story detection across sites |
| Medium | Sentiment analysis per result |
| Medium | Telegram / WhatsApp digest bot |
| Low | History browser UI |

---

## 💡 Ideas (not yet scheduled)

- Multi-user support with per-user clippings
- Browser extension for one-click clipping
- Dark / light theme toggle
- Mobile app wrapper

---

> See `PROJECT_MAP.md` for architecture, file responsibilities and dependency rules.  
> See `RELEASE_NOTE.md` for detailed per-version changelogs.
