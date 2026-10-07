// Deletes a single Requests-tab row by Request ID - super admins only
// (a destructive, irreversible action). Session-gated (api/admin-login.js),
// the Apps Script secret never reaches the browser. Exists so test/junk
// rows created during verification can be cleaned up without pulling
// production secrets to a local machine or asking a human to edit the
// sheet by hand every time - see whatsapp-intake/README.md.
// Env vars (set in Vercel): APPS_SCRIPT_URL, APPS_SCRIPT_SECRET

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
  const requestId = String(body.requestId || '').trim();
  if (!/^AM-REQ-\d+$/.test(requestId)) {
    return res.status(400).json({ error: 'invalid_request_id' });
  }

  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) return res.status(503).json({ error: 'not_configured' });

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'follow',
      body: JSON.stringify({ action: 'deleteRequest', secret, requestId }),
    });
    const out = await r.json().catch(() => null);
    if (!r.ok || !out || !out.ok) return res.status(502).json({ error: 'delete_failed', detail: out && out.error });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: 'delete_failed' });
  }
};

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}
