/**
 * Amana WhatsApp-intake backend (Google Apps Script) — Stage A2.
 *
 * This is a SEPARATE Apps Script project from apps-script/Code.gs at the
 * repo root. That one runs the live website lead form (Candidates/
 * Families/Organisations). This one is Part 1 of
 * Amana_Hiyame_Claude_Code_Prompts.md: a new 7-tab Requests/Bot Sessions/
 * Candidates/Shortlists/Placements/Lists & Settings/Automation Log sheet
 * for the WhatsApp-bot intake system. Different spreadsheet, different
 * secret, different Vercel env vars — see ../README.md.
 *
 * Why Apps Script again, when the brief's Stage A2 describes "a Sheets
 * API client wrapper... using service account credentials"? Because that
 * needs a new Google Workspace service account (a Stage A0 blocker that
 * isn't sorted), and this project already has a proven Apps-Script-as-
 * web-app pattern deployed and working for the exact same kind of job.
 * Reusing it gets Stage A2 to something real today instead of waiting on
 * a credential that doesn't exist yet. The repository function names the
 * brief asks for (appendRequestRow, updateRequestRow, etc.) are
 * implemented as doPost actions here instead of as direct Sheets-API
 * calls from Node — same contract, different transport.
 *
 * Setup: paste this whole file into a new Apps Script project bound to a
 * new spreadsheet, run setup() once, deploy as a web app (Execute as:
 * Me, Who has access: Anyone), then set WHATSAPP_INTAKE_URL and
 * WHATSAPP_INTAKE_SECRET in Vercel. Same steps as docs/INTAKE_SETUP.md
 * in the repo root, just for this separate project.
 */

const CONFIG = {
  // Fill in after creating the spreadsheet (Stage A0 — still open).
  SHEET_ID: '',
};

// Optional: paste a fixed secret here (then use the same value in Vercel
// as WHATSAPP_INTAKE_SECRET). Leave empty to have setup() generate one.
const PRESET_SECRET = '';

/**
 * Requests tab headers. MUST be kept in sync by hand with FIELD_ORDER in
 * whatsapp-intake/schema.js — Apps Script can't `require()` that file
 * directly, so this is a duplicate, not a shared import. If you add or
 * rename a field in schema.js, make the same change here.
 */
const REQUEST_HEADERS = [
  'Request ID', 'Created At', 'Source Channel', 'Session ID', 'Status',
  'Client Full Name', 'Client Phone', 'Client Email', 'Client Type', 'Preferred Contact Channel',
  'Consent', 'Consent Timestamp',
  'Staff Category', 'Job Title', 'Number Required', 'Employment Type', 'Live Arrangement',
  'State', 'LGA', 'Area',
  'Responsibilities', 'Required Skills', 'Qualifications', 'Experience', 'Languages',
  'Start Date', 'Urgency', 'Working Days', 'Working Hours', 'Accommodation', 'Meals',
  'Salary Min', 'Salary Max', 'Currency',
  'Assigned Recruiter', 'Last Updated At', 'Next Action', 'Notes', 'Closure Reason',
];

const BOT_SESSION_HEADERS = [
  'Session ID', 'WhatsApp Number', 'Current Question', 'Captured Answers (JSON)',
  'Completion Status', 'Last Message Time', 'Handoff Flag',
];

const AUTOMATION_LOG_HEADERS = ['Timestamp', 'Workflow ID', 'Source Record', 'Error', 'Retry Count'];

/**
 * Candidates/Shortlists/Placements/Lists & Settings: the brief only
 * locks down Requests and Bot Sessions columns at this stage (Stage A2
 * point 1 says Candidates etc. come later, from Stage A4/H2/H3). These
 * are a best-guess starting header row so the tabs exist and aren't
 * empty — treat as DRAFT, not signed off, same caveat as constants.js.
 */
const DRAFT_TAB_HEADERS = {
  'Candidates': ['Candidate ID', 'Full Name', 'Phone', 'Email', 'Staff Category', 'Experience',
    'Skills', 'Location', 'Availability', 'Verification Status', 'Approved', 'Marketplace Consent',
    'Document Links', 'Notes', 'Last Updated At'],
  'Shortlists': ['Shortlist ID', 'Request ID', 'Candidate ID', 'Status', 'Notes', 'Added At'],
  'Placements': ['Placement ID', 'Request ID', 'Candidate ID', 'Start Date', 'End Date', 'Status', 'Notes'],
  'Lists & Settings': ['List Name', 'Value', 'Notes'],
};

/* ---------------- Web app entry points ---------------- */

function doGet(e) {
  return json_({ ok: true, service: 'amana-whatsapp-intake' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const p = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || p.secret !== secret) return json_({ ok: false, error: 'unauthorized' });

    switch (p.action) {
      case 'appendRequest': return handleAppendRequest_(p);
      case 'updateRequest': return handleUpdateRequest_(p);
      case 'findRequestBySession': return handleFindRequestBySession_(p);
      case 'appendSession': return handleAppendSession_(p);
      case 'updateSession': return handleUpdateSession_(p);
      default: return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    logAutomationFailure_('doPost', (JSON.parse((e && e.postData && e.postData.contents) || '{}').action) || 'unknown', err);
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* not held */ }
  }
}

