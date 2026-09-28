// Code-gated proxy for the Academy training portal (training.html).
// Validates the shared access code, logs who opened the portal, then returns
// the published materials list read live from the "Training Materials" sheet
// tab (so Amana staff manage content there, no code change needed).
// Env vars (set in Vercel): ACADEMY_CODE, APPS_SCRIPT_URL, APPS_SCRIPT_SECRET

const clip = (v, n) => String(v == null ? '' : v).slice(0, n).trim();

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const expected = process.env.ACADEMY_CODE;
  if (!expected) return res.status(503).json({ error: 'not_configured' });

  const name = clip(body.name, 120);
  const code = clip(body.code, 60);
  if (!name || !code) return res.status(400).json({ error: 'invalid_input' });

  if (code !== expected) {
    await new Promise((r) => setTimeout(r, 400));
    return res.status(401).json({ error: 'unauthorized' });
  }

  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) return res.status(503).json({ error: 'not_configured' });

  const email = clip(body.email, 160);

  // Log the access, but don't let a logging hiccup block someone from seeing their materials.
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret, kind: 'training_access', name, email, page: 'training.html' }),
    redirect: 'follow',
  }).catch(() => {});

  try {
    const r = await fetch(url + '?action=materials&secret=' + encodeURIComponent(secret), { redirect: 'follow' });
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
