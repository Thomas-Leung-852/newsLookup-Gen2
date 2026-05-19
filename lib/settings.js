/**
 * lib/settings.js — Runtime application settings manager.
 *
 * ROLE:    Single source of truth for all tuneable runtime values.
 *          Loads from config/app-settings.json at startup, keeps an
 *          in-memory copy for synchronous reads on hot paths, and
 *          persists changes back to disk on every write.
 *
 * DESIGN RULES:
 *   - Reads are synchronous (getSetting / getAllSettings).
 *     Hot paths (search scoring, tag filtering) call getSetting() with
 *     zero async overhead.
 *   - Writes are async (setSetting / resetToDefaults) because they
 *     flush to disk. Await them only in route handlers, never in
 *     tight loops.
 *   - Secrets (API keys, ports) live in config.js / env vars ONLY.
 *     Nothing in app-settings.json should ever be a secret.
 *   - _meta keys are read-only schema hints. setSetting() silently
 *     ignores any attempt to overwrite a _meta key.
 *
 * EXPORT SURFACE:
 *   loadSettings()                  — call once in server.js before mounting routes
 *   getSetting(dotPath)             — synchronous read,  e.g. 'collection.suggestedTagsThreshold'
 *   setSetting(dotPath, value)      — validated async write + disk flush
 *   getAllSettings()                — returns full settings object (no _meta keys)
 *   getSchema()                     — returns flattened schema from all _meta blocks
 *   resetToDefaults()               — async, restores HARDCODED_DEFAULTS + disk flush
 *
 * DEPENDENCY ORDER:
 *   lib/settings.js has NO imports from routes/* or db/*.
 *   It may only import Node built-ins and config.js (for SETTINGS_PATH).
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname }                           from "path";
import { fileURLToPath }                            from "url";

// ---------------------------------------------------------------------------
// Path resolution — settings file lives at config/app-settings.json
// relative to the project root (one level above this lib/ directory).
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dir      = dirname(__filename);
const SETTINGS_PATH = join(__dir, "../config/app-settings.json");

// ---------------------------------------------------------------------------
// HARDCODED_DEFAULTS
//
// WHY: If app-settings.json is missing or corrupt on first boot, the app
// must still function. These values mirror the defaults in app-settings.json
// and act as the authoritative fallback + the target for resetToDefaults().
//
// RULE: When you add a new setting to app-settings.json, add its default
// here too. Both places must stay in sync.
// ---------------------------------------------------------------------------
const HARDCODED_DEFAULTS = {
  version: 1,
  collection: {
    suggestedTagsThreshold: 80,
  },
  search: {
    embedThreshold: 0.5,
    keywordFallbackEnabled: true,
  },
  rss: {
    cacheTtlMinutes: 15,
  },
  keywords: {
    maxSuggested: 10,
  },
};

// ---------------------------------------------------------------------------
// In-memory settings store — populated by loadSettings(), mutated by
// setSetting() and resetToDefaults(). Never access this directly outside
// this module; use the exported functions.
// ---------------------------------------------------------------------------
let _settings = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deep-merge src into dest (plain objects only, no arrays).
 * Used to overlay file contents onto HARDCODED_DEFAULTS so that
 * newly added default keys are always present even if the file
 * predates them.
 */
function deepMerge(dest, src) {
  const out = { ...dest };
  for (const key of Object.keys(src)) {
    if (
      src[key] !== null &&
      typeof src[key] === "object" &&
      !Array.isArray(src[key]) &&
      typeof dest[key] === "object" &&
      dest[key] !== null
    ) {
      out[key] = deepMerge(dest[key], src[key]);
    } else {
      out[key] = src[key];
    }
  }
  return out;
}

/**
 * Resolve a dot-path string to { parent, key } within _settings.
 * Returns null if the path is invalid or resolves to a _meta key.
 * e.g. 'collection.suggestedTagsThreshold' →
 *        { parent: _settings.collection, key: 'suggestedTagsThreshold' }
 */
