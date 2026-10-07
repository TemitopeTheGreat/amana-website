/**
 * Amana intake + dashboard backend (Google Apps Script).
 *
 * Receives form submissions from the website (via /api/lead on Vercel),
 * files them into tabs of the Google Sheet, saves uploaded CVs to Drive,
 * and emails a notification.
 *
 * Setup: see docs/INTAKE_SETUP.md
 */

const CONFIG = {
  SHEET_ID: '1UAz-RnjSZyHeLsM4V06vyy4ZTZISqDfaXCwL-yz9x9c',
  CV_FOLDER_NAME: 'Amana CVs',
  // One address, or several separated by commas, e.g. 'hello@amanastaff.com, ops@amanastaff.com'.
  // Leave empty to notify the script owner instead.
  NOTIFY_EMAIL: 'hello@amanastaff.com',
  MAX_CV_BYTES: 3 * 1024 * 1024,
};

// Optional: paste a fixed secret here (then use the same value in Vercel as APPS_SCRIPT_SECRET).
// Leave empty to have setup() generate one and print it in the log.
const PRESET_SECRET = '';

const STAGES = ['Identity', 'Police cert', 'Guarantors', 'References', 'Medical', 'Assessment', 'Training'];

const TABS = {
  professional: {
    name: 'Candidates',
    prefix: 'C',
    statuses: ['New', 'Contacted', 'In verification', 'In training', 'Approved', 'Placed', 'On hold', 'Rejected'],
    headers: ['ID', 'Submitted', 'Status', 'Name', 'Phone', 'Email', 'Role', 'Experience', 'Arrangement', 'Location', 'Notes', 'CV link']
      .concat(STAGES, ['Vetting progress', 'Assigned to', 'Internal notes', 'Last updated'])
      // Marketplace fields (Amana_Staff_Workflow_Automation_Hiyame_Integration_Team_Brief.docx,
      // section 4): the brief's "Candidates" tab spec, merged into this existing tab per the
      // user's decision rather than creating a second Candidates-named tab. "Display Name" is
      // the public-facing name shown in the marketplace (never the full legal Name) - the
      // brief's "Approved display name" (section 5.1) exists precisely so a client browsing
      // profiles doesn't see a candidate's full legal name. "Status" above already serves as
      // vetting status - not duplicated here. Empty until someone (Hiyame integration, or the
      // team by hand) fills them in - existing rows are unaffected (see migrateTabHeaders_).
      .concat(['Display Name', 'Salary Expectation', 'Availability', 'Marketplace Consent', 'Visibility'])
      // 'CRM Synced At' - ISO timestamp set by handleMarkCandidateSynced_ once
      // the admin dashboard's "Sync to CRM" button successfully posts this
      // candidate to the company CRM (api/admin-sync-candidate.js). Empty
      // means never synced. Appended via migrateTabHeaders_, same growth
      // path as the marketplace fields above - existing rows unaffected.
      .concat(['CRM Synced At']),
  },
  family: {
    name: 'Families',
    prefix: 'F',
    statuses: ['New', 'Contacted', 'Quote sent', 'Matching', 'Placed', 'Lost'],
    headers: ['ID', 'Submitted', 'Status', 'Name', 'Phone', 'Email', 'Role needed', 'Location', 'Plan', 'Notes', 'Assigned to', 'Internal notes', 'Last updated'],
  },
  organisation: {
    name: 'Organisations',
    prefix: 'O',
    statuses: ['New', 'Contacted', 'Proposal sent', 'Won', 'Lost'],
    headers: ['ID', 'Submitted', 'Status', 'Name', 'Phone', 'Email', 'Organisation type', 'Location', 'Notes', 'Assigned to', 'Internal notes', 'Last updated'],
  },
};

/* ---------------- Web app entry points ---------------- */

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === 'stats') return statsResponse_(params.secret);
  if (params.action === 'materials') return materialsResponse_(params.secret);
  return json_({ ok: true, service: 'amana-intake' });
}

function statsResponse_(secret) {
  const stored = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!stored || secret !== stored) return json_({ ok: false, error: 'unauthorized' });
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    return json_({
      ok: true,
      data: {
        generatedAt: new Date().toISOString(),
        candidates: summarizeTab_(ss, 'professional'),
        families: summarizeTab_(ss, 'family'),
        organisations: summarizeTab_(ss, 'organisation'),
        requests: summarizeRequests_(ss),
      },
    });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function summarizeTab_(ss, kind) {
  const def = TABS[kind];
  const sheet = ss.getSheetByName(def.name);
  const idx = {};
  def.headers.forEach(function (h, i) { idx[h] = i; });
  const roleKey = idx['Role'] !== undefined ? 'Role' : (idx['Role needed'] !== undefined ? 'Role needed' : 'Organisation type');
  const tz = Session.getScriptTimeZone();

  const rows = (!sheet || sheet.getLastRow() < 2)
    ? []
    : sheet.getRange(2, 1, sheet.getLastRow() - 1, def.headers.length).getValues().filter(function (r) { return r[idx.ID]; });

  const statusCounts = {};
  def.statuses.forEach(function (s) { statusCounts[s] = 0; });
  const roleCounts = {};
  const weekCounts = {};

  rows.forEach(function (r) {
    const status = r[idx.Status];
    if (Object.prototype.hasOwnProperty.call(statusCounts, status)) statusCounts[status]++;
    const role = r[idx[roleKey]];
    if (role) roleCounts[role] = (roleCounts[role] || 0) + 1;
    const submitted = r[idx.Submitted];
    if (submitted instanceof Date) {
      const monday = new Date(submitted);
      monday.setHours(0, 0, 0, 0);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const key = Utilities.formatDate(monday, tz, 'yyyy-MM-dd');
      weekCounts[key] = (weekCounts[key] || 0) + 1;
    }
  });

  const latest = rows.slice()
    .sort(function (a, b) { return new Date(b[idx.Submitted]) - new Date(a[idx.Submitted]); })
    .slice(0, 300)
    .map(function (r) {
      const o = {};
      def.headers.forEach(function (h, i) {
        const v = r[i];
        o[h] = (v instanceof Date) ? Utilities.formatDate(v, tz, 'dd MMM yyyy, HH:mm') : v;
      });
      return o;
    });

  return { total: rows.length, statusCounts: statusCounts, roleCounts: roleCounts, weekCounts: weekCounts, latest: latest };
}

/* ================= WhatsApp-intake "Request Staff" flow ================= */
/* See whatsapp-intake/README.md. Separate tabs (Requests, Bot Sessions,     */
/* Automation Log) in this SAME spreadsheet — not a separate project.        */
/* Request IDs use the same AM-<PREFIX>-#### convention as nextId_() below,  */
/* via nextId_('REQ'), instead of the AMN-REQ-###### format floated in an    */
/* earlier draft, so every ID in this sheet looks consistent.                */

const REQUEST_STATUSES = [
  'Incomplete', 'New', 'Awaiting Clarification', 'Confirmed',
  'Sourcing', 'Shortlisting', 'Client Review', 'Interview', 'Candidate Selected',
  'Awaiting Payment', 'Payment Confirmed',
  'Placement in Progress', 'Fulfilled', 'Cancelled', 'On Hold',
];

// Column headers, Title Case. Must match whatsapp-intake/schema.js's FIELD_ORDER
// field-for-field (headerToField_ below converts between the two) — if you add
// or rename a field there, make the same change here.
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

/* ================= Admin accounts (super / general roles) ================= */
/* A named account per staff member, instead of one shared ADMIN_PASSWORD.    */
/* Only a hash+salt (Node's scrypt, computed in api/admin-login.js) is ever   */
/* stored here - this script never sees or stores a plaintext password.      */
/* The "owner" break-glass login (api/admin-login.js) still uses             */
/* ADMIN_PASSWORD directly and never touches this tab, so the business       */
/* owner can always get in even if this tab or a named account has a         */
/* problem.                                                                  */

