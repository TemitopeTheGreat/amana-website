// Shared utilities for the Amana intake schema: a request-reference
// generator and a Nigerian phone-number normalizer. Both the website
// form (Stage A3) and the WhatsApp bot (Stage A4) call these instead of
// rolling their own, so a reference or a phone number looks the same no
// matter which channel created the request.

/**
 * Generates a unique, human-readable request reference like "AMN-REQ-000123".
 *
 * Caveat: this stage has no persistent store yet (that's Stage A2), so
 * there's no real sequence counter to count up from. Two strategies:
 *
 *  - Pass `existingIds` (e.g. every requestId already in the Requests
 *    tab, once Stage A2 exists) and this returns the next free number
 *    in sequence - true, gapless, human-friendly numbering.
 *  - Called with no arguments (e.g. for standalone testing before
 *    Stage A2 is wired up), it falls back to a timestamp-derived number
 *    that's unique in practice but not sequential. Stage A2's own
 *    duplicate-detection (point 3 of that stage) is the backstop against
 *    a collision either way - this function alone doesn't guarantee one
 *    against concurrent writes, since nothing locks the counter.
 *
 * @param {Iterable<string>} [existingIds] - requestId values already in use
 * @returns {string}
 */
function generateRequestReference(existingIds) {
  const prefix = 'AMN-REQ-';

  if (existingIds) {
    let max = 0;
    for (const id of existingIds) {
      const match = /^AMN-REQ-(\d+)$/.exec(String(id || '').trim());
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
    return prefix + String(max + 1).padStart(6, '0');
  }

  // Fallback: last 5 digits of the current epoch seconds (cycles every
  // ~27 hours, fine for dev/testing) plus a random digit to cut collision
  // odds further. Not meant to be the real production ID source once
  // Stage A2's Sheet-backed sequence exists - use the existingIds path then.
  const secondsTail = String(Math.floor(Date.now() / 1000) % 100000).padStart(5, '0');
  const rand = Math.floor(Math.random() * 10);
  return prefix + secondsTail + rand;
}

/**
 * Normalizes a Nigerian phone number to E.164 (+234XXXXXXXXXX).
 * Accepts common input shapes: "08012345678", "801 234 5678",
 * "+234 801 234 5678", "2348012345678", with spaces/dashes/brackets.
 *
 * Does not verify the number is a real, reachable line - only that it's
 * structurally a Nigerian mobile number (11 digits starting 0, or the
 * 234 equivalent).
 *
 * @param {string} input
 * @returns {{ normalized: string, valid: boolean }}
 */
function normalizeNigerianPhone(input) {
  const digits = String(input || '').replace(/[^\d]/g, '');

  // 0XXXXXXXXXX (11 digits, local format)
  if (/^0\d{10}$/.test(digits)) {
    return { normalized: '+234' + digits.slice(1), valid: true };
  }
  // 234XXXXXXXXXX (13 digits, country code without +)
  if (/^234\d{10}$/.test(digits)) {
    return { normalized: '+' + digits, valid: true };
  }
  // Already had a + and came through as 234XXXXXXXXXX above; anything
  // else isn't a recognizable Nigerian mobile number.
  return { normalized: digits ? '+' + digits : '', valid: false };
}

module.exports = {
  generateRequestReference,
  normalizeNigerianPhone,
};
