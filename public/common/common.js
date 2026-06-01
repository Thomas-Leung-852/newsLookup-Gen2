/* ============================================================
   common.js — newsLookup Gen2
   Shared utility functions loaded by ALL pages.
   Do not add page-specific logic here.
   ============================================================ */

/**
 * Escape a string for safe HTML insertion.
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}
