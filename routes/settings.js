/**
 * routes/settings.js — RESTful API for managing application configuration.
 *
 * ROLE:    Exposes lib/settings.js over HTTP so the frontend (and any API
 *          client) can read and write runtime settings without touching the
 *          server filesystem directly.
 *
 * MOUNTS AT: /api/settings  (registered in server.js)
 *
 * ROUTE SUMMARY:
 *   GET    /api/settings              — full settings object (no _meta)
 *   GET    /api/settings/schema       — flattened schema with types, ranges, labels
 *   GET    /api/settings/:domain      — one domain object (e.g. "collection")
 *   PATCH  /api/settings/:domain      — update one or more keys in a domain
 *   POST   /api/settings/reset        — restore all settings to hardcoded defaults
 *
 * DESIGN NOTES:
 *   - PATCH is used for updates (never PUT) — partial writes only, no
 *     clobbering of keys the client didn't mention.
 *   - "schema" and "reset" are reserved words; the :domain wildcard route
 *     must be declared AFTER them so Express matches the literals first.
 *   - Validation lives in lib/settings.js (setSetting throws on bad values).
 *     This router is intentionally thin — it just translates HTTP ↔ settings.
 *
 * DEPENDENCY ORDER:
 *   routes/settings.js → lib/settings.js only.
 *   No db/* imports — settings are file-backed, not SQLite.
 */

import { Router } from "express";
import {
  getAllSettings,
  getSchema,
  getSetting,
  setSetting,
  resetToDefaults,
} from "../lib/settings.js";

export const router = Router();

// ── GET /api/settings ────────────────────────────────────────────────────────
/**
 * Returns the complete settings object with _meta stripped.
 * Safe to render directly in the frontend.
 *
 * Response: full settings object
 * e.g. { version:1, updatedAt:"...", collection:{suggestedTagsThreshold:80}, ... }
 */
router.get("/", (req, res) => {
  try {
    res.json(getAllSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/settings/schema ─────────────────────────────────────────────────
/**
 * Returns the flattened schema array used by the frontend to render the
 * settings UI dynamically. Each item includes type, min/max, label,
 * description, currentValue, and dotPath.
 *
 * GOTCHA: Must be declared BEFORE the /:domain wildcard route.
 *
 * Response: Array of schema items
 * e.g. [{ dotPath:"collection.suggestedTagsThreshold", type:"integer",
 *          min:0, max:100, unit:"%", currentValue:80, ... }]
 */
router.get("/schema", (req, res) => {
  try {
    res.json(getSchema());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/settings/reset ─────────────────────────────────────────────────
/**
 * Resets ALL settings to hardcoded defaults and flushes to disk.
 * Destructive — no undo. The frontend should confirm before calling.
 *
 * GOTCHA: Must be declared BEFORE the /:domain wildcard route.
 *
 * Returns: { ok: true, settings: object } — the post-reset settings
 */
router.post("/reset", (req, res) => {
  try {
    resetToDefaults();
    res.json({ ok: true, settings: getAllSettings() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/settings/:domain ─────────────────────────────────────────────────
/**
 * Returns the settings for a single named domain (e.g. "collection").
 * Useful when a route only needs to read one section.
 *
 * URL params:
 *   domain {string} — top-level settings key: collection | search | rss | keywords
 *
 * Returns: object (the domain's settings, _meta stripped)
 *   e.g. { suggestedTagsThreshold: 80 }
 *
 * 404 if the domain does not exist.
 */
router.get("/:domain", (req, res) => {
  try {
    const { domain } = req.params;
    const all = getAllSettings();
    if (!(domain in all)) {
      return res.status(404).json({ error: `Unknown settings domain: "${domain}"` });
    }
    res.json(all[domain]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/settings/:domain ───────────────────────────────────────────────
/**
 * Updates one or more settings within a domain.
 * Each key in the request body is applied as a dot-path write:
 *   PATCH /api/settings/collection  { "suggestedTagsThreshold": 90 }
 *   → setSetting("collection.suggestedTagsThreshold", 90)
 *
 * WHY PATCH: Partial updates only. A client sending { suggestedTagsThreshold: 90 }
 * must not accidentally clobber other keys in the collection domain.
 *
 * URL params:
 *   domain {string} — top-level settings key
 *
 * Request body: { [key: string]: value }
 *   Keys must match known settings within the domain.
 *   _meta and unknown keys are rejected.
 *
 * Returns: { ok: true, updated: { dotPath, value }[], settings: object }
 *   settings = the full updated settings object (post-write snapshot).
 *
 * On validation error: 400 with { error, dotPath } for the failing key.
 * On unknown domain:   404.
 */
router.patch("/:domain", (req, res) => {
  try {
    const { domain } = req.params;
    const all = getAllSettings();
    if (!(domain in all)) {
      return res.status(404).json({ error: `Unknown settings domain: "${domain}"` });
    }

    const updates = req.body;
    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      return res.status(400).json({ error: "Request body must be a JSON object of key:value pairs" });
    }

    const updated = [];
    for (const [key, value] of Object.entries(updates)) {
      // Reject _meta writes at the route level (belt + suspenders — lib also guards)
      if (key === "_meta" || key.startsWith("_")) {
        return res.status(400).json({ error: `Cannot update reserved key: "${key}"` });
      }
      const dotPath = `${domain}.${key}`;
      try {
        const result = setSetting(dotPath, value);
        updated.push({ dotPath: result.dotPath, value: result.value });
      } catch (err) {
        // Return immediately on first validation failure — don't apply partial writes
        return res.status(400).json({ error: err.message, dotPath });
      }
    }

    res.json({ ok: true, updated, settings: getAllSettings() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
