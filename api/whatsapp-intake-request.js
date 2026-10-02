// Amana WhatsApp-intake "Request Staff" website form endpoint — Stage A3.
// Writes into the Requests tab of the SAME Google Sheet and through the
// SAME Apps Script deployment the existing lead form (api/lead.js) uses
// - see whatsapp-intake/README.md. Different tab, different schema,
// same sheet and deployment, no new credentials to provision.
//
// Env vars (already set in Vercel for the existing lead form):
// APPS_SCRIPT_URL, APPS_SCRIPT_SECRET
//
// On success: sends a client confirmation email directly (MailApp isn't
// available outside Apps Script, so this uses Resend/SMTP if configured
// - see sendConfirmationEmail_ below). The internal alert is the admin
// dashboard itself (admin.html) - new requests show up there on next
// load/refresh, no separate notification channel needed.
// WhatsApp acknowledgement is explicitly stubbed - see Stage A4, left
// out of this pass on purpose (no WhatsApp Business API account yet).

const schema = require('../whatsapp-intake/schema');
const constants = require('../whatsapp-intake/constants');
const utils = require('../whatsapp-intake/utils');
const sheetsClient = require('../whatsapp-intake/sheets-client');

// Leading = + - @ can make a spreadsheet treat text as a formula, so mark
// it as plain text - same guard api/lead.js uses before this payload
// reaches the same underlying Sheet.
const clip = (v, n) => {
  const t = String(v == null ? '' : v).slice(0, n).trim();
  return /^\s*[=+\-@]/.test(t) ? "'" + t : t;
};
const toBool = (v) => v === true || v === 'true' || v === 'on' || v === '1';
const toNumberOrNull = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Builds a validated AmanaRequest from raw form-submission input and
 * normalizes the phone number. Pure function (no I/O) so it's testable
 * without mocking fetch/env vars - see api/whatsapp-intake-request.test.js.
 * @param {Record<string, any>} body
 * @returns {{ record?: import('../whatsapp-intake/schema').AmanaRequest, errors: string[] }}
 */
function buildRequestFromBody(body) {
  const errors = [];

  const phone = utils.normalizeNigerianPhone(body.clientPhone);
  if (!phone.valid) errors.push('clientPhone');

  const record = {
    ...schema.createEmptyRequest(),
    sourceChannel: 'Website',
    status: 'New',
    clientFullName: clip(body.clientFullName, 120),
    clientPhone: phone.normalized,
    clientEmail: clip(body.clientEmail, 160),
    clientType: constants.CLIENT_TYPES.includes(body.clientType) ? body.clientType : constants.CLIENT_TYPES[0],
    preferredContactChannel: constants.CONTACT_CHANNELS.includes(body.preferredContactChannel)
      ? body.preferredContactChannel : constants.CONTACT_CHANNELS[0],
    consent: toBool(body.consent),
    consentTimestamp: toBool(body.consent) ? new Date().toISOString() : '',
    staffCategory: constants.STAFF_CATEGORIES.includes(body.staffCategory) ? body.staffCategory : '',
    jobTitle: clip(body.jobTitle, 120),
    numberRequired: Math.max(1, parseInt(body.numberRequired, 10) || 1),
    employmentType: constants.EMPLOYMENT_TYPES.includes(body.employmentType) ? body.employmentType : '',
    liveArrangement: constants.LIVE_ARRANGEMENTS.includes(body.liveArrangement) ? body.liveArrangement : '',
    state: clip(body.state, 80),
    lga: clip(body.lga, 80),
    area: clip(body.area, 120),
    responsibilities: clip(body.responsibilities, 2000),
    requiredSkills: clip(body.requiredSkills, 500),
    qualifications: clip(body.qualifications, 500),
    experience: clip(body.experience, 500),
    languages: clip(body.languages, 200),
    startDate: clip(body.startDate, 40),
    urgency: constants.URGENCY_LEVELS.includes(body.urgency) ? body.urgency : '',
    workingDays: clip(body.workingDays, 120),
    workingHours: clip(body.workingHours, 120),
    accommodation: toBool(body.accommodation),
    meals: toBool(body.meals),
    salaryMin: toNumberOrNull(body.salaryMin),
    salaryMax: toNumberOrNull(body.salaryMax),
    currency: clip(body.currency, 10) || 'NGN',
  };

  const { valid, missing } = schema.validateForConfirmation(record);
  if (!valid) errors.push(...missing.filter((f) => !errors.includes(f)));

  if (record.clientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.clientEmail)) {
    errors.push('clientEmail');
  }
  if (record.salaryMin != null && record.salaryMax != null && record.salaryMin > record.salaryMax) {
    errors.push('salaryRange');
  }

  return errors.length ? { errors } : { record, errors: [] };
}