const ADMIN_USER_HEADERS = [
  'Username', 'Role', 'Password Hash', 'Password Salt', 'Active',
  'Failed Attempts', 'Locked Until', 'Created At', 'Created By', 'Last Login At',
];

function summarizeRequests_(ss) {
  const sheet = ss.getSheetByName('Requests');
  const idx = {};
  REQUEST_HEADERS.forEach(function (h, i) { idx[h] = i; });
  const tz = Session.getScriptTimeZone();

  const rows = (!sheet || sheet.getLastRow() < 2)
    ? []
    : sheet.getRange(2, 1, sheet.getLastRow() - 1, REQUEST_HEADERS.length).getValues().filter(function (r) { return r[idx['Request ID']]; });

  const statusCounts = {};
  REQUEST_STATUSES.forEach(function (s) { statusCounts[s] = 0; });
  const categoryCounts = {};
  const weekCounts = {};

  rows.forEach(function (r) {
    const status = r[idx['Status']];
    if (Object.prototype.hasOwnProperty.call(statusCounts, status)) statusCounts[status]++;
    const cat = r[idx['Staff Category']];
    if (cat) categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    const created = r[idx['Created At']];
    const d = created instanceof Date ? created : new Date(created);
    if (!isNaN(d)) {
      const monday = new Date(d);
      monday.setHours(0, 0, 0, 0);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const key = Utilities.formatDate(monday, tz, 'yyyy-MM-dd');
      weekCounts[key] = (weekCounts[key] || 0) + 1;
    }
  });

  const latest = rows.slice()
    .sort(function (a, b) { return new Date(b[idx['Created At']]) - new Date(a[idx['Created At']]); })
    .slice(0, 300)
    .map(function (r) {
      const o = {};
      REQUEST_HEADERS.forEach(function (h, i) { o[h] = r[i]; });
      return o;
    });

  return { total: rows.length, statusCounts: statusCounts, categoryCounts: categoryCounts, weekCounts: weekCounts, latest: latest };
}

/**
 * appendRequestRow(): writes a new Requests row, generating the Request
 * ID itself via nextId_('REQ') — never trusts a client-supplied one, so
 * two concurrent callers can't collide. Runs duplicate detection first
 * (same phone + overlapping staff category within the last 30 days) and
 * returns the flag rather than blocking — the caller decides what to do
 * with a flagged duplicate. Notifies NOTIFY_EMAIL and auto-replies to
 * the client, same as the professional/family/organisation flow above;
 * the admin dashboard also surfaces new requests on next refresh.
 */
function handleAppendRequest_(p) {
  const record = p.record || {};
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureRequestsTab_(ss);

  const duplicate = findDuplicateRequest_(sheet, record.clientPhone, record.staffCategory);
  const requestId = nextId_('REQ');
  record.requestId = requestId;
  record.createdAt = new Date().toISOString();
  record.lastUpdatedAt = record.createdAt;
  if (!record.status) record.status = 'New';

  const row = REQUEST_HEADERS.map(function (h) { return clean_(record[headerToField_(h)]); });
  const r = sheet.getLastRow() + 1;
  sheet.getRange(r, 1, 1, row.length).setNumberFormat('@');
  sheet.getRange(r, 1, 1, row.length).setValues([row]);

  // Email sending moved to the separate notifyRequestSubmitted action
  // (see handleNotifyRequestSubmitted_) - same reasoning as the
  // professional/family/organisation flow's handleNotifySubmission_: two
  // synchronous MailApp sends here were adding real seconds to every
  // Request Staff submission before the visitor saw "success."
  return json_({ ok: true, requestId: requestId, duplicateFlag: !!duplicate, duplicateOf: duplicate || null });
}

function handleUpdateRequest_(p) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureRequestsTab_(ss);
  const rowNum = findRowByColumnValue_(sheet, 1, p.requestId);
  if (!rowNum) return json_({ ok: false, error: 'request_not_found' });

  const current = sheet.getRange(rowNum, 1, 1, REQUEST_HEADERS.length).getValues()[0];
  const patch = p.patch || {};
  const updated = REQUEST_HEADERS.map(function (h, i) {
    const field = headerToField_(h);
    return Object.prototype.hasOwnProperty.call(patch, field) ? clean_(patch[field]) : current[i];
  });
  updated[REQUEST_HEADERS.indexOf('Last Updated At')] = new Date().toISOString();
  sheet.getRange(rowNum, 1, 1, updated.length).setValues([updated]);
  return json_({ ok: true });
}

function handleFindRequestBySession_(p) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureRequestsTab_(ss);
  const rowNum = findRowByColumnValue_(sheet, REQUEST_HEADERS.indexOf('Session ID') + 1, p.sessionId);
  if (!rowNum) return json_({ ok: true, record: null });
  const values = sheet.getRange(rowNum, 1, 1, REQUEST_HEADERS.length).getValues()[0];
  const record = {};
  REQUEST_HEADERS.forEach(function (h, i) { record[headerToField_(h)] = values[i]; });
  return json_({ ok: true, record: record });
}

/**
 * deleteRequest(): removes a Requests row by Request ID. Secret-gated
 * like every other action (see doPost) - not exposed to the public
 * website, only usable by whoever holds APPS_SCRIPT_SECRET. Exists so
 * test/junk rows (e.g. from end-to-end testing) can be cleaned up
 * without hand-editing the live sheet every time.
 */
function handleDeleteRequest_(p) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureRequestsTab_(ss);
  const rowNum = findRowByColumnValue_(sheet, 1, p.requestId);
  if (!rowNum) return json_({ ok: false, error: 'request_not_found' });
  sheet.deleteRow(rowNum);
  return json_({ ok: true });
}

/**
 * markCandidateSynced(): stamps 'CRM Synced At' on a Candidates row once
 * api/admin-sync-candidate.js has successfully posted that candidate to
 * the company CRM's webhook. Secret-gated like every other doPost action -
 * the admin dashboard never talks to this script directly, only through
 * that password-gated Vercel function (see whatsapp-intake/README.md's
 * pattern for why secrets never reach the browser).
 */
function handleMarkCandidateSynced_(p) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureTab_(ss, 'professional');
  const idCol = TABS.professional.headers.indexOf('ID') + 1;
  const rowNum = findRowByColumnValue_(sheet, idCol, p.candidateId);
  if (!rowNum) return json_({ ok: false, error: 'candidate_not_found' });
  const syncCol = TABS.professional.headers.indexOf('CRM Synced At') + 1;
  sheet.getRange(rowNum, syncCol).setValue(new Date().toISOString());
  return json_({ ok: true });
}

/**
 * notifySubmission(): sends the admin-alert + submitter-confirmation
 * emails for a professional/family/organisation row that's already been
 * written. Split out from the main doPost flow (see the comment at its
 * `return json_({ ok: true, id: id, cvLink: cvLink })` line) purely for
 * speed - api/lead.js calls this AFTER it has already responded to the
 * browser, so the two MailApp sends never make a visitor wait. Secret-
 * gated like every other action; best-effort - the row this refers to
 * is already safely saved by the time this runs, so a failure here just
 * means a missed email, not lost data.
 */
function handleNotifySubmission_(p) {
  const kind = TABS[p.kind] ? p.kind : 'family';
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(TABS[kind].name);
  const sheetUrl = sheet ? ss.getUrl() + '#gid=' + sheet.getSheetId() : ss.getUrl();
  notify_(kind, p.id, p, p.cvLink || '', sheetUrl);
  confirmSubmitter_(kind, p);
  return json_({ ok: true });
}

/** Same idea as handleNotifySubmission_, for the Request Staff flow. */
function handleNotifyRequestSubmitted_(p) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureRequestsTab_(ss);
  const record = p.record || {};
  notifyRequest_(record.requestId, record, ss.getUrl() + '#gid=' + sheet.getSheetId());
  confirmRequestSubmitter_(record);
  return json_({ ok: true });
}

