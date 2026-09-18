'use strict';

/**
 * Estimate LLM token count for a string.
 * Heuristic: ~1 token per 3.8 characters (structured text).
 *
 * @param {string} text
 * @returns {number}
 */
function estimateTokenCount(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.8);
}

module.exports = { estimateTokenCount };
