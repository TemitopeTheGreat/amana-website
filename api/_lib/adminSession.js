// Shared helper for the cookie-based admin session, used by every admin-*
// API endpoint. Not a route itself - Vercel doesn't treat an api/_lib
// folder as an endpoint.
//
// Replaces the old pattern (the single shared ADMIN_PASSWORD stored in
// the browser's sessionStorage and resent on every request - readable by
// any script on the page, including an XSS payload). A session is now a
// signed, HttpOnly cookie: the browser can't read it with JavaScript, and
// the signature means it can't be forged or edited without the server's
// secret. See api/admin-login.js for how one is created.

const crypto = require('crypto');

const COOKIE_NAME = 'amana_admin_session';
const SESSION_HOURS = 12;

function sessionSecret_() {
  // Falls back to ADMIN_PASSWORD so sessions work today without adding a
  // brand-new required env var. Set a dedicated ADMIN_SESSION_SECRET in
  // Vercel (any long random string) when convenient, so a session token
  // doesn't share a secret with the login password itself.
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
}

function sign_(data) {
  return crypto.createHmac('sha256', sessionSecret_()).update(data).digest('base64url');
}

function createSessionCookie(username, role) {
  const payload = JSON.stringify({ u: username, r: role, exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
  const encoded = Buffer.from(payload, 'utf8').toString('base64url');
  const token = encoded + '.' + sign_(encoded);
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

function parseCookies_(req) {
  const header = (req.headers && req.headers.cookie) || '';
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i === -1) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

/**
 * Verifies the admin session cookie on an incoming request. Returns
 * { username, role } if valid, or null if missing/invalid/expired/
 * unconfigured - never throws, so callers can just check for null.
 */
function verifySession(req) {
  const secret = sessionSecret_();
  if (!secret) return null;
  const token = parseCookies_(req)[COOKIE_NAME];
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign_(encoded);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!payload || !payload.u || !payload.r || !payload.exp) return null;
  if (Date.now() > payload.exp) return null;
  return { username: payload.u, role: payload.r };
}

module.exports = { COOKIE_NAME, createSessionCookie, clearSessionCookie, verifySession };