// Stage A4 territory, deliberately not built yet: no WhatsApp Business
// API account/credentials exist (Stage A0). Logs instead of sending, so
// the gap is visible rather than silently swallowed, and a real
// implementation can replace this function's body alone later.
async function sendWhatsAppAcknowledgement_(record) {
  console.log('[STUB] WhatsApp acknowledgement not sent (Stage A4 not built): ', record.requestId, record.clientPhone);
  return { sent: false, reason: 'whatsapp_not_configured' };
}

// Real email confirmation path (the brief's required fallback for when
// WhatsApp delivery fails or consent/number is absent - here, always,
// until Stage A4 exists). Uses Resend's HTTP API if RESEND_API_KEY is
// set; otherwise logs and reports unsent so the caller never claims a
// false success.
async function sendConfirmationEmail_(record) {
  if (!record.clientEmail) return { sent: false, reason: 'no_email' };
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Amana <hello@amanastaff.com>';
  if (!apiKey) {
    console.log('[STUB] Confirmation email not sent, RESEND_API_KEY not set:', record.requestId, record.clientEmail);
    return { sent: false, reason: 'email_not_configured' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to: record.clientEmail,
        subject: `Amana — we received your request (${record.requestId})`,
        text: `Hi ${record.clientFullName || 'there'},\n\nThanks for your request. Your reference is ${record.requestId}. A member of the Amana team will be in touch.\n\n— Amana`,
      }),
    });
    return { sent: res.ok, reason: res.ok ? null : `resend_http_${res.status}` };
  } catch (e) {
    return { sent: false, reason: 'email_send_error' };
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});

  // Honeypot: bots fill this hidden field. Pretend success and drop it.
  if (body.website) return res.status(200).json({ ok: true });

  const { record, errors } = buildRequestFromBody(body);
  if (errors.length) {
    return res.status(400).json({ error: 'invalid_input', fields: errors });
  }

  try {
    const result = await sheetsClient.appendRequestRow(record);
    record.requestId = result.requestId;

    // Fire the client confirmation, but don't let its failure turn a
    // successful write into a false "could not submit" to the client -
    // the row is already safely recorded at this point. The internal
    // alert (Stage A3 point 3) is the admin dashboard itself: Code.gs
    // already emails NOTIFY_EMAIL on every new request (notifyRequest_),
    // same as the existing candidate/family/org flow, and the request
    // shows up in admin.html's live stats on next load - no separate
    // channel needed.
    const [whatsapp, email] = await Promise.all([
      sendWhatsAppAcknowledgement_(record),
      sendConfirmationEmail_(record),
    ]);

    return res.status(200).json({
      ok: true,
      requestId: result.requestId,
      duplicateFlag: result.duplicateFlag,
      confirmation: { whatsapp, email },
    });
  } catch (e) {
    console.error('whatsapp-intake-request failed:', e.message);
    return res.status(502).json({
      error: 'send_failed',
      message: 'We could not record your request just now. Please try again in a moment or contact us directly.',
    });
  }
};

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}

module.exports.buildRequestFromBody = buildRequestFromBody;
