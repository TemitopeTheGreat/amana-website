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
  polish();

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
