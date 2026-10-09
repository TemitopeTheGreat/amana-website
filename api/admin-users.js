// Manage Users: list, create and enable/disable named admin accounts -
// super admins only. Combined into one endpoint (was three:
// admin-list-users.js, admin-create-user.js, admin-toggle-user.js) to
// stay under Vercel's Hobby-plan 12-serverless-function limit once
// api/track.js (site analytics) needed a slot - see git history around
// 9-10 Oct 2026 for the split version if that limit ever goes away.
//
// Body: { op: 'list' } | { op: 'create', username, password, role } |
// { op: 'toggle', username, active }
//
// Env vars: APPS_SCRIPT_URL, APPS_SCRIPT_SECRET.

const crypto = require('crypto');
const { verifySession } = require('./_lib/adminSession');

// Accepts either a simple username (letters/numbers/dots/dashes/underscores)
// or a full email address, since several accounts were created with an
// email as the login name.
const USERNAME_RE = /^[a-z0-9._-]{3,40}$|^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/i;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const session = verifySession(req);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  if (session.role !== 'super') return res.status(403).json({ error: 'forbidden' });

  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) return res.status(503).json({ error: 'not_configured' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const op = body.op;

  if (op === 'list') return handleList(res, url, secret);
  if (op === 'create') return handleCreate(res, url, secret, session, body);
  if (op === 'toggle') return handleToggle(res, url, secret, session, body);
  return res.status(400).json({ error: 'invalid_op' });
};

async function handleList(res, url, secret) {
  try {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'follow',
      body: JSON.stringify({ action: 'listAdminUsers', secret }),
    });
    const out = await r.json().catch(() => null);
    if (!r.ok || !out || !out.ok) return res.status(502).json({ error: 'fetch_failed' });
    return res.status(200).json({ ok: true, users: out.users });
  } catch (e) {
    return res.status(502).json({ error: 'fetch_failed' });
  }
}

async function handleCreate(res, url, secret, session, body) {
  const username = String(body.username || '').trim();
  // Trimmed - matches the trim applied to a submitted password at login
  // time (api/admin-login.js), so a stray space picked up from copy-
  // pasting doesn't create a password that can never actually log in.
  const password = String(body.password || '').trim();
  const role = body.role === 'super' ? 'super' : 'general';

  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'invalid_username' });
  if (username.toLowerCase() === 'owner') return res.status(400).json({ error: 'username_reserved' });
  if (password.length < 10) return res.status(400).json({ error: 'password_too_short' });

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
}

async function handleToggle(res, url, secret, session, body) {
  const username = String(body.username || '').trim();
  if (!username) return res.status(400).json({ error: 'invalid_username' });
  if (username.toLowerCase() === session.username.toLowerCase()) {
    return res.status(400).json({ error: 'cannot_modify_self' });
  }

  try {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'follow',
      body: JSON.stringify({ action: 'setAdminUserActive', secret, username, active: !!body.active }),
    });
    const out = await r.json().catch(() => null);
    if (!r.ok || !out || !out.ok) return res.status(409).json({ error: (out && out.error) || 'update_failed' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: 'update_failed' });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}
