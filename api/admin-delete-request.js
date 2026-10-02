// Password-gated proxy to delete a single Requests-tab row by Request ID.
// Same auth pattern as api/admin.js (ADMIN_PASSWORD, never reaches the
// browser or this function's caller - only this function holds the Apps
// Script secret). Exists so test/junk rows created during verification
// (e.g. Stage A5 testing) can be cleaned up without pulling production
// secrets to a local machine or asking a human to edit the sheet by hand
// every time - see whatsapp-intake/README.md.
// Env vars (set in Vercel): ADMIN_PASSWORD, APPS_SCRIPT_URL, APPS_SCRIPT_SECRET

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return res.status(503).json({ error: 'not_configured' });

  const password = String(body.password || '');
  if (!password || password !== expected) {
    await new Promise((r) => setTimeout(r, 400));
    return res.status(401).json({ error: 'unauthorized' });
  }

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
