/**
 * server.js — newsLookup Gen2 application entry point.
 *
 * ROLE:    The only file that wires everything together. Responsibilities:
 *            1. Load rss-sites.json from disk
 *            2. Create and configure the Express app
 *            3. Inject shared state (sites list) into routers that need it
 *            4. Mount all routers at their correct base paths
 *            5. Await DB initialisation, then start listening
 *
 * DEPENDENCY ORDER (nothing below may import from above):
 *   config → db/* → lib/* → routes/* → server.js
 *
 * GOTCHA:  init() must be called on search and keywords routers BEFORE any
 *          request is served, so it runs immediately after import — not inside
 *          the Promise.all callback. The sites list is available synchronously
 *          from readFileSync, so this is safe.
 *
 * DO NOT:  Add business logic here. If you're tempted to write more than
 *          ~5 lines of logic in this file, it belongs in a route or lib instead.
 */

import express          from "express";
import { readFileSync } from "fs";
import { join }         from "path";

import {
  __dirname, PORT, SITES_PATH,
  AI_MODEL, AI_API_KEY, AI_BASE_URL,
  EMBED_MODEL, EMBED_BASE_URL,
} from "./config.js";
import { initDB }            from "./db/articlesDb.js";
import { initCollectionDB }  from "./db/collectionDb.js";
import { loadModelProfiles } from "./lib/ai.js";
import { loadSettings, getSetting } from "./lib/settings.js";

// Route modules — each exports a `router` and some export `init(sites)`
import { router as searchRouter,   init as searchInit   } from "./routes/search.js";
import { router as historyRouter                        } from "./routes/history.js";
import { router as summariseRouter                      } from "./routes/summarise.js";
import { router as collectionRouter                     } from "./routes/collection.js";
import { router as keywordsRouter, init as keywordsInit } from "./routes/keywords.js";
import { router as settingsRouter                       } from "./routes/settings.js";

// ── Load sites ────────────────────────────────────────────────────────────────

/**
 * Load runtime settings FIRST — before sites, routes, or any business logic.
 * Routes that call getSetting() synchronously on startup need this populated.
 */
loadSettings();

/**
 * Full list of configured RSS news sources, loaded once at startup.
 * Shape: Array<{ name: string, region: string, rss: string }>
 * Updated at runtime via PUT /api/sites — that route writes to disk AND
 * updates the module-level array in routes/search.js via reloadSites().
 */
const ALL_SITES = JSON.parse(readFileSync(SITES_PATH, "utf8"));

// ── Express setup ─────────────────────────────────────────────────────────────

const app = express();

// Increase JSON body limit to 50MB to support collection import payloads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Serve the frontend from /public — index.html, collection.html, editor.html etc.
app.use(express.static(join(__dirname, "public")));

// Named routes for SPA-style pages (avoids .html extension in the browser)
app.get("/collection", (req, res) =>
  res.sendFile(join(__dirname, "public/collection.html"))
);
app.get("/editor", (req, res) =>
  res.sendFile(join(__dirname, "public/editor.html"))
);
app.get("/settings", (req, res) =>
  res.sendFile(join(__dirname, "public/settings.html"))
);

// ── Inject shared state into routers ─────────────────────────────────────────
// Must happen before any request is served.
// WHY: Routers need the sites list but cannot import server.js (circular dep).
//      The init() pattern passes it in without creating a circular reference.
searchInit(ALL_SITES);
keywordsInit(ALL_SITES);

// ── Mount routers ─────────────────────────────────────────────────────────────
// Order matters for overlapping paths — more specific paths first.

app.use("/api",                    searchRouter);     // POST /api/search, GET/PUT /api/sites, etc.
app.use("/api/history",            historyRouter);    // GET/DELETE /api/history
app.use("/api/summarise",          summariseRouter);  // POST /api/summarise
app.use("/api/collection",         collectionRouter); // Full CRUD /api/collection/*
app.use("/api/suggested-keywords", keywordsRouter);   // GET/POST /api/suggested-keywords
app.use("/api/settings",           settingsRouter);   // GET/PATCH /api/settings

// ── Start ─────────────────────────────────────────────────────────────────────

/**
 * Initialise both SQLite databases concurrently, then start the HTTP server.
 * WHY Promise.all: Both databases are independent — no reason to init serially.
 * GOTCHA: If either DB fails to init (e.g. disk permission error), the process
 *         exits with an unhandled rejection. This is intentional — the app
 *         cannot function without its databases.
 */
Promise.all([initDB(), initCollectionDB()]).then(() => {
  app.listen(PORT, () => {
    const profiles = loadModelProfiles();
    const isCloud  = AI_API_KEY && AI_API_KEY !== "ollama";

    console.log(`\n🔍 newsLookup Gen2 — http://localhost:${PORT}`);
    console.log(`\n📡 Sites loaded:  ${ALL_SITES.length}`);
    console.log(`🧮 Embed model:   ${EMBED_MODEL} @ ${EMBED_BASE_URL} (threshold: ${getSetting("search.embedThreshold")})`);
    console.log(`🤖 AI model:      ${AI_MODEL} @ ${AI_BASE_URL} (${isCloud ? "Ollama Cloud" : "Ollama Local"})`);
    console.log(`🔑 API key:       ${
      AI_API_KEY
        ? (AI_API_KEY === "ollama" ? "ollama (local, no auth)" : AI_API_KEY.slice(0, 8) + "...")
        : "❌ NOT SET — AI features will fail"
    }`);
    console.log(`📚 Model profile: ${profiles[AI_MODEL] ? "loaded" : "not found — using Ollama defaults"}`);
    console.log(`\n💡 If embedding fails: ollama pull ${EMBED_MODEL}`);
    console.log(`💡 If AI fails:        ${isCloud ? "check AI_API_KEY and AI_MODEL env vars" : "ollama pull " + AI_MODEL}\n`);
  });
});
