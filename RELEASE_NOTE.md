
## newsLookup Release Note
#### Date format: yyyy/MM/dd (Hong Kong Locale date/time)
#### Version: Major.{Minor/Enhancement}.{Bug fix}
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