function ensureAdminUsersTab_(ss) {
  let sheet = ss.getSheetByName('Admin Users');
  if (sheet) return sheet;
  sheet = ss.insertSheet('Admin Users');
  const n = ADMIN_USER_HEADERS.length;
  sheet.getRange(1, 1, 1, n).setValues([ADMIN_USER_HEADERS]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0b1d2e');
  sheet.setFrozenRows(1);
  sheet.getRange(2, ADMIN_USER_HEADERS.indexOf('Active') + 1, 1000, 1).insertCheckboxes();
  const roleRule = SpreadsheetApp.newDataValidation().requireValueInList(['super', 'general'], true).setAllowInvalid(false).build();
  sheet.getRange(2, ADMIN_USER_HEADERS.indexOf('Role') + 1, 1000, 1).setDataValidation(roleRule);
  sheet.setColumnWidths(1, n, 150);
  return sheet;
}

// Returns { role, passwordHash, passwordSalt, active, lockedUntil } for a
// username, or { user: null } if no such account exists. Usernames are
// always stored and looked up lower-cased, so lookups are case-insensitive
// without needing a separate search helper. api/admin-login.js does the
// actual password comparison - this never receives a plaintext password.
function handleGetAdminUser_(p) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureAdminUsersTab_(ss);
  const username = String(p.username || '').trim().toLowerCase();
  const rowNum = findRowByColumnValue_(sheet, ADMIN_USER_HEADERS.indexOf('Username') + 1, username);
  if (!rowNum) return json_({ ok: true, user: null });
  const values = sheet.getRange(rowNum, 1, 1, ADMIN_USER_HEADERS.length).getValues()[0];
  const idx = {};
  ADMIN_USER_HEADERS.forEach(function (h, i) { idx[h] = i; });
  const lockedUntilRaw = values[idx['Locked Until']];
  const lockedUntil = lockedUntilRaw ? new Date(lockedUntilRaw).getTime() : null;
  return json_({
    ok: true,
    user: {
      role: values[idx['Role']],
      passwordHash: values[idx['Password Hash']],
      passwordSalt: values[idx['Password Salt']],
      active: values[idx['Active']] === true,
      lockedUntil: (lockedUntil && !isNaN(lockedUntil)) ? lockedUntil : null,
    },
  });
}

// Creates a named admin account. `passwordHash`/`passwordSalt` must
// already be computed (Node's scrypt, in api/admin-login.js's sibling
// api/admin-create-user.js) - this script only ever stores them.
function handleCreateAdminUser_(p) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureAdminUsersTab_(ss);
  const username = String(p.username || '').trim().toLowerCase();
  if (!username) return json_({ ok: false, error: 'username_required' });
  if (findRowByColumnValue_(sheet, ADMIN_USER_HEADERS.indexOf('Username') + 1, username)) {
    return json_({ ok: false, error: 'username_taken' });
  }
  const role = p.role === 'super' ? 'super' : 'general';
  const row = ADMIN_USER_HEADERS.map(function (h) {
    if (h === 'Username') return username;
    if (h === 'Role') return role;
    if (h === 'Password Hash') return p.passwordHash;
    if (h === 'Password Salt') return p.passwordSalt;
    if (h === 'Active') return true;
    if (h === 'Failed Attempts') return 0;
    if (h === 'Created At') return new Date().toISOString();
    if (h === 'Created By') return clean_(p.createdBy);
    return '';
  });
  // Checkboxes for the Active column were already applied to rows 2-1000
  // when the tab was created (ensureAdminUsersTab_), so a new row inside
  // that range renders correctly without redoing it here.
  const r = sheet.getLastRow() + 1;
  sheet.getRange(r, 1, 1, row.length).setNumberFormat('@');
  sheet.getRange(r, 1, 1, row.length).setValues([row]);
  return json_({ ok: true });
}

// Lists every admin account for the Manage Users page - deliberately
// excludes Password Hash/Salt, since this response is relayed to the
// browser (api/admin-list-users.js).
function handleListAdminUsers_(p) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureAdminUsersTab_(ss);
  const idx = {};
  ADMIN_USER_HEADERS.forEach(function (h, i) { idx[h] = i; });
  const rows = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, ADMIN_USER_HEADERS.length).getValues();
  const toIso = function (v) { return v instanceof Date ? v.toISOString() : (v || ''); };
  const users = rows.filter(function (r) { return r[idx['Username']]; }).map(function (r) {
    return {
      username: r[idx['Username']],
      role: r[idx['Role']],
      active: r[idx['Active']] === true,
      createdAt: toIso(r[idx['Created At']]),
      createdBy: r[idx['Created By']],
      lastLoginAt: toIso(r[idx['Last Login At']]),
    };
  });
  return json_({ ok: true, users: users });
}

function handleSetAdminUserActive_(p) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureAdminUsersTab_(ss);
  const username = String(p.username || '').trim().toLowerCase();
  const rowNum = findRowByColumnValue_(sheet, ADMIN_USER_HEADERS.indexOf('Username') + 1, username);
  if (!rowNum) return json_({ ok: false, error: 'user_not_found' });
  sheet.getRange(rowNum, ADMIN_USER_HEADERS.indexOf('Active') + 1).setValue(!!p.active);
  return json_({ ok: true });
}

// Tracks failed logins per account and locks it for 15 minutes after 5
// in a row - resets on any successful login. Only applies to named
// accounts; the "owner" break-glass login has no sheet row to track
// against (api/admin-login.js throttles it with a fixed delay instead).
function handleRecordLoginAttempt_(p) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureAdminUsersTab_(ss);
  const username = String(p.username || '').trim().toLowerCase();
  const rowNum = findRowByColumnValue_(sheet, ADMIN_USER_HEADERS.indexOf('Username') + 1, username);
  if (!rowNum) return json_({ ok: true });
  const col = function (h) { return ADMIN_USER_HEADERS.indexOf(h) + 1; };
  if (p.success) {
    sheet.getRange(rowNum, col('Failed Attempts')).setValue(0);
    sheet.getRange(rowNum, col('Locked Until')).setValue('');
    sheet.getRange(rowNum, col('Last Login At')).setValue(new Date().toISOString());
  } else {
    const attempts = Number(sheet.getRange(rowNum, col('Failed Attempts')).getValue() || 0) + 1;
    sheet.getRange(rowNum, col('Failed Attempts')).setValue(attempts);
    if (attempts >= 5) {
      sheet.getRange(rowNum, col('Locked Until')).setValue(new Date(Date.now() + 15 * 60 * 1000).toISOString());
    }
  }
  return json_({ ok: true });
}

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

function handleAppendSession_(p) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureBotSessionsTab_(ss);
  const s = p.session || {};
  const row = [
    clean_(s.sessionId), clean_(s.whatsappNumber), clean_(s.currentQuestion),
    clean_(JSON.stringify(s.capturedAnswers || {})), clean_(s.completionStatus),
    new Date().toISOString(), !!s.handoffFlag,
  ];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return json_({ ok: true });
}

function handleUpdateSession_(p) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ensureBotSessionsTab_(ss);
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

function logAutomationFailure_(workflowId, sourceRecord, err) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const sheet = ensureAutomationLogTab_(ss);
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 5).setValues([[
      new Date().toISOString(), workflowId, String(sourceRecord || ''), String(err && err.message || err), 0,
    ]]);
  } catch (x) {
    Logger.log('Automation Log write failed: ' + x);
  }
}

