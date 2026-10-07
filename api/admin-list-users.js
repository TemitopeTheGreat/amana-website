// Lists every named admin account for the dashboard's Manage Users page -
// super admins only. Never includes password hashes/salts (Code.gs's
// handleListAdminUsers_ already excludes them before this even sees the
// response).
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

  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) return res.status(503).json({ error: 'not_configured' });

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
};
