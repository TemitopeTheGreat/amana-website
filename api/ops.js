// Password-gated proxy for the internal ops dashboard (ops.html).
// The Apps Script secret never reaches the browser; only this function holds it.
// Env vars (set in Vercel): OPS_PASSWORD, APPS_SCRIPT_URL, APPS_SCRIPT_SECRET

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const expected = process.env.OPS_PASSWORD;
  if (!expected) return res.status(503).json({ error: 'not_configured' });

  const password = String(body.password || '');
  if (!password || password !== expected) {
    // Small delay to slow down naive brute-forcing of a single password.
    await new Promise((r) => setTimeout(r, 400));
    return res.status(401).json({ error: 'unauthorized' });
  }

  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) return res.status(503).json({ error: 'not_configured' });

  try {
    const r = await fetch(url + '?action=stats&secret=' + encodeURIComponent(secret), { redirect: 'follow' });
    const out = await r.json().catch(() => null);
    if (!r.ok || !out || !out.ok) return res.status(502).json({ error: 'fetch_failed' });
    return res.status(200).json({ ok: true, data: out.data });
  } catch (e) {
    return res.status(502).json({ error: 'fetch_failed' });
  }
};

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}
