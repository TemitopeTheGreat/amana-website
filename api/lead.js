// Validates a form submission and forwards it to the Google Apps Script
// that files it into the Amana Google Sheet (and saves any CV to Drive).
// Env vars (set in Vercel): APPS_SCRIPT_URL, APPS_SCRIPT_SECRET

const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
const KINDS = ['family', 'professional', 'organisation'];
const CV_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_CV_BASE64 = 3.6 * 1024 * 1024; // about 2.7 MB of file

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});

  // Honeypot: bots fill this hidden field. Pretend success and drop it.
  if (body.website) return res.status(200).json({ ok: true });

  const payload = {
    kind: KINDS.includes(body.kind) ? body.kind : 'family',
    name: clip(body.name, 120).trim(),
    phone: clip(body.phone, 40).trim(),
    email: clip(body.email, 160).trim(),
    location: clip(body.location, 160).trim(),
    need: clip(body.need, 120).trim(),
    experience: clip(body.experience, 60).trim(),
    arrangement: clip(body.arrangement, 40).trim(),
    message: clip(body.message, 2000).trim(),
    plan: clip(body.plan, 40).trim(),
  };

  if (!payload.name || !payload.phone || !payload.location ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) || !body.consent) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  if (body.cv && body.cv.data) {
    const cv = body.cv;
    if (payload.kind !== 'professional' || !CV_TYPES.includes(cv.type) ||
        typeof cv.data !== 'string' || cv.data.length > MAX_CV_BASE64) {
      return res.status(400).json({ error: 'invalid_cv' });
    }
    payload.cv = { name: clip(cv.name, 120), type: cv.type, data: cv.data };
  }

  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) return res.status(503).json({ error: 'not_configured' });
  payload.secret = secret;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
    const out = await r.json().catch(() => null);
    if (!r.ok || !out || !out.ok) return res.status(502).json({ error: 'send_failed' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: 'send_failed' });
  }
};

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}