/* ---------------- Requests tab ---------------- */

/**
 * appendRequestRow(): writes a new Requests row. Generates the Request
 * ID itself (sequential, reading the last one already in the sheet —
 * same approach as nextId_ in the repo-root apps-script/Code.gs) rather
 * than trusting a client-supplied one, since two concurrent callers
 * guessing their own ID could collide. Runs duplicate detection first
 * (same phone + overlapping staff category within the last 30 days) and
 * returns the flag rather than silently blocking or merging — the
 * caller (website form / bot) decides what to do with a flagged
 * duplicate. Expects p.record = an AmanaRequest-shaped object (see
 * schema.js); any requestId on it is ignored.
 */
function handleAppendRequest_(p) {
  const record = p.record || {};
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureTab_(ss, 'Requests', REQUEST_HEADERS);

  const duplicate = findDuplicateRequest_(sheet, record.clientPhone, record.staffCategory);
  const requestId = nextRequestId_(sheet);
  record.requestId = requestId;
  if (!record.createdAt) record.createdAt = new Date().toISOString();
  if (!record.lastUpdatedAt) record.lastUpdatedAt = record.createdAt;

  const row = REQUEST_HEADERS.map(function (h) { return clean_(record[headerToField_(h)]); });
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);

  return json_({ ok: true, requestId: requestId, duplicateFlag: !!duplicate, duplicateOf: duplicate || null });
}

/** Reads the highest existing "AMN-REQ-NNNNNN" in the sheet and returns the next one. */
function nextRequestId_(sheet) {
  const idCol = REQUEST_HEADERS.indexOf('Request ID') + 1;
  let max = 0;
  if (sheet.getLastRow() >= 2) {
    const ids = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1).getValues();
    ids.forEach(function (r) {
      const match = /^AMN-REQ-(\d+)$/.exec(String(r[0] || ''));
      if (match) max = Math.max(max, parseInt(match[1], 10));
    });
  }
  return 'AMN-REQ-' + String(max + 1).padStart(6, '0');
}

/**
 * updateRequestRow(byRequestId): finds the row with matching Request ID
 * in column 1 and overwrites it. Expects p.requestId and p.patch (a
 * partial AmanaRequest — only the fields present are changed).
 */
function handleUpdateRequest_(p) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureTab_(ss, 'Requests', REQUEST_HEADERS);
  const rowNum = findRowByColumnValue_(sheet, 1, p.requestId);
  if (!rowNum) return json_({ ok: false, error: 'request_not_found' });

  const current = sheet.getRange(rowNum, 1, 1, REQUEST_HEADERS.length).getValues()[0];
  const patch = p.patch || {};
  const updated = REQUEST_HEADERS.map(function (h, i) {
    const field = headerToField_(h);
    return Object.prototype.hasOwnProperty.call(patch, field) ? clean_(patch[field]) : current[i];
  });
  // Always bump Last Updated At.
  updated[REQUEST_HEADERS.indexOf('Last Updated At')] = new Date().toISOString();
  sheet.getRange(rowNum, 1, 1, updated.length).setValues([updated]);
  return json_({ ok: true });
}

/** findRequestBySessionId(): returns the Requests row linked to a bot Session ID, or null. */
function handleFindRequestBySession_(p) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureTab_(ss, 'Requests', REQUEST_HEADERS);
  const rowNum = findRowByColumnValue_(sheet, REQUEST_HEADERS.indexOf('Session ID') + 1, p.sessionId);
  if (!rowNum) return json_({ ok: true, record: null });
  const values = sheet.getRange(rowNum, 1, 1, REQUEST_HEADERS.length).getValues()[0];
  const record = {};
  REQUEST_HEADERS.forEach(function (h, i) { record[headerToField_(h)] = values[i]; });
  return json_({ ok: true, record: record });
}

/**
 * Duplicate detection: same normalized phone + same staff category,
 * created within the last 30 days. Returns the existing Request ID if
 * found, or null. Flags, never silently merges (Stage A2 point 3).
 */
function findDuplicateRequest_(sheet, phone, staffCategory) {
  if (!phone || sheet.getLastRow() < 2) return null;
  const phoneCol = REQUEST_HEADERS.indexOf('Client Phone');
  const categoryCol = REQUEST_HEADERS.indexOf('Staff Category');
  const createdCol = REQUEST_HEADERS.indexOf('Created At');
  const idCol = REQUEST_HEADERS.indexOf('Request ID');
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, REQUEST_HEADERS.length).getValues();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r[phoneCol] !== phone) continue;
    if (staffCategory && r[categoryCol] !== staffCategory) continue;
    const created = new Date(r[createdCol]);
    if (!isNaN(created) && created < cutoff) continue;
    return r[idCol];
  }
  return null;
}

