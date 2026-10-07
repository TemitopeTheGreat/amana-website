// Password-gated "Sync to CRM" action for the admin dashboard (admin.html).
// Same auth pattern as api/admin.js and api/admin-delete-request.js -
// ADMIN_PASSWORD never reaches a third party, only this function holds it.
//
// Forwards one candidate's record to the company CRM's inbound webhook and,
// on success, tells Apps Script to stamp 'CRM Synced At' on that row so the
// dashboard can show "Synced" instead of re-posting it next time.
//
// Not wired to a real CRM yet - CRM_WEBHOOK_URL is unset until the team
// supplies the actual CRM's webhook URL (HubSpot/Zoho/Pipedrive/Salesforce
// all accept a plain inbound webhook; Salesforce usually wants an OAuth
// flow instead, which this simple POST won't satisfy on its own). Same
// "build everything, stub only the third-party credential" shape as
// sendWhatsAppAcknowledgement_ and sendConfirmationEmail_ elsewhere in this
// codebase - the gap is reported to the caller, never silently swallowed.
// Env vars (set in Vercel): ADMIN_PASSWORD, APPS_SCRIPT_URL, APPS_SCRIPT_SECRET,
// CRM_WEBHOOK_URL, CRM_API_KEY (optional bearer token for the webhook)

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

  const candidateId = String(body.candidateId || '').trim();
  if (!/^AM-C-\d+$/.test(candidateId)) {
    return res.status(400).json({ error: 'invalid_candidate_id' });
  }
  const candidate = body.candidate && typeof body.candidate === 'object' ? body.candidate : {};

  const webhookUrl = process.env.CRM_WEBHOOK_URL;
  if (!webhookUrl) {
    return res.status(200).json({ ok: true, synced: false, reason: 'crm_not_configured' });
  }

  const payload = {
    source: 'amana-admin',
    candidateId: candidateId,
    name: candidate['Name'] || '',
    displayName: candidate['Display Name'] || '',
    phone: candidate['Phone'] || '',
    email: candidate['Email'] || '',
    role: candidate['Role'] || '',
    experience: candidate['Experience'] || '',
    arrangement: candidate['Arrangement'] || '',
    location: candidate['Location'] || '',
    status: candidate['Status'] || '',
    cvUrl: candidate['CV link'] || '',
    submittedAt: candidate['Submitted'] || '',
  };

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.CRM_API_KEY) headers.Authorization = `Bearer ${process.env.CRM_API_KEY}`;
    const r = await fetch(webhookUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!r.ok) return res.status(502).json({ error: 'crm_webhook_failed', status: r.status });
  } catch (e) {
    return res.status(502).json({ error: 'crm_webhook_failed' });
  }

  const scriptUrl = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (scriptUrl && secret) {
    try {
      await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'follow',
        body: JSON.stringify({ action: 'markCandidateSynced', secret, candidateId }),
      });
    } catch (e) {
      // The CRM already has the record; failing to stamp the sheet just
      // means the dashboard may offer to re-sync next load - not worth
      // turning into a user-facing error here.
    }
  }

  return res.status(200).json({ ok: true, synced: true });
};

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}
