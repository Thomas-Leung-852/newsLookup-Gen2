/**
 * lib/ai.js — Cloud AI client, model profiles, callAI wrapper, HTML stripper.
 *
 * ROLE:    Provides a single callAI() function that all routes use for any
 *          cloud AI feature: summaries, keyword extraction, tag suggestions.
 * OWNS:    `ollama` — the cloud Ollama client instance
 * TALKS TO: Ollama CLOUD API (AI_BASE_URL), local filesystem (model-profiles.json)
 * DO NOT:  Use ollamaLocal from lib/embedding.js here — cloud and local clients
 *          are intentionally separate. This file never does embedding.
 *
 * GOTCHA:  callAI() strips <think>...</think> blocks from responses because
 *          some reasoning models (e.g. qwen3) return their chain-of-thought
 *          wrapped in those tags before the actual answer.
 */

import { Ollama }     from "ollama";
import { readFileSync } from "fs";
import { AI_MODEL, AI_API_KEY, AI_BASE_URL, PROFILES_PATH } from "../config.js";

/**
 * Ollama cloud client — authenticated via Bearer token when AI_API_KEY is set.
 * WHY: Ollama local instances need no auth header; cloud instances require one.
 *      The conditional prevents sending an empty Authorization header locally.
 */
const ollamaConfig = {
  host:    AI_BASE_URL,
  headers: AI_API_KEY && AI_API_KEY !== "ollama"
    ? { Authorization: "Bearer " + AI_API_KEY }
    : {},
};
export const ollama = new Ollama(ollamaConfig);

// Log auth mode at startup to help debug misconfigured API keys
console.log(
  `🔧 Ollama AI client: host=${AI_BASE_URL}, auth=${
    AI_API_KEY && AI_API_KEY !== "ollama" ? "Bearer key set" : "no auth (local)"
  }`
);

// ── Model profiles ────────────────────────────────────────────────────────────

/**
 * Loads all model generation profiles from model-profiles.json.
 *
 * WHY:    Different models need different Ollama options (temperature, top_p,
 *         repeat_penalty etc.) for best results. Externalising these into a
 *         JSON file means tuning doesn't require code changes.
 * GOTCHA: Returns an empty object {} if the file is missing, unreadable, or
 *         malformed — never throws. The _comment key is stripped before return.
 * RETURNS: { "model-name": { temperature, top_p, ... }, ... } or {}
 */
export function loadModelProfiles() {
  try {
    const raw = JSON.parse(readFileSync(PROFILES_PATH, "utf8"));
    const { _comment, ...profiles } = raw; // strip documentation key
    return profiles;
  } catch (err) {
    console.warn(`⚠️  Could not load model-profiles.json: ${err.message}`);
    return {};
  }
}

/**
 * Returns the Ollama options object for the currently configured AI_MODEL.
 *
 * WHY:    Centralises model-option lookup so callAI() stays clean.
 * GOTCHA: Returns {} (not null) if no profile exists for AI_MODEL.
 *         An empty object means "let Ollama use its own defaults" — this is
 *         intentional and safe. Logs a notice so developers know it's happening.
 * RETURNS: { temperature, top_p, ... } or {}
 */
export function getModelOptions() {
  const profiles = loadModelProfiles();
  const profile  = profiles[AI_MODEL];
  if (!profile || Object.keys(profile).length === 0) {
    console.log(`ℹ️  No model profile for "${AI_MODEL}" — using Ollama defaults`);
    return {};
  }
  return profile;
}

// ── AI call wrapper ───────────────────────────────────────────────────────────

/**
 * Sends a single-turn prompt to the configured cloud AI model and returns
 * the cleaned response text.
 *
 * WHY:    Wraps ollama.chat() so all routes share the same model, options
 *         loading, and <think> tag stripping logic in one place.
 * GOTCHA: Does NOT catch errors — callers (routes) are responsible for
 *         try/catch so they can return appropriate HTTP error responses.
 *         Strips <think>...</think> blocks which reasoning models inject
 *         before their final answer. Without stripping, bullet-point summaries
 *         would include the model's raw reasoning chain.
 * RETURNS: Cleaned response string with think blocks and leading/trailing
 *          whitespace removed.
 *
 * @param {string} prompt - Full prompt string to send as a user message
 * @returns {Promise<string>}
 */
export async function callAI(prompt) {
  const modelOptions = getModelOptions();
  const response = await ollama.chat({
    model:    AI_MODEL,
    messages: [{ role: "user", content: prompt }],
    stream:   false,
    // Only pass options if the profile is non-empty to avoid overriding defaults with {}
    ...(Object.keys(modelOptions).length > 0 && { options: modelOptions }),
  });
  return response.message.content
    .replace(/<think>[\s\S]*?<\/think>/gi, "") // strip reasoning chain
    .trim();
}

// ── HTML utility ──────────────────────────────────────────────────────────────

/**
 * Strips HTML tags and collapses whitespace from a raw HTML string.
 *
 * WHY:    Article pages fetched in routes/summarise.js contain script/style
 *         blocks, navigation, and ads that waste AI context tokens. This
 *         reduces a 50KB page to its readable text content.
 * GOTCHA: This is a regex-based stripper, not a DOM parser. It handles
 *         the common case well but may leave artefacts from malformed HTML
 *         or unusual tag structures. Sufficient for news article text.
 * RETURNS: Plain text with single spaces between words, no leading/trailing whitespace.
 *
 * @param {string} html - Raw HTML string
 * @returns {string}
 */
export function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "") // remove script blocks entirely
    .replace(/<style[\s\S]*?<\/style>/gi, "")   // remove style blocks entirely
    .replace(/<[^>]+>/g, " ")                   // replace all remaining tags with space
    .replace(/\s+/g, " ")                       // collapse multiple spaces
    .trim();
}