function notifyRequest_(requestId, record, sheetUrl) {
  const to = CONFIG.NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  if (!to) return;
  const lines = [
    'New staff request (' + requestId + ')', '',
    'Client: ' + record.clientFullName,
    'Phone: ' + record.clientPhone,
    'Type: ' + record.clientType,
    'Staff category: ' + record.staffCategory + ' x' + record.numberRequired,
    'Location: ' + [record.area, record.lga, record.state].filter(Boolean).join(', '),
  ];
  if (record.urgency) lines.push('Urgency: ' + record.urgency);
  if (record.notes) lines.push('', 'Notes: ' + record.notes);
  lines.push('', 'Open the sheet: ' + sheetUrl);
  MailApp.sendEmail({ to: to, subject: 'New staff request: ' + record.clientFullName, body: lines.join('\n'), name: 'Amana' });
}

function confirmRequestSubmitter_(record) {
  const email = clean_(record.clientEmail);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  const first = (clean_(record.clientFullName).split(' ')[0]) || 'there';
  MailApp.sendEmail({
    to: email,
    subject: 'Amana — we received your request (' + record.requestId + ')',
    body: 'Hi ' + first + ',\n\nThanks for your request. Your reference is ' + record.requestId + '. A member of the Amana team will be in touch.\n\nThe Amana team',
    name: 'Amana',
  });
}

