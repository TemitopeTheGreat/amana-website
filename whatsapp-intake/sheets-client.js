// Node-side client for the WhatsApp-intake request flow, now merged into
// the EXISTING, already-deployed apps-script/Code.gs at the repo root
// (per the user, 2 Oct 2026 — reuses the live sheet and deployment
// instead of a separate one). Same function shapes as the brief's Stage
// A2 request (appendRequestRow, updateRequestRow, findRequestBySessionId,
// appendBotSession, updateBotSession) - implemented as `action`-routed
// calls to that same Apps Script web app.
//
// Env vars required (already set in Vercel for the existing lead form -
// nothing new to configure):
//   APPS_SCRIPT_URL    - the Apps Script web app's /exec URL
//   APPS_SCRIPT_SECRET - the shared secret
//
// Mirrors the existing api/lead.js's fetch-to-Apps-Script pattern.

function requireEnv_(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set in Vercel. This is the same env var the existing ` +
      'lead form uses (api/lead.js) - if that form works, this is misconfigured ' +
      'some other way; if it doesn\'t either, see docs/INTAKE_SETUP.md.'
    );
  }
  return value;
}

async function callAppsScript_(action, payload) {
  const url = requireEnv_('APPS_SCRIPT_URL');
  const secret = requireEnv_('APPS_SCRIPT_SECRET');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    redirect: 'follow',
    body: JSON.stringify({ action, secret, ...payload }),
  });

  if (!res.ok) {
    throw new Error(`WhatsApp-intake backend returned HTTP ${res.status} for action "${action}"`);
  }
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`WhatsApp-intake backend rejected action "${action}": ${data.error || 'unknown error'}`);
  }
  return data;
}

/**
 * Appends a new Requests row. The backend assigns the Request ID itself
 * (sequential, reading the sheet) - any `record.requestId` you pass is
 * ignored, so don't rely on utils.generateRequestReference() for the
 * real ID; that helper is only for session-local/standalone use before
 * a row exists. Runs server-side duplicate detection (same phone +
 * overlapping staff category, last 30 days) and returns the flag - does
 * not block the write, per Stage A2 point 3 ("flags, does not silently
 * merge").
 * @param {import('./schema').AmanaRequest} record
 * @returns {Promise<{ requestId: string, duplicateFlag: boolean, duplicateOf: string|null }>}
 */
async function appendRequestRow(record) {
  const data = await callAppsScript_('appendRequest', { record });
  return { requestId: data.requestId, duplicateFlag: data.duplicateFlag, duplicateOf: data.duplicateOf };
}

/**
 * Updates an existing Requests row by its Request ID. Only the fields
 * present in `patch` are changed; Last Updated At is bumped automatically.
 * @param {string} requestId
 * @param {Partial<import('./schema').AmanaRequest>} patch
 */
async function updateRequestRow(requestId, patch) {
  await callAppsScript_('updateRequest', { requestId, patch });
}

/**
 * Looks up the Requests row linked to a WhatsApp bot session.
 * @param {string} sessionId
 * @returns {Promise<import('./schema').AmanaRequest|null>}
 */
async function findRequestBySessionId(sessionId) {
  const data = await callAppsScript_('findRequestBySession', { sessionId });
  return data.record || null;
}

/**
 * Appends a new Bot Sessions row.
 * @param {{ sessionId: string, whatsappNumber: string, currentQuestion: string,
 *   capturedAnswers: object, completionStatus: string, handoffFlag: boolean }} session
 */
async function appendBotSession(session) {
  await callAppsScript_('appendSession', { session });
}

/**
 * Updates an existing Bot Sessions row by Session ID. Only the fields
 * present in `patch` are changed; Last Message Time is bumped automatically.
 * @param {string} sessionId
 * @param {Partial<{ whatsappNumber: string, currentQuestion: string,
 *   capturedAnswers: object, completionStatus: string, handoffFlag: boolean }>} patch
 */
async function updateBotSession(sessionId, patch) {
  await callAppsScript_('updateSession', { sessionId, patch });
}

module.exports = {
  appendRequestRow,
  updateRequestRow,
  findRequestBySessionId,
  appendBotSession,
  updateBotSession,
};
