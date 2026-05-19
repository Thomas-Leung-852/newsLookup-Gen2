
## newsLookup Release Note
#### Date format: yyyy/MM/dd (Hong Kong Locale date/time)
#### Version: Major.{Minor/Enhancement}.{Bug fix}
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