function ensureRequestsTab_(ss) {
  let sheet = ss.getSheetByName('Requests');
  if (sheet) return sheet;
  sheet = ss.insertSheet('Requests');
  const n = REQUEST_HEADERS.length;
  sheet.getRange(1, 1, 1, n).setValues([REQUEST_HEADERS]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0b1d2e');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(3);
  const statusCol = REQUEST_HEADERS.indexOf('Status') + 1;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(REQUEST_STATUSES, true).setAllowInvalid(false).build();
  sheet.getRange(2, statusCol, 1000, 1).setDataValidation(rule);
  sheet.getRange(1, 1, 1000, n).createFilter();
  return sheet;
}

function ensureBotSessionsTab_(ss) {
  let sheet = ss.getSheetByName('Bot Sessions');
  if (sheet) return sheet;
  sheet = ss.insertSheet('Bot Sessions');
  sheet.getRange(1, 1, 1, BOT_SESSION_HEADERS.length).setValues([BOT_SESSION_HEADERS]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0b1d2e');
  sheet.setFrozenRows(1);
  return sheet;
}

function ensureAutomationLogTab_(ss) {
  let sheet = ss.getSheetByName('Automation Log');
  if (sheet) return sheet;
  sheet = ss.insertSheet('Automation Log');
  sheet.getRange(1, 1, 1, AUTOMATION_LOG_HEADERS.length).setValues([AUTOMATION_LOG_HEADERS]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0b1d2e');
  sheet.setFrozenRows(1);
  return sheet;
}

// The brief's remaining Section 4 tabs (Shortlists, Placements, Lists &
// Settings) - empty data model prepared now, same as Requests/Bot
// Sessions/Automation Log, ready for when Hiyame integration (or manual
// recruiter use) starts writing to them. No UI reads/writes these yet.
const SHORTLIST_HEADERS = ['Shortlist ID', 'Request ID', 'Candidate ID', 'Proposed Date', 'Recruiter', 'Client Response', 'Interview Status'];
const PLACEMENT_HEADERS = ['Placement ID', 'Request ID', 'Candidate ID', 'Client', 'Start Date', 'Agreed Salary', 'Fee', 'Payment Status', 'Placement Status'];
const LISTS_SETTINGS_HEADERS = ['List Name', 'Value', 'Notes'];

function ensureShortlistsTab_(ss) {
  let sheet = ss.getSheetByName('Shortlists');
  if (sheet) return sheet;
  sheet = ss.insertSheet('Shortlists');
  sheet.getRange(1, 1, 1, SHORTLIST_HEADERS.length).setValues([SHORTLIST_HEADERS]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0b1d2e');
  sheet.setFrozenRows(1);
  return sheet;
}

function ensurePlacementsTab_(ss) {
  let sheet = ss.getSheetByName('Placements');
  if (sheet) return sheet;
  sheet = ss.insertSheet('Placements');
  sheet.getRange(1, 1, 1, PLACEMENT_HEADERS.length).setValues([PLACEMENT_HEADERS]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0b1d2e');
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * "Lists & Settings" (brief section 4: "Controlled values for dropdowns -
 * Categories, statuses, states, employment types, urgency levels,
 * recruiter names"). A simple List Name / Value / Notes layout so the
 * team can maintain these by hand in the sheet; pre-populated with the
 * values already hardcoded elsewhere in this script (STAFF_CATEGORIES-
 * equivalent roles, REQUEST_STATUSES, etc.) so it starts as documentation
 * of what's already enforced, not a second source of truth the code
 * would need to read from to stay accurate.
 */
function ensureListsSettingsTab_(ss) {
  let sheet = ss.getSheetByName('Lists & Settings');
  if (sheet) return sheet;
  sheet = ss.insertSheet('Lists & Settings');
  sheet.getRange(1, 1, 1, LISTS_SETTINGS_HEADERS.length).setValues([LISTS_SETTINGS_HEADERS]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0b1d2e');
  sheet.setFrozenRows(1);

  const rows = [];
  ['Nanny', 'Housekeeper', 'Cook', 'Cleaner', 'Driver', 'Other'].forEach(function (v) { rows.push(['Staff Category', v, 'Requests tab - enforced in code (constants.js)']); });
  REQUEST_STATUSES.forEach(function (v) { rows.push(['Request Status', v, 'Requests tab - enforced in code (REQUEST_STATUSES)']); });
  TABS.professional.statuses.forEach(function (v) { rows.push(['Candidate Status', v, 'Candidates tab - enforced in code (TABS.professional.statuses)']); });
  TABS.family.statuses.forEach(function (v) { rows.push(['Family Request Status', v, 'Families tab - enforced in code (TABS.family.statuses)']); });
  TABS.organisation.statuses.forEach(function (v) { rows.push(['Organisation Status', v, 'Organisations tab - enforced in code (TABS.organisation.statuses)']); });
  if (rows.length) sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  sheet.autoResizeColumns(1, 3);
  return sheet;
}

function findRowByColumnValue_(sheet, col, value) {
  if (!value || sheet.getLastRow() < 2) return null;
  const values = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === value) return i + 2;
  }
  return null;
}

/** 'Client Full Name' -> 'clientFullName', matching whatsapp-intake/schema.js's field names. */
function headerToField_(header) {
  const words = header.replace(/[()]/g, '').split(' ');
  return words[0].toLowerCase() + words.slice(1).map(function (w) {
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join('');
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const p = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || p.secret !== secret) return json_({ ok: false, error: 'unauthorized' });

    // WhatsApp-intake "Request Staff" flow (whatsapp-intake/README.md) — routed by
    // action, not kind, so it doesn't collide with the professional/family/
    // organisation lead flow below.
    if (p.action === 'appendRequest') return handleAppendRequest_(p);
    if (p.action === 'updateRequest') return handleUpdateRequest_(p);
    if (p.action === 'findRequestBySession') return handleFindRequestBySession_(p);
    if (p.action === 'deleteRequest') return handleDeleteRequest_(p);
    if (p.action === 'appendSession') return handleAppendSession_(p);
    if (p.action === 'updateSession') return handleUpdateSession_(p);
    if (p.action === 'markCandidateSynced') return handleMarkCandidateSynced_(p);
    if (p.action === 'notifySubmission') return handleNotifySubmission_(p);
    if (p.action === 'notifyRequestSubmitted') return handleNotifyRequestSubmitted_(p);
    if (p.action === 'getAdminUser') return handleGetAdminUser_(p);
    if (p.action === 'createAdminUser') return handleCreateAdminUser_(p);
    if (p.action === 'listAdminUsers') return handleListAdminUsers_(p);
    if (p.action === 'setAdminUserActive') return handleSetAdminUserActive_(p);
    if (p.action === 'recordLoginAttempt') return handleRecordLoginAttempt_(p);

    if (p.kind === 'training_access') return logTrainingAccess_(p);

    const kind = TABS[p.kind] ? p.kind : 'family';
    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const sheet = ensureTab_(ss, kind);
    const id = nextId_(TABS[kind].prefix);
    const now = new Date();

    let cvLink = '';
    if (kind === 'professional' && p.cv && p.cv.data) {
      cvLink = saveCv_(id, p.cv);
    }

    const t = clean_;
    let row;
    if (kind === 'professional') {
      row = [id, now, 'New', t(p.name), t(p.phone), t(p.email), t(p.need), t(p.experience), t(p.arrangement), t(p.location), t(p.message), cvLink];
    } else if (kind === 'family') {
      row = [id, now, 'New', t(p.name), t(p.phone), t(p.email), t(p.need), t(p.location), t(p.plan), t(p.message)];
    } else {
      row = [id, now, 'New', t(p.name), t(p.phone), t(p.email), t(p.need), t(p.location), t(p.message)];
    }
    // Write as text (keeps leading zeros in phone numbers, never parses formulas).
    const r = sheet.getLastRow() + 1;
    sheet.getRange(r, 1, 1, row.length).setNumberFormat('@');
    sheet.getRange(r, 2).setNumberFormat('dd mmm yyyy hh:mm');
    sheet.getRange(r, 1, 1, row.length).setValues([row]);

    if (kind === 'professional') {
      const first = TABS.professional.headers.indexOf(STAGES[0]) + 1;
      sheet.getRange(r, first, 1, STAGES.length).insertCheckboxes();
      const a = colLetter_(first);
      const b = colLetter_(first + STAGES.length - 1);
      sheet.getRange(r, first + STAGES.length).setFormula('=COUNTIF(' + a + r + ':' + b + r + ',TRUE)&" of ' + STAGES.length + '"');
    }
    const updatedCol = TABS[kind].headers.length;
    sheet.getRange(r, updatedCol).setValue(now);

    // Email sending moved out of this request (see handleNotifySubmission_
    // below) - MailApp.sendEmail is a real network round trip, and doing
    // two of them here before responding was adding multiple seconds to
    // every form submission that the visitor had to sit through for no
    // benefit to them. The row is already safely written at this point;
    // api/lead.js fires the notification as a second, separate call after
    // it has already told the browser the submission succeeded.
    return json_({ ok: true, id: id, cvLink: cvLink });
  } catch (err) {
    try {
      const p2 = JSON.parse((e && e.postData && e.postData.contents) || '{}');
      logAutomationFailure_(p2.action || p2.kind || 'doPost', p2.record && p2.record.clientPhone || p2.phone || '', err);
    } catch (x) { /* best effort */ }
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* not held */ }
  }
}

/* ---------------- One-time setup (run manually) ---------------- */

/**
 * Run this once from the Apps Script editor. It builds the tabs, dropdowns,
 * colours and the Dashboard tab, and creates the shared secret.
 * The secret is printed in the Execution log: copy it into Vercel as APPS_SCRIPT_SECRET.
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (PRESET_SECRET) {
    props.setProperty('SECRET', PRESET_SECRET);
  } else if (!props.getProperty('SECRET')) {
    props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  }
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  Object.keys(TABS).forEach(function (k) { ensureTab_(ss, k); });
  ensureTrainingSheets_(ss);
  ensureRequestsTab_(ss);
  ensureBotSessionsTab_(ss);
  ensureAutomationLogTab_(ss);
  ensureShortlistsTab_(ss);
  ensurePlacementsTab_(ss);
  ensureListsSettingsTab_(ss);
  ensureAdminUsersTab_(ss);
  polish();

  // Remove the default empty tab if it is still there.
  const def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);

  ss.setActiveSheet(ss.getSheetByName('Dashboard'));
  Logger.log('SECRET (add to Vercel as APPS_SCRIPT_SECRET): ' + props.getProperty('SECRET'));
}

/* ---------------- Academy training portal ---------------- */

const TRAINING_MATERIALS_HEADERS = ['Module', 'Title', 'Type', 'URL', 'Notes'];
const TRAINING_ACCESS_HEADERS = ['Timestamp', 'Name', 'Email', 'Page'];

// Creates the two training-portal sheets if they don't exist yet. Safe to re-run.
function ensureTrainingSheets_(ss) {
  if (!ss.getSheetByName('Training Materials')) {
    const m = ss.insertSheet('Training Materials');
    m.getRange(1, 1, 1, TRAINING_MATERIALS_HEADERS.length).setValues([TRAINING_MATERIALS_HEADERS])
      .setFontWeight('bold').setFontColor('#ffffff').setBackground('#0b1d2e');
    m.setFrozenRows(1);
    m.setColumnWidths(1, TRAINING_MATERIALS_HEADERS.length, 220);
    // Example rows so the format is obvious. Replace Module/Title/URL with real content,
    // then delete these two rows (or leave them, "EXAMPLE" is easy to spot and delete).
    m.getRange(2, 1, 2, 5).setValues([
      ['Household hygiene & safety', 'EXAMPLE — Module 1 handbook (PDF)', 'PDF', 'https://drive.google.com/...', 'Replace with your real Drive link'],
      ['Household hygiene & safety', 'EXAMPLE — Module 1 video walkthrough', 'Video', 'https://youtube.com/...', 'Replace with your real video link'],
    ]);
    m.getRange(2, 1, 2, 5).setFontColor('#9a9a9a').setFontStyle('italic');
    m.getRange(1, 1, 1000, TRAINING_MATERIALS_HEADERS.length).createFilter();
  }
  if (!ss.getSheetByName('Training Access')) {
    const a = ss.insertSheet('Training Access');
    a.getRange(1, 1, 1, TRAINING_ACCESS_HEADERS.length).setValues([TRAINING_ACCESS_HEADERS])
      .setFontWeight('bold').setFontColor('#ffffff').setBackground('#0b1d2e');
    a.setFrozenRows(1);
    a.setColumnWidths(1, TRAINING_ACCESS_HEADERS.length, 200);
  }
}

// GET ?action=materials&secret=... — returns the published training materials, grouped by module.
// Reads the "Training Materials" sheet so Amana staff can add content there directly, without a
// code change. Rows whose Title starts with "EXAMPLE" are skipped.
function materialsResponse_(secret) {
  const stored = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!stored || secret !== stored) return json_({ ok: false, error: 'unauthorized' });
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const sheet = ss.getSheetByName('Training Materials');
    const rows = (!sheet || sheet.getLastRow() < 2) ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, TRAINING_MATERIALS_HEADERS.length).getValues();
    const byModule = {};
    const order = [];
    rows.forEach(function (r) {
      const module = String(r[0] || '').trim();
      const title = String(r[1] || '').trim();
      if (!module || !title || /^EXAMPLE/i.test(title)) return;
      if (!byModule[module]) { byModule[module] = []; order.push(module); }
      byModule[module].push({ title: title, type: String(r[2] || '').trim(), url: String(r[3] || '').trim(), notes: String(r[4] || '').trim() });
    });
    const modules = order.map(function (m) { return { module: m, items: byModule[m] }; });
    return json_({ ok: true, data: { modules: modules } });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// POST {kind:'training_access', secret, name, email, page} — logs who opened the training portal.
function logTrainingAccess_(p) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    ensureTrainingSheets_(ss);
    const sheet = ss.getSheetByName('Training Access');
    const row = [new Date(), clean_(p.name), clean_(p.email), clean_(p.page)];
    const r = sheet.getLastRow() + 1;
    sheet.getRange(r, 1, 1, row.length).setNumberFormat('@');
    sheet.getRange(r, 1).setNumberFormat('dd mmm yyyy hh:mm');
    sheet.getRange(r, 1, 1, row.length).setValues([row]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ---------------- Helpers ---------------- */

const CHECKBOX_FIELDS = ['Marketplace Consent', 'Visibility'];

function ensureTab_(ss, kind) {
  const def = TABS[kind];
  let sheet = ss.getSheetByName(def.name);
  if (sheet) { migrateTabHeaders_(sheet, def); return sheet; }

  sheet = ss.insertSheet(def.name);
  const n = def.headers.length;
  const head = sheet.getRange(1, 1, 1, n);
  head.setValues([def.headers]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0b1d2e');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(4);
  sheet.setColumnWidths(1, n, 130);
  sheet.setColumnWidth(def.headers.indexOf('Notes') + 1, 260);

  const statusCol = def.headers.indexOf('Status') + 1;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(def.statuses, true).setAllowInvalid(false).build();
  sheet.getRange(2, statusCol, 1000, 1).setDataValidation(rule);

  // Plain-text format on user-input columns: values are stored verbatim, never parsed as formulas.
  const skipText = ['Submitted', 'Status', 'Last updated', 'Vetting progress'].concat(STAGES, CHECKBOX_FIELDS);
  def.headers.forEach(function (h, i) {
    if (skipText.indexOf(h) === -1) sheet.getRange(2, i + 1, 1000, 1).setNumberFormat('@');
  });
  CHECKBOX_FIELDS.forEach(function (h) {
    const i = def.headers.indexOf(h);
    if (i !== -1) sheet.getRange(2, i + 1, 1000, 1).insertCheckboxes();
  });

  const dateFmt = 'dd mmm yyyy hh:mm';
  sheet.getRange(2, 2, 1000, 1).setNumberFormat(dateFmt);
  const lastUpdatedCol = def.headers.indexOf('Last updated') + 1;
  if (lastUpdatedCol > 0) sheet.getRange(2, lastUpdatedCol, 1000, 1).setNumberFormat(dateFmt);

  const statusRange = sheet.getRange(2, statusCol, 1000, 1);
  const rules = [];
  const colour = function (text, bg, fg) {
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(bg).setFontColor(fg).setRanges([statusRange]).build());
  };
  colour('New', '#fdecc8', '#7a4b00');
  ['Approved', 'Placed', 'Won'].forEach(function (s) { colour(s, '#d7efdc', '#14532d'); });
  ['Rejected', 'Lost'].forEach(function (s) { colour(s, '#e5e7eb', '#4b5563'); });
  sheet.setConditionalFormatRules(rules);

  sheet.getRange(1, 1, 1000, n).createFilter();
  return sheet;
}

/**
 * Appends any headers from `def.headers` that aren't already present in an
 * EXISTING sheet, as new columns at the end - never touches existing
 * columns or data. Lets a tab's schema grow (e.g. the Candidates tab
 * gaining marketplace fields, Amana_Staff_Workflow_Automation_Hiyame_
 * Integration_Team_Brief.docx section 4) without a destructive rebuild.
 * Idempotent - safe to call on every request, which is why ensureTab_
 * calls it unconditionally on its "sheet already exists" path.
 */
function migrateTabHeaders_(sheet, def) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
  const missing = def.headers.filter(function (h) { return existing.indexOf(h) === -1 && h !== ''; });
  if (!missing.length) return;

  const startCol = lastCol + 1;
  const range = sheet.getRange(1, startCol, 1, missing.length);
  range.setValues([missing]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0b1d2e');
  sheet.setColumnWidths(startCol, missing.length, 150);
  missing.forEach(function (h, i) {
    const col = startCol + i;
    if (CHECKBOX_FIELDS.indexOf(h) !== -1) {
      sheet.getRange(2, col, 1000, 1).insertCheckboxes();
    } else {
      sheet.getRange(2, col, 1000, 1).setNumberFormat('@');
    }
  });
}

function nextId_(prefix) {
  const props = PropertiesService.getScriptProperties();
  const key = 'COUNTER_' + prefix;
  const n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  return 'AM-' + prefix + '-' + ('0000' + n).slice(-4);
}

function saveCv_(id, cv) {
  const allowed = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  };
  const ext = allowed[cv.type];
  if (!ext) throw new Error('CV must be PDF or Word');
  const bytes = Utilities.base64Decode(cv.data);
  if (bytes.length > CONFIG.MAX_CV_BYTES) throw new Error('CV too large');

  const it = DriveApp.getFoldersByName(CONFIG.CV_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.CV_FOLDER_NAME);
  const base = String(cv.name || 'cv').replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, '').slice(0, 60) || 'cv';
  const blob = Utilities.newBlob(bytes, cv.type, id + '_' + base + '.' + ext);
  return folder.createFile(blob).getUrl();
}

function notify_(kind, id, p, cvLink, sheetUrl) {
  const to = CONFIG.NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  if (!to) return;
  const label = { professional: 'New candidate', family: 'New family request', organisation: 'New organisation enquiry' }[kind];
  const lines = [
    label + ' (' + id + ')', '',
    'Name: ' + clean_(p.name),
    'Phone: ' + clean_(p.phone),
    'Email: ' + clean_(p.email),
    'Location: ' + clean_(p.location),
    'Interest: ' + clean_(p.need),
  ];
  if (p.plan) lines.push('Plan: ' + clean_(p.plan));
  if (cvLink) lines.push('CV: ' + cvLink);
  if (p.message) lines.push('', 'Notes: ' + clean_(p.message));
  lines.push('', 'Open the sheet: ' + sheetUrl);
  MailApp.sendEmail({ to: to, subject: label + ': ' + clean_(p.name), body: lines.join('\n'), replyTo: clean_(p.email), name: 'Amana' });
}

// A short, immediate "we got it" email to the person who submitted the form.
function confirmSubmitter_(kind, p) {
  const email = clean_(p.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  const first = (clean_(p.name).split(' ')[0]) || 'there';
  const copy = {
    professional: {
      subject: 'Amana: we have your application',
      body: 'Hi ' + first + ',\n\nThanks for applying to join the Amana talent pool. We have received your details' + (p.cv ? ' and your CV' : '') + ', and our team will be in touch about next steps, including verification and training.\n\nIf anything changes (phone number, availability), just reply to this email.\n\nThe Amana team',
    },
    organisation: {
      subject: 'Amana: we have your enquiry',
      body: 'Hi ' + first + ',\n\nThanks for reaching out about staffing for your organisation. We have received your request and someone from our team will follow up shortly with next steps.\n\nIf anything changes in the meantime, just reply to this email.\n\nThe Amana team',
    },
    family: {
      subject: 'Amana: we have your request',
      body: 'Hi ' + first + ',\n\nThanks for your request. We have received your details and our team will be in touch shortly to help find the right professional for your home.\n\nIf anything changes in the meantime, just reply to this email.\n\nThe Amana team',
    },
  }[kind];
  MailApp.sendEmail({ to: email, subject: copy.subject, body: copy.body, name: 'Amana' });
}

function clean_(v) {
  return String(v == null ? '' : v).slice(0, 2000).trim();
}

function colLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ================= Professional formatting (run polish() once) ================= */

const BRAND = {
  navy: '#0b1d2e', terracotta: '#c4532d', gold: '#d9a441', cream: '#faf7f2',
  line: '#e7dfd0', ink: '#1d2530', muted: '#5d6570', sage: '#4d7a55', slate: '#3b4d61',
};

const STATUS_STYLE = {
  'New': ['#fdecc8', '#7a4b00'],
  'Contacted': ['#dbeafe', '#1e40af'],
  'In verification': ['#ede9fe', '#5b21b6'],
  'Quote sent': ['#ede9fe', '#5b21b6'],
  'Proposal sent': ['#ede9fe', '#5b21b6'],
  'In training': ['#ccfbf1', '#115e59'],
  'Matching': ['#ccfbf1', '#115e59'],
  'Approved': ['#d7efdc', '#14532d'],
  'Placed': ['#14532d', '#ffffff'],
  'Won': ['#14532d', '#ffffff'],
  'On hold': ['#e5e7eb', '#374151'],
  'Rejected': ['#fee2e2', '#991b1b'],
  'Lost': ['#fee2e2', '#991b1b'],
};

const COL_WIDTH = {
  'ID': 105, 'Submitted': 135, 'Status': 135, 'Name': 180, 'Phone': 135, 'Email': 220,
  'Role': 130, 'Role needed': 130, 'Organisation type': 160, 'Experience': 130, 'Arrangement': 115,
  'Location': 130, 'Plan': 100, 'Notes': 280, 'CV link': 150, 'Vetting progress': 115,
  'Assigned to': 135, 'Internal notes': 260, 'Last updated': 145,
};

/**
 * Run once from the Apps Script editor. Restyles the three data tabs and
 * rebuilds the Dashboard. Safe to run again at any time; your data is not touched.
 */
function polish() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  Object.keys(TABS).forEach(function (k) { ensureTab_(ss, k); });
  const tabColour = { professional: BRAND.navy, family: BRAND.gold, organisation: BRAND.sage };
  Object.keys(TABS).forEach(function (k) {
    step_('format ' + TABS[k].name, function () { polishTab_(ss, k, tabColour[k]); });
  });
  step_('dashboard', function () { polishDashboard_(ss); });
  const def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  const dash = ss.getSheetByName('Dashboard');
  if (dash) ss.setActiveSheet(dash);
  Logger.log('Polish complete. Any "Step failed" lines above show what to send back.');
}

function step_(name, fn) {
  try { fn(); } catch (e) { Logger.log('Step failed: ' + name + ' - ' + (e && e.message)); }
}

function statusRules_(range) {
  return Object.keys(STATUS_STYLE).map(function (s) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(s).setBackground(STATUS_STYLE[s][0]).setFontColor(STATUS_STYLE[s][1]).setBold(true)
      .setRanges([range]).build();
  });
}

function polishTab_(ss, kind, tabColour) {
  const def = TABS[kind];
  const sheet = ss.getSheetByName(def.name);
  const n = def.headers.length;
  const rows = 1000;
  const H = def.headers;

  sheet.setTabColor(tabColour);
  sheet.setHiddenGridlines(true);
  sheet.getRange(1, 1, rows, n).setFontFamily('Inter').setFontSize(10).setFontColor(BRAND.ink).setVerticalAlignment('middle');
  sheet.setRowHeights(2, rows - 1, 30);
  sheet.setRowHeight(1, 46);

  // Header
  const head = sheet.getRange(1, 1, 1, n);
  head.setBackground(BRAND.navy).setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center').setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  H.forEach(function (h, i) {
    if (STAGES.indexOf(h) !== -1 || h === 'Vetting progress') sheet.getRange(1, i + 1).setBackground(BRAND.terracotta);
    if (['Assigned to', 'Internal notes', 'Last updated'].indexOf(h) !== -1) sheet.getRange(1, i + 1).setBackground(BRAND.slate);
  });
  head.setBorder(null, null, true, null, null, null, BRAND.gold, SpreadsheetApp.BorderStyle.SOLID_THICK);

  // Column widths, alignment, wrapping
  const centred = ['Submitted', 'Status', 'Experience', 'Arrangement', 'Plan', 'Vetting progress', 'Last updated'].concat(STAGES);
  H.forEach(function (h, i) {
    const c = i + 1;
    sheet.setColumnWidth(c, COL_WIDTH[h] || (STAGES.indexOf(h) !== -1 ? 88 : 130));
    const col = sheet.getRange(2, c, rows - 1, 1);
    col.setHorizontalAlignment(centred.indexOf(h) !== -1 ? 'center' : 'left');
    col.setWrapStrategy(h === 'Notes' || h === 'Internal notes' ? SpreadsheetApp.WrapStrategy.WRAP : SpreadsheetApp.WrapStrategy.CLIP);
    if (h === 'CV link') col.setFontColor('#1d4ed8').setFontLine('underline');
    if (h === 'ID') col.setFontWeight('bold').setFontColor(BRAND.navy);
  });

  // Row banding and light horizontal rules
  sheet.getBandings().forEach(function (b) { b.remove(); });
  const body = sheet.getRange(2, 1, rows - 1, n);
  const banding = body.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  banding.setFirstRowColor('#ffffff').setSecondRowColor(BRAND.cream);
  body.setBorder(null, null, null, null, false, true, BRAND.line, SpreadsheetApp.BorderStyle.SOLID);

  // Conditional formatting: status pills, ticked stages, complete vetting
  const rules = statusRules_(sheet.getRange(2, H.indexOf('Status') + 1, rows - 1, 1));
  if (kind === 'professional') {
    const s1 = H.indexOf(STAGES[0]) + 1;
    const stageRange = sheet.getRange(2, s1, rows - 1, STAGES.length);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=' + colLetter_(s1) + '2=TRUE').setBackground('#d7efdc').setRanges([stageRange]).build());
    const pc = H.indexOf('Vetting progress') + 1;
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + colLetter_(pc) + '2="' + STAGES.length + ' of ' + STAGES.length + '"')
      .setBackground('#14532d').setFontColor('#ffffff').setBold(true)
      .setRanges([sheet.getRange(2, pc, rows - 1, 1)]).build());
  }
  sheet.setConditionalFormatRules(rules);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(4);
}

