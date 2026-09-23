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
  NOTIFY_EMAIL: '',            // leave empty to notify the script owner
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
      .concat(STAGES, ['Vetting progress', 'Assigned to', 'Internal notes', 'Last updated']),
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

function doGet() {
  return json_({ ok: true, service: 'amana-intake' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const p = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || p.secret !== secret) return json_({ ok: false, error: 'unauthorized' });

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

    notify_(kind, id, p, cvLink, ss.getUrl() + '#gid=' + sheet.getSheetId());
    return json_({ ok: true, id: id });
  } catch (err) {
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
  buildDashboard_(ss);

  // Remove the default empty tab if it is still there.
  const def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);

  ss.setActiveSheet(ss.getSheetByName('Dashboard'));
  Logger.log('SECRET (add to Vercel as APPS_SCRIPT_SECRET): ' + props.getProperty('SECRET'));
}

/* ---------------- Helpers ---------------- */

function ensureTab_(ss, kind) {
  const def = TABS[kind];
  let sheet = ss.getSheetByName(def.name);
  if (sheet) return sheet;

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
  const skipText = ['Submitted', 'Status', 'Last updated', 'Vetting progress'].concat(STAGES);
  def.headers.forEach(function (h, i) {
    if (skipText.indexOf(h) === -1) sheet.getRange(2, i + 1, 1000, 1).setNumberFormat('@');
  });

  const dateFmt = 'dd mmm yyyy hh:mm';
  sheet.getRange(2, 2, 1000, 1).setNumberFormat(dateFmt);
  sheet.getRange(2, n, 1000, 1).setNumberFormat(dateFmt);

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

function buildDashboard_(ss) {
  let d = ss.getSheetByName('Dashboard');
  if (d) ss.deleteSheet(d);
  d = ss.insertSheet('Dashboard', 0);
  d.setHiddenGridlines(true);
  d.setColumnWidths(1, 8, 150);

  d.getRange('A1').setValue('Amana dashboard').setFontSize(20).setFontWeight('bold').setFontColor('#0b1d2e');
  d.getRange('A2').setFormula('="Updated "&TEXT(NOW(),"dd mmm yyyy hh:mm")').setFontColor('#6b7280');

  const cands = 'Candidates', fams = 'Families', orgs = 'Organisations';
  const cards = [
    ['Candidates (total)', '=COUNTA(' + cands + '!A2:A)'],
    ['New this week', '=COUNTIFS(' + cands + '!B2:B,">="&(TODAY()-7))'],
    ['In the pool (Approved)', '=COUNTIF(' + cands + '!C2:C,"Approved")'],
    ['Placed', '=COUNTIF(' + cands + '!C2:C,"Placed")'],
    ['Family requests (open)', '=COUNTA(' + fams + '!A2:A)-COUNTIF(' + fams + '!C2:C,"Placed")-COUNTIF(' + fams + '!C2:C,"Lost")'],
    ['Org enquiries (open)', '=COUNTA(' + orgs + '!A2:A)-COUNTIF(' + orgs + '!C2:C,"Won")-COUNTIF(' + orgs + '!C2:C,"Lost")'],
  ];
  cards.forEach(function (c, i) {
    const col = 1 + (i % 3) * 2;
    const row = 4 + Math.floor(i / 3) * 3;
    d.getRange(row, col).setValue(c[0]).setFontColor('#6b7280').setFontSize(10);
    d.getRange(row + 1, col).setFormula(c[1]).setFontSize(24).setFontWeight('bold').setFontColor('#c4532d');
  });

  d.getRange('A11').setValue('Candidates by status').setFontWeight('bold');
  const st = TABS.professional.statuses;
  d.getRange(12, 1, st.length, 1).setValues(st.map(function (s) { return [s]; }));
  d.getRange(12, 2, st.length, 1).setFormulas(st.map(function (s, i) { return ['=COUNTIF(' + cands + '!C2:C,A' + (12 + i) + ')']; }));

  d.getRange('D11').setValue('Candidates by role').setFontWeight('bold');
  d.getRange('D12').setFormula('=IFERROR(QUERY(' + cands + '!G2:G,"select G, count(G) where G <> \'\' group by G order by count(G) desc label count(G) \'\'",0),"")');

  d.getRange('G11').setValue('Families by status').setFontWeight('bold');
  const fst = TABS.family.statuses;
  d.getRange(12, 7, fst.length, 1).setValues(fst.map(function (s) { return [s]; }));
  d.getRange(12, 8, fst.length, 1).setFormulas(fst.map(function (s, i) { return ['=COUNTIF(' + fams + '!C2:C,G' + (12 + i) + ')']; }));

  d.insertChart(d.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(d.getRange(12, 1, st.length, 2)).setPosition(22, 1, 0, 0)
    .setOption('title', 'Candidate pipeline').setOption('legend', { position: 'none' })
    .setOption('colors', ['#c4532d']).setOption('width', 520).setOption('height', 280).build());
  d.insertChart(d.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(d.getRange(12, 7, fst.length, 2)).setPosition(22, 5, 0, 0)
    .setOption('title', 'Family requests').setOption('legend', { position: 'none' })
    .setOption('colors', ['#0b1d2e']).setOption('width', 520).setOption('height', 280).build());
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
  MailApp.sendEmail({ to: to, subject: label + ': ' + clean_(p.name), body: lines.join('\n'), replyTo: clean_(p.email) });
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