function resolvePath(dotPath) {
  const parts = dotPath.split(".");
  const key   = parts.pop();
  if (key === "_meta" || key.startsWith("_")) return null;

  let node = _settings;
  for (const part of parts) {
    if (typeof node[part] !== "object" || node[part] === null) return null;
    node = node[part];
  }
  if (!(key in node)) return null;
  return { parent: node, key };
}

/**
 * Strip all _meta keys from an object (deep) before returning to callers.
 * We never want schema hints leaking into responses or being overwritten.
 */
function stripMeta(obj) {
  if (typeof obj !== "object" || obj === null) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "_meta") continue;
    out[k] = typeof v === "object" && v !== null ? stripMeta(v) : v;
  }
  return out;
}

/**
 * Validate a value against the schema for its dot-path.
 * Returns { valid: true } or { valid: false, reason: string }.
 */
function validate(dotPath, value) {
  const parts  = dotPath.split(".");
  const key    = parts[parts.length - 1];
  const domain = parts[0];

  // Walk to the _meta entry if it exists
  let meta = null;
  try {
    const domainMeta = _settings[domain]?._meta;
    if (domainMeta?.[key]) meta = domainMeta[key];
  } catch { /* no meta — skip validation */ }

  if (!meta) return { valid: true }; // no schema, anything goes

  if (meta.type === "integer") {
    if (!Number.isInteger(Number(value)))
      return { valid: false, reason: `${key} must be an integer` };
    const n = Number(value);
    if (meta.min !== undefined && n < meta.min)
      return { valid: false, reason: `${key} must be >= ${meta.min}` };
    if (meta.max !== undefined && n > meta.max)
      return { valid: false, reason: `${key} must be <= ${meta.max}` };
  }

  if (meta.type === "float") {
    if (isNaN(Number(value)))
      return { valid: false, reason: `${key} must be a number` };
    const n = Number(value);
    if (meta.min !== undefined && n < meta.min)
      return { valid: false, reason: `${key} must be >= ${meta.min}` };
    if (meta.max !== undefined && n > meta.max)
      return { valid: false, reason: `${key} must be <= ${meta.max}` };
  }

  if (meta.type === "boolean") {
    if (typeof value !== "boolean" && value !== "true" && value !== "false")
      return { valid: false, reason: `${key} must be true or false` };
  }

  return { valid: true };
}

/**
 * Persist the current in-memory settings to disk.
 * Stamps updatedAt before writing.
 */
