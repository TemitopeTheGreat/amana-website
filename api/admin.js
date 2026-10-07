// Session-gated proxy for the internal admin dashboard (admin.html).
// The Apps Script secret never reaches the browser; only this function
// holds it. Auth is a signed session cookie from api/admin-login.js, not
// a password sent on every request (see api/_lib/adminSession.js for why).
// Any signed-in role (super or general) can view the dashboard; role-
// gating happens on the actions that change or export sensitive data
// (api/admin-delete-request.js, api/admin-sync-candidate.js, the
// admin-*-user.js endpoints).
// Env vars (set in Vercel): APPS_SCRIPT_URL, APPS_SCRIPT_SECRET

const { verifySession } = require('./_lib/adminSession');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const session = verifySession(req);
  if (!session) return res.status(401).json({ error: 'unauthorized' });

  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) return res.status(503).json({ error: 'not_configured' });

  try {
    const r = await fetch(url + '?action=stats&secret=' + encodeURIComponent(secret), { redirect: 'follow' });
    const out = await r.json().catch(() => null);
    if (!r.ok || !out || !out.ok) return res.status(502).json({ error: 'fetch_failed' });
    return res.status(200).json({ ok: true, data: out.data, role: session.role, username: session.username });
  } catch (e) {
    return res.status(502).json({ error: 'fetch_failed' });
  }
};
