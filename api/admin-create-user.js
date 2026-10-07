// Creates a named admin account (super or general role) - super admins
// only. Hashes the chosen password with Node's built-in scrypt before it
// ever leaves this function; Code.gs/the sheet only ever stores the
// hash+salt, never the plaintext password.
//
// Auth: requires a valid session cookie (api/_lib/adminSession.js) with
// role "super" - general admins cannot create accounts, and nobody
// without a session can.
//
// Env vars: APPS_SCRIPT_URL, APPS_SCRIPT_SECRET.

const crypto = require('crypto');
const { verifySession } = require('./_lib/adminSession');

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/i;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const session = verifySession(req);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  if (session.role !== 'super') return res.status(403).json({ error: 'forbidden' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const role = body.role === 'super' ? 'super' : 'general';

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'invalid_username' });
  }
  if (username.toLowerCase() === 'owner') {
    return res.status(400).json({ error: 'username_reserved' });
  }
  if (password.length < 10) {
    return res.status(400).json({ error: 'password_too_short' });
  }

  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) return res.status(503).json({ error: 'not_configured' });

  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');

  try {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'follow',
      body: JSON.stringify({
        action: 'createAdminUser', secret, username, role,
        passwordHash: hash, passwordSalt: salt.toString('hex'), createdBy: session.username,
      }),
    });
    const out = await r.json().catch(() => null);
    if (!r.ok || !out || !out.ok) return res.status(409).json({ error: (out && out.error) || 'create_failed' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: 'create_failed' });
  }
};

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}
