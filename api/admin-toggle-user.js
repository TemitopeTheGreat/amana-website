// Enables or disables a named admin account - super admins only. A
// disabled account's credentials stop working immediately on its next
// login attempt (api/admin-login.js checks `active`); it isn't deleted,
// so re-enabling it later needs no new password.
//
// Env vars: APPS_SCRIPT_URL, APPS_SCRIPT_SECRET.

const { verifySession } = require('./_lib/adminSession');

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
  if (!username) return res.status(400).json({ error: 'invalid_username' });
  if (username.toLowerCase() === session.username.toLowerCase()) {
    return res.status(400).json({ error: 'cannot_modify_self' });
  }

  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) return res.status(503).json({ error: 'not_configured' });

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
};

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}
