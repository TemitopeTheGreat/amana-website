// Receives lead form submissions and emails them via Resend.
// Required env vars (set in Vercel): RESEND_API_KEY, LEAD_TO_EMAIL
// Optional: LEAD_FROM_EMAIL (defaults to Resend's onboarding sender)

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

const KINDS = {
  family: 'Family / household request',
  professional: 'Professional application',
  organisation: 'Organisation enquiry',
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});

  // Honeypot: bots fill this hidden field. Pretend success and drop it.
  if (body.website) return res.status(200).json({ ok: true });

  const name = clip(body.name, 120).trim();
  const phone = clip(body.phone, 40).trim();
  const email = clip(body.email, 160).trim();
  const location = clip(body.location, 160).trim();
  const need = clip(body.need, 120).trim();
  const message = clip(body.message, 2000).trim();
  const kind = KINDS[body.kind] ? body.kind : 'family';
  const plan = clip(body.plan, 40).trim();
  const page = clip(body.page, 80).trim();

  if (!name || !phone || !location || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.LEAD_TO_EMAIL;
  if (!apiKey || !to) {
    return res.status(503).json({ error: 'not_configured' });
  }
  const from = process.env.LEAD_FROM_EMAIL || 'Amana <onboarding@resend.dev>';

  const rows = [
    ['Type', KINDS[kind]],
    ['Name', name],
    ['Phone', phone],
    ['Email', email],
    ['Location', location],
    ['Interest', need],
    ['Plan', plan],
    ['Message', message],
    ['Page', page],
  ].filter(([, v]) => v);

  const html = '<h2>' + esc(KINDS[kind]) + '</h2><table cellpadding="6">' +
    rows.map(([k, v]) => '<tr><td><strong>' + esc(k) + '</strong></td><td>' + esc(v) + '</td></tr>').join('') +
    '</table>';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject: KINDS[kind] + ': ' + name,
        html,
      }),
    });
    if (!r.ok) return res.status(502).json({ error: 'send_failed' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: 'send_failed' });
  }
};

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}