function flushToDisk() {
  _settings.updatedAt = new Date().toISOString();
  writeFileSync(SETTINGS_PATH, JSON.stringify(_settings, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * loadSettings()
 *
 * Must be called once in server.js BEFORE mounting any routes.
 * Reads app-settings.json, merges with HARDCODED_DEFAULTS (so new keys
 * added in code are always present), and populates the in-memory store.
 * If the file is missing or corrupt, falls back to HARDCODED_DEFAULTS
 * and writes the defaults file to disk so the next boot is normal.
 */
export function loadSettings() {
  try {
    if (existsSync(SETTINGS_PATH)) {
      const raw  = readFileSync(SETTINGS_PATH, "utf8");
      const file = JSON.parse(raw);
      // Merge so that newly coded defaults are always present,
      // but user-saved values are preserved.
      _settings = deepMerge(HARDCODED_DEFAULTS, file);
      console.log("⚙️  App settings loaded from", SETTINGS_PATH);
    } else {
      _settings = deepMerge({}, HARDCODED_DEFAULTS);
      flushToDisk();
      console.log("⚙️  App settings file not found — created with defaults at", SETTINGS_PATH);
    }
  } catch (err) {
    console.error("⚙️  Failed to load app-settings.json:", err.message, "— using hardcoded defaults");
    _settings = deepMerge({}, HARDCODED_DEFAULTS);
  }
}

/**
 * getSetting(dotPath) → value | undefined
 *
 * Synchronous read. Safe to call anywhere including hot paths.
 *
 * @param {string} dotPath  e.g. 'collection.suggestedTagsThreshold'
 * @returns {*}             The current value, or undefined if path not found.
 *
 * @example
 *   const threshold = getSetting('collection.suggestedTagsThreshold'); // 80
 */
export function getSetting(dotPath) {
  if (!_settings) {
    console.warn("⚠️  getSetting() called before loadSettings() — returning undefined");
    return undefined;
  }
  const resolved = resolvePath(dotPath);
  return resolved ? resolved.parent[resolved.key] : undefined;
}

/**
 * setSetting(dotPath, value) → { ok, dotPath, value } | throws
 *
 * Validates the new value against the schema, updates in-memory store,
 * then flushes to disk. Throws on invalid path or failed validation.
 *
 * @param {string} dotPath  e.g. 'collection.suggestedTagsThreshold'
 * @param {*}      value    New value (will be coerced to correct type)
 * @returns {{ ok: true, dotPath: string, value: * }}
 */
export function setSetting(dotPath, value) {
  if (!_settings) throw new Error("Settings not loaded — call loadSettings() first");

  const resolved = resolvePath(dotPath);
  if (!resolved) throw new Error(`Unknown setting path: "${dotPath}"`);

  const check = validate(dotPath, value);
  if (!check.valid) throw new Error(check.reason);

  // Coerce type to match schema
  const parts  = dotPath.split(".");
  const key    = parts[parts.length - 1];
  const domain = parts[0];
  const meta   = _settings[domain]?._meta?.[key];

  let coerced = value;
  if (meta?.type === "integer") coerced = parseInt(value, 10);
  if (meta?.type === "float")   coerced = parseFloat(value);
  if (meta?.type === "boolean") coerced = value === true || value === "true";

  resolved.parent[resolved.key] = coerced;
  flushToDisk();

  console.log(`⚙️  Setting updated: ${dotPath} = ${coerced}`);
  return { ok: true, dotPath, value: coerced };
}

/**
 * getAllSettings() → object
 *
 * Returns a clean copy of the full settings object with _meta keys stripped.
 * Safe to send directly to the client.
 */
export function getAllSettings() {
  if (!_settings) return {};
  return stripMeta(_settings);
}

/**
 * getSchema() → object[]
 *
 * Returns a flattened list of all setting definitions drawn from _meta blocks.
 * Used by the frontend to render the settings UI dynamically.
 *
 * Each item shape:
 *   { dotPath, domain, key, currentValue, label, description,
 *     type, min?, max?, step?, unit?, default }
 */
export function getSchema() {
  if (!_settings) return [];
  const schema = [];
  for (const [domain, domainObj] of Object.entries(_settings)) {
    if (domain === "version" || domain === "updatedAt") continue;
    if (typeof domainObj !== "object" || domainObj === null) continue;
    const meta = domainObj._meta || {};
    for (const [key, def] of Object.entries(meta)) {
      schema.push({
        dotPath: `${domain}.${key}`,
        domain,
        key,
        currentValue: domainObj[key],
        ...def,
      });
    }
  }
  return schema;
}

/**
 * resetToDefaults() → void
 *
 * Restores all settings to HARDCODED_DEFAULTS and flushes to disk.
 * _meta blocks from the current file are preserved (they don't change).
 * Called by POST /api/settings/reset.
 */
export function resetToDefaults() {
  if (!_settings) throw new Error("Settings not loaded — call loadSettings() first");

  // Carry forward _meta blocks so schema is preserved after reset
  const meta = {};
  for (const [domain, obj] of Object.entries(_settings)) {
    if (typeof obj === "object" && obj !== null && obj._meta) {
      meta[domain] = { _meta: obj._meta };
    }
  }

  _settings = deepMerge(HARDCODED_DEFAULTS, meta);
  flushToDisk();
  console.log("⚙️  Settings reset to defaults");
}