/* ---------------- Bot Sessions tab ---------------- */

/** appendBotSession(): writes a new Bot Sessions row. Expects p.session shaped per BOT_SESSION_HEADERS. */
function handleAppendSession_(p) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureTab_(ss, 'Bot Sessions', BOT_SESSION_HEADERS);
  const s = p.session || {};
  const row = [
    clean_(s.sessionId), clean_(s.whatsappNumber), clean_(s.currentQuestion),
    clean_(JSON.stringify(s.capturedAnswers || {})), clean_(s.completionStatus),
    new Date().toISOString(), !!s.handoffFlag,
  ];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return json_({ ok: true });
}

/** updateBotSession(): finds by Session ID (column 1) and overwrites. Expects p.sessionId and p.patch. */
function handleUpdateSession_(p) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureTab_(ss, 'Bot Sessions', BOT_SESSION_HEADERS);
  const rowNum = findRowByColumnValue_(sheet, 1, p.sessionId);
  if (!rowNum) return json_({ ok: false, error: 'session_not_found' });

  const current = sheet.getRange(rowNum, 1, 1, BOT_SESSION_HEADERS.length).getValues()[0];
  const patch = p.patch || {};
  const fieldMap = {
    'Session ID': 'sessionId', 'WhatsApp Number': 'whatsappNumber', 'Current Question': 'currentQuestion',
    'Captured Answers (JSON)': 'capturedAnswers', 'Completion Status': 'completionStatus',
    'Last Message Time': 'lastMessageTime', 'Handoff Flag': 'handoffFlag',
  };
  const updated = BOT_SESSION_HEADERS.map(function (h, i) {
    const field = fieldMap[h];
    if (!Object.prototype.hasOwnProperty.call(patch, field)) return current[i];
    return field === 'capturedAnswers' ? JSON.stringify(patch[field]) : clean_(patch[field]);
  });
  updated[BOT_SESSION_HEADERS.indexOf('Last Message Time')] = new Date().toISOString();
  sheet.getRange(rowNum, 1, 1, updated.length).setValues([updated]);
  return json_({ ok: true });
}

/* ---------------- Automation Log ---------------- */

/** Any failure in any handler above should land here instead of failing silently (Stage A2 point 4). */
function logAutomationFailure_(workflowId, sourceRecord, err) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const sheet = ensureTab_(ss, 'Automation Log', AUTOMATION_LOG_HEADERS);
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 5).setValues([[
      new Date().toISOString(), workflowId, String(sourceRecord || ''), String(err && err.message || err), 0,
    ]]);
  } catch (x) {
    // If even the log write fails, there's nowhere left to report it but the execution log.
    Logger.log('Automation Log write failed: ' + x);
  }
}

/* ---------------- One-time setup (run manually) ---------------- */

/**
 * Run once from the Apps Script editor after setting CONFIG.SHEET_ID.
 * Creates all 7 tabs with their headers and a shared secret. Safe to re-run.
 */
function setup() {
  if (!CONFIG.SHEET_ID) {
    throw new Error('Set CONFIG.SHEET_ID to a real spreadsheet ID first (Stage A0 — create the spreadsheet).');
  }
  const props = PropertiesService.getScriptProperties();
  if (PRESET_SECRET) {
    props.setProperty('SECRET', PRESET_SECRET);
  } else if (!props.getProperty('SECRET')) {
    props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  }

  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  ensureTab_(ss, 'Requests', REQUEST_HEADERS);
  ensureTab_(ss, 'Bot Sessions', BOT_SESSION_HEADERS);
  ensureTab_(ss, 'Automation Log', AUTOMATION_LOG_HEADERS);
  Object.keys(DRAFT_TAB_HEADERS).forEach(function (name) {
    ensureTab_(ss, name, DRAFT_TAB_HEADERS[name]);
  });

  const def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);

  Logger.log('SECRET (add to Vercel as WHATSAPP_INTAKE_SECRET): ' + props.getProperty('SECRET'));
}

/* ---------------- Helpers ---------------- */

function ensureTab_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findRowByColumnValue_(sheet, col, value) {
  if (!value || sheet.getLastRow() < 2) return null;
  const values = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === value) return i + 2; // +2: 1-indexed, header row offset
  }
  return null;
}

/** 'Client Full Name' -> 'clientFullName', matching schema.js's field names. */
function headerToField_(header) {
  const words = header.replace(/[()]/g, '').split(' ');
  return words[0].toLowerCase() + words.slice(1).map(function (w) {
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join('');
}

function clean_(v) {
  const t = String(v == null ? '' : v);
  // Leading = + - @ can make a spreadsheet treat text as a formula.
  return /^\s*[=+\-@]/.test(t) ? "'" + t.trim() : t;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
