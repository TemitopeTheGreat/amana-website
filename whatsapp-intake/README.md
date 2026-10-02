# Amana WhatsApp intake (new, separate system)

This is **Part 1 ("AMANA")** of the staged brief in
`Amana_Hiyame_Claude_Code_Prompts.md` (in the user's Downloads folder,
not in this repo): a WhatsApp Business API bot + a new Google Sheet,
feeding a recruitment pipeline (Intake → Recruitment → Commercial →
Fulfilment). Part 2 of that brief later connects this to a separate
Next.js app called Hiyame.

## This is not the same system as `docs/INTAKE_SETUP.md`

The website already has a working lead-capture pipeline: the lead
form on every page → `/api/lead.js` → an Apps Script web app → a
3-tab Google Sheet (Candidates/Families/Organisations), documented in
[`../docs/INTAKE_SETUP.md`](../docs/INTAKE_SETUP.md) and implemented
in [`../apps-script/Code.gs`](../apps-script/Code.gs).

Per the user (2 Oct 2026): this new system runs **alongside** that
one, not in place of it. Different schema, different Sheet, different
IDs (`AMN-REQ-000123` here vs. `AM-C-0001` there), different purpose.
Do not merge them or point one at the other's Sheet without that
being a deliberate, separately-confirmed decision - the two status
taxonomies in particular are not compatible.

## Architecture decision: Apps Script, not a Sheets-API service account

The brief's Stage A2 describes "a Sheets API client wrapper... using
service account credentials I'll provide via environment variable."
That needs a new Google Workspace service account - a Stage A0
blocker that isn't sorted. Per the user (2 Oct 2026), this reuses the
Apps-Script-as-web-app pattern the existing system already has proven
and deployed instead: `apps-script/Code.gs` in this folder implements
the brief's Stage A2 functions (appendRequestRow, updateRequestRow,
etc.) as `doPost` actions, and `sheets-client.js` is a thin Node-side
fetch wrapper calling it - same contract the brief asks for, different
transport, one fewer credential to provision.

## Status (2 Oct 2026)

**Stages A1–A3 built. A4 (WhatsApp bot) and A5 (end-to-end testing)
not started - A4 explicitly deferred by the user ("leave out the
WhatsApp API for now").** 28 tests passing across three test files
(none need live credentials - all mock the network boundary).

### Stage A1 — schema, constants, utilities
- `schema.js` - the `AmanaRequest` field list (JSDoc typedef, not
  TypeScript - this repo has no build step) and `createEmptyRequest()`.
- `constants.js` - status/category vocabularies. **Draft, pulled
  straight from the brief's wording - needs business sign-off before
  Stage A4 is built against it.**
- `utils.js` - `generateRequestReference()` (now mainly for
  session-local/standalone use - see Stage A2 note below) and
  `normalizeNigerianPhone()`.
- `smoke-test.js` - 13 checks. Run: `node whatsapp-intake/smoke-test.js`

### Stage A2 — Sheets register
- `apps-script/Code.gs` - the backend. Implements `appendRequestRow`
  (generates the sequential Request ID itself, same approach as
  `nextId_` in the repo-root Apps Script - a client-supplied ID would
  risk collisions), `updateRequestRow`, `findRequestBySessionId`,
  `appendBotSession`, `updateBotSession`, duplicate detection (same
  phone + overlapping staff category within 30 days - flags, doesn't
  silently merge), and an Automation Log writer for any failure.
  **Not deployed yet** - needs a new spreadsheet created, `CONFIG.SHEET_ID`
  filled in, `setup()` run once, then deployed as a web app. See the
  file's header comment for exact steps (same shape as
  `docs/INTAKE_SETUP.md`, different project).
- `sheets-client.js` - the Node-side caller. Needs `WHATSAPP_INTAKE_URL`
  and `WHATSAPP_INTAKE_SECRET` in Vercel once deployed; throws a clear,
  named error if they're missing rather than failing silently.
- `sheets-client.smoke-test.js` - 5 checks against a mocked `fetch`.
  Run: `node whatsapp-intake/sheets-client.smoke-test.js`

### Stage A3 — website intake form
- `../request-staff.html` - the form. **Not linked from the main nav
  yet** (this whole system isn't launched). Grouped sections (contact /
  role / location / salary & timing / consent) rather than a literal
  JS step-wizard - a deliberate scope simplification; the data
  contract is what has the real acceptance-test stakes, and the
  backend doesn't care whether the UI is paginated. Shows a clear
  error, never a false success, when the backend isn't configured yet.
- `../api/whatsapp-intake-request.js` - the endpoint. Validates,
  normalizes the phone number, calls `sheets-client.appendRequestRow()`,
  then fires a confirmation email (via Resend if `RESEND_API_KEY` is
  set, otherwise logs and reports unsent) and a WhatsApp acknowledgement
  stub (see below). `buildRequestFromBody()` is exported separately so
  the validation logic is tested without mocking HTTP.
- `../api/whatsapp-intake-request.test.js` - 10 checks on validation
  logic. Run: `node api/whatsapp-intake-request.test.js`
- Internal team alert (brief's Stage A3 point 3): stubbed, logs a
  `[TODO]` line - no internal notification channel (Slack? email
  list?) has been decided.

## Stage A4 — explicitly deferred

Per the user: build everything except the WhatsApp API integration
itself. `sendWhatsAppAcknowledgement_()` in `api/whatsapp-intake-request.js`
is a one-function stub (logs, reports `sent: false`) - swapping in a
real WhatsApp Business API call later means replacing that function's
body alone, nothing else in the request flow changes.

**Not built**: the 15-question conversation state machine, session
resume/correction/handoff logic, and the actual provider integration
(Twilio/Meta/360dialog - still unchosen). This needs the WhatsApp
Business API account + credentials (Stage A0) and the signed-off
15-question wording the brief calls for before it's worth writing -
coding the conversation flow against unconfirmed question wording
would mean rewriting it once that sign-off happens anyway.

## Not started

Stage A5 (end-to-end tests against a real deployment - needs Stage A2
actually deployed first) and all of Part 2 (Hiyame). Each needs
something from Stage A0 that isn't sorted:

- A2 going live needs the spreadsheet created and the Apps Script deployed.
- A3 going live needs `RESEND_API_KEY` (or an alternative email
  sender) and a decision on whether this form gets linked from the
  real site nav or stays a standalone page.
- A4 needs a WhatsApp Business API provider, credentials, an approved
  message template, and the 15-question wording signed off.
