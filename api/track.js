// Public, unauthenticated endpoint for the site's own lightweight
// analytics (js/script.js's track()). No cookies, no visitor ID - just
// "a page was viewed" or "this CTA was clicked," forwarded to the Site
// Analytics tab (Code.gs's handleTrack_) so the admin dashboard can show
// traffic trends without a third-party analytics service.
//
// Deliberately fails silently: a visitor's page should never break, show
// an error, or even notice anything if analytics is misconfigured or the
// Apps Script call fails. Always returns 200.
// Env vars: APPS_SCRIPT_URL, APPS_SCRIPT_SECRET

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(200).json({ ok: true });
  }

  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) return res.status(200).json({ ok: true });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const page = String(body.page || '').slice(0, 200);
  const eventType = body.eventType === 'click' ? 'click' : 'pageview';
  const label = String(body.label || '').slice(0, 200);
  const referrer = String(body.referrer || '').slice(0, 200);
  if (!page) return res.status(200).json({ ok: true });

  try {
    await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'follow',
      body: JSON.stringify({ action: 'track', secret, page, eventType, label, referrer }),
    });
  } catch (e) {
    // Fire-and-forget - never surface this to the visitor.
  }
  return res.status(200).json({ ok: true });
};

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}