function polishDashboard_(ss) {
  let d = ss.getSheetByName('Dashboard');
  if (d) ss.deleteSheet(d);
  d = ss.insertSheet('Dashboard', 0);
  d.setTabColor(BRAND.terracotta);
  d.setHiddenGridlines(true);

  const widths = [95, 105, 130, 110, 100, 95, 95, 105, 130, 110, 100, 95];
  widths.forEach(function (w, i) { d.setColumnWidth(i + 1, w); });
  for (let c = 13; c <= 24; c++) d.setColumnWidth(c, 105);

  d.getRange(1, 1, 60, 12).setBackground(BRAND.cream).setFontFamily('Inter').setVerticalAlignment('middle');

  // Title band
  d.setRowHeight(1, 62);
  d.getRange('A1:L1').merge().setValue('   Amana').setBackground(BRAND.navy).setFontColor('#f0d9a8')
    .setFontFamily('Georgia').setFontSize(28).setFontWeight('bold').setHorizontalAlignment('left');
  d.setRowHeight(2, 30);
  d.getRange('A2:H2').merge().setValue('   Talent and client dashboard').setBackground(BRAND.navy)
    .setFontColor('#ffffff').setFontSize(11).setHorizontalAlignment('left');
  d.getRange('I2:L2').merge().setFormula('="Updated "&TEXT(NOW(),"dd mmm yyyy, hh:mm")&"   "').setBackground(BRAND.navy)
    .setFontColor('#f0d9a8').setFontSize(10).setHorizontalAlignment('right');
  d.getRange('A2:L2').setBorder(null, null, true, null, null, null, BRAND.gold, SpreadsheetApp.BorderStyle.SOLID_THICK);
  d.setRowHeight(3, 16);

  // KPI cards
  const cards = [
    ['CANDIDATES', '=COUNTA(Candidates!A2:A)', '=COUNTIFS(Candidates!B2:B,">="&(TODAY()-7))&" new this week"', BRAND.navy],
    ['IN THE POOL', '=COUNTIF(Candidates!C2:C,"Approved")', 'approved, ready to place', BRAND.sage],
    ['PLACED', '=COUNTIF(Candidates!C2:C,"Placed")', 'candidates in households', '#14532d'],
    ['FAMILY REQUESTS', '=COUNTA(Families!A2:A)', '=(COUNTA(Families!A2:A)-COUNTIF(Families!C2:C,"Placed")-COUNTIF(Families!C2:C,"Lost"))&" still open"', BRAND.terracotta],
    ['ORGANISATIONS', '=COUNTA(Organisations!A2:A)', '=(COUNTA(Organisations!A2:A)-COUNTIF(Organisations!C2:C,"Won")-COUNTIF(Organisations!C2:C,"Lost"))&" still open"', BRAND.slate],
    ['NEEDS ATTENTION', '=COUNTIF(Candidates!C2:C,"New")+COUNTIF(Families!C2:C,"New")+COUNTIF(Organisations!C2:C,"New")', 'new and not yet contacted', BRAND.gold],
  ];
  d.setRowHeight(4, 26);
  d.setRowHeight(5, 56);
  d.setRowHeight(6, 26);
  cards.forEach(function (c, i) {
    const col = 1 + i * 2;
    const box = d.getRange(4, col, 3, 2);
    box.setBackground('#ffffff').setHorizontalAlignment('center');
    d.getRange(4, col, 1, 2).merge().setValue(c[0]).setFontSize(9).setFontWeight('bold').setFontColor(BRAND.muted);
    const v = d.getRange(5, col, 1, 2).merge();
    v.setFormula(c[1]).setFontSize(32).setFontWeight('bold').setFontColor(c[3]).setFontFamily('Georgia');
    const cap = d.getRange(6, col, 1, 2).merge();
    if (c[2].charAt(0) === '=') cap.setFormula(c[2]); else cap.setValue(c[2]);
    cap.setFontSize(9).setFontColor(BRAND.muted);
    d.getRange(4, col, 1, 2).setBorder(true, null, null, null, null, null, c[3], SpreadsheetApp.BorderStyle.SOLID_THICK);
    box.setBorder(null, true, true, true, null, null, BRAND.line, SpreadsheetApp.BorderStyle.SOLID);
  });
  d.setRowHeight(7, 16);

  // Section bars
  const bar = function (row, text) {
    d.setRowHeight(row, 30);
    d.getRange(row, 1, 1, 12).merge().setValue('   ' + text).setBackground(BRAND.cream).setFontColor(BRAND.navy)
      .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left')
      .setBorder(null, null, true, null, null, null, BRAND.gold, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  };
  bar(8, 'PIPELINE AND DEMAND');
  bar(25, 'ACTIVITY');
  bar(42, 'LATEST SUBMISSIONS');

  // Chart data (columns N onwards)
  const helper = d.getRange(1, 14, 12, 11);
  helper.setFontSize(9).setFontColor(BRAND.muted);
  d.getRange('N1').setValue('Chart data (calculated automatically, please do not edit)');

  d.getRange('N2:O2').setValues([['Status', 'Candidates']]);
  const cst = TABS.professional.statuses;
  d.getRange(3, 14, cst.length, 1).setValues(cst.map(function (s) { return [s]; }));
  d.getRange(3, 15, cst.length, 1).setFormulas(cst.map(function (s, i) { return ['=COUNTIF(Candidates!$C$2:$C,N' + (3 + i) + ')']; }));

  d.getRange('Q2').setFormula('=IFERROR(QUERY(Candidates!G2:G,"select G, count(G) where G <> \'\' group by G order by count(G) desc label G \'Role\', count(G) \'Candidates\'",0),{"Role","Candidates"})');

  d.getRange('T2:U2').setValues([['Status', 'Requests']]);
  const fst = TABS.family.statuses;
  d.getRange(3, 20, fst.length, 1).setValues(fst.map(function (s) { return [s]; }));
  d.getRange(3, 21, fst.length, 1).setFormulas(fst.map(function (s, i) { return ['=COUNTIF(Families!$C$2:$C,T' + (3 + i) + ')']; }));

  d.getRange('V2:X2').setValues([['Week start', 'Week of', 'New requests']]);
  for (let i = 0; i < 8; i++) {
    const r = 3 + i;
    d.getRange(r, 22).setFormula('=TODAY()-WEEKDAY(TODAY(),3)-' + (7 * (7 - i)));
    d.getRange(r, 23).setFormula('=TEXT(V' + r + ',"d mmm")');
    d.getRange(r, 24).setFormula(
      '=COUNTIFS(Candidates!$B$2:$B,">="&V' + r + ',Candidates!$B$2:$B,"<"&V' + r + '+7)' +
      '+COUNTIFS(Families!$B$2:$B,">="&V' + r + ',Families!$B$2:$B,"<"&V' + r + '+7)' +
      '+COUNTIFS(Organisations!$B$2:$B,">="&V' + r + ',Organisations!$B$2:$B,"<"&V' + r + '+7)');
  }
  d.getRange('V3:V10').setNumberFormat('dd mmm yyyy');

  // Charts
  const style = function (b, title, colour) {
    return b.setOption('title', title)
      .setOption('titleTextStyle', { color: BRAND.navy, fontSize: 14, bold: true })
      .setOption('legend', { position: 'none' })
      .setOption('colors', [colour])
      .setOption('backgroundColor', '#ffffff')
      .setOption('hAxis', { textStyle: { color: BRAND.muted, fontSize: 10 } })
      .setOption('vAxis', { textStyle: { color: BRAND.muted, fontSize: 10 }, gridlines: { color: BRAND.line } })
      .setOption('width', 625).setOption('height', 300)
      .setNumHeaders(1);
  };
  d.insertChart(style(d.newChart().setChartType(Charts.ChartType.COLUMN).addRange(d.getRange('N2:O10')).setPosition(9, 1, 5, 4), 'Candidate pipeline', BRAND.navy).build());
  d.insertChart(style(d.newChart().setChartType(Charts.ChartType.BAR).addRange(d.getRange('Q2:R12')).setPosition(9, 7, 5, 4), 'Candidates by role', BRAND.terracotta).build());
  d.insertChart(style(d.newChart().setChartType(Charts.ChartType.COLUMN).addRange(d.getRange('T2:U8')).setPosition(26, 1, 5, 4), 'Family requests by status', BRAND.gold).build());
  d.insertChart(style(d.newChart().setChartType(Charts.ChartType.COLUMN).addRange(d.getRange('W2:X10')).setPosition(26, 7, 5, 4), 'New submissions per week', BRAND.slate).build());

  // Latest submissions
  d.getRange('A43').setFormula('=IFERROR(QUERY(Candidates!A2:J,"select A, B, D, G, J, C where A is not null order by B desc limit 8 label A \'Candidate ID\', B \'Submitted\', D \'Name\', G \'Role\', J \'Location\', C \'Status\'",0),"No candidates yet")');
  d.getRange('G43').setFormula('=IFERROR(QUERY(Families!A2:H,"select A, B, D, G, H, C where A is not null order by B desc limit 8 label A \'Request ID\', B \'Submitted\', D \'Name\', G \'Role needed\', H \'Location\', C \'Status\'",0),"No requests yet")');
  [[1, 6], [7, 12]].forEach(function (p) {
    const w = p[1] - p[0] + 1;
    d.getRange(43, p[0], 1, w).setBackground(BRAND.navy).setFontColor('#ffffff').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('left');
    const t = d.getRange(44, p[0], 8, w);
    t.setBackground('#ffffff').setFontSize(10).setFontColor(BRAND.ink)
      .setBorder(null, null, null, null, false, true, BRAND.line, SpreadsheetApp.BorderStyle.SOLID);
    d.getRange(44, p[0] + 1, 8, 1).setNumberFormat('dd mmm hh:mm');
  });
  d.setRowHeights(44, 8, 28);
  d.setConditionalFormatRules(statusRules_(d.getRange('F44:F51')).concat(statusRules_(d.getRange('L44:L51'))));

  d.getRange('A53:L53').merge()
    .setValue('   This page updates by itself. Change statuses in the Candidates, Families and Organisations tabs.')
    .setFontSize(9).setFontColor(BRAND.muted).setFontStyle('italic').setHorizontalAlignment('left');
  d.setFrozenRows(2);
  step_('protect dashboard', function () { d.protect().setWarningOnly(true); });
}
