// Username+password admin login. Issues a signed, HttpOnly session
// cookie (api/_lib/adminSession.js) instead of the old pattern - sending
// the one shared ADMIN_PASSWORD on every request and keeping it in the
// browser's sessionStorage, readable by any script on the page.
//
// Two account paths:
// 1. The "owner" break-glass account - username "owner", password is
//    ADMIN_PASSWORD (the one env var this project has always had).
//    Always works, independent of the Admin Users sheet, so the business
//    owner can never be locked out even if that sheet or Apps Script has
//    a problem. Always role "super".
// 2. Named accounts stored in the Admin Users sheet (Code.gs), created by
//    a super admin from the dashboard's Manage Users page. Passwords are
//    hashed here with Node's built-in scrypt before anything is sent to
//    the sheet - only a hash+salt are ever stored, never the plaintext
//    password, and this file is the only place that ever sees it.
//
// Env vars: ADMIN_PASSWORD (existing), APPS_SCRIPT_URL, APPS_SCRIPT_SECRET.

const crypto = require('crypto');
const { createSessionCookie } = require('./_lib/adminSession');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const username = String(body.username || '').trim();
  // Trimmed - a password copy-pasted from a chat message or doc very
  // easily picks up a stray leading/trailing space, which would otherwise
  // silently fail to match. Trimmed consistently here and wherever a
  // password is hashed in api/admin-users.js's create op, so this never
  // causes a login that should work to fail.
  const password = String(body.password || '').trim();
  if (!username || !password) {
    await delay_(300);
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  if (username.toLowerCase() === 'owner') {
    const expected = String(process.env.ADMIN_PASSWORD || '').trim();
    if (!expected) return res.status(503).json({ error: 'not_configured' });
    if (password !== expected) {
      await delay_(400);
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    res.setHeader('Set-Cookie', createSessionCookie('owner', 'super'));
    return res.status(200).json({ ok: true, username: 'owner', role: 'super' });
  }

  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) return res.status(503).json({ error: 'not_configured' });

  try {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'follow',
      body: JSON.stringify({ action: 'getAdminUser', secret, username }),
    });
    const out = await r.json().catch(() => null);
    if (!r.ok || !out || !out.ok || !out.user) {
      await delay_(400);
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const user = out.user;

    if (!user.active) {
      await delay_(300);
      return res.status(401).json({ error: 'account_disabled' });
    }
    if (user.lockedUntil && Date.now() < Number(user.lockedUntil)) {
      return res.status(401).json({ error: 'account_locked' });
    }

    const salt = Buffer.from(user.passwordSalt || '', 'hex');
    const hash = salt.length ? crypto.scryptSync(password, salt, 64).toString('hex') : '';
    const storedHash = String(user.passwordHash || '');
    const match = !!hash && hash.length === storedHash.length &&
      crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));

    // Record the attempt before responding - updates the lockout counter
    // either way. Best-effort: a failure here shouldn't change the
    // outcome of this login.
    await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'follow',
      body: JSON.stringify({ action: 'recordLoginAttempt', secret, username, success: match }),
    }).catch(() => {});

    if (!match) {
      await delay_(400);
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    res.setHeader('Set-Cookie', createSessionCookie(username, user.role));
    return res.status(200).json({ ok: true, username, role: user.role });
  } catch (e) {
    return res.status(502).json({ error: 'login_failed' });
  }
};

function delay_(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}
