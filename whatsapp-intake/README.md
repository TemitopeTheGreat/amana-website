# Amana WhatsApp intake

This is **Part 1 ("AMANA")** of the staged brief in
`Amana_Hiyame_Claude_Code_Prompts.md` (in the user's Downloads folder,
not in this repo): a WhatsApp Business API bot feeding a recruitment
pipeline (Intake → Recruitment → Commercial → Fulfilment). Part 2 of
that brief later connects this to a separate Next.js app called
Hiyame.

## Uses the existing Sheet and the existing Apps Script (2 Oct 2026)

Earlier drafts of this folder built a separate spreadsheet and a
separate Apps Script project. Per the user: use the existing sheet and
deploy — so as of 2 Oct 2026, this is folded into
[`../apps-script/Code.gs`](../apps-script/Code.gs), the same script
that already runs the live website lead form. New Requests, Bot
Sessions and Automation Log tabs live in the **same spreadsheet** as
Candidates/Families/Organisations; everything goes through the
**same** Vercel env vars (`APPS_SCRIPT_URL`, `APPS_SCRIPT_SECRET`) and
the **same** deployment. One Apps Script project to maintain, not two.

Request IDs use the existing `AM-<PREFIX>-####` convention
(`nextId_('REQ')` → `AM-REQ-0001`), matching `AM-C-0001` /
`AM-F-0001` / `AM-O-0001`, not the `AMN-REQ-000123` format floated in
an earlier draft of this README.

**To go live:** paste the updated `apps-script/Code.gs` into the Apps
Script editor (same one used for the existing lead form), save, then
**Deploy → Manage deployments → pencil icon → Version: New version →
Deploy** (same steps as always — see `docs/INTAKE_SETUP.md`). Run
`setup()` once first if the Requests/Bot Sessions/Automation Log tabs
don't exist yet in the sheet — it's safe to re-run, existing data
isn't touched. Nothing needs to change in Vercel; the existing
`APPS_SCRIPT_URL`/`APPS_SCRIPT_SECRET` already point at the right place.

## Notifications: the admin dashboard, not a separate channel

Per the user: new-request notifications surface on the admin dashboard
rather than needing a separate internal alert channel (Slack, etc.).
`admin.html` was redesigned (2 Oct 2026, replacing the old `.ops-*`
layout) with a sidebar nav, a notification bell showing the live count
of new/unactioned requests, a "Needs attention" panel listing the
newest ones, and a full Requests section (status breakdown + latest
requests table) alongside the existing Candidates/Families/
Organisations panels — all from real data via the Sheet, nothing
fabricated. `Code.gs` also still emails `NOTIFY_EMAIL` on every new
request (`notifyRequest_`), same as the existing candidate/family/org
flow — belt and braces, not a replacement for the dashboard.

## This is not a separate system from the live lead form anymore

It was, in an earlier draft of this README. Now it's the same
spreadsheet, same script, same deployment, same dashboard — just a
different tab (Requests) and a different public form
(`request-staff.html`) alongside the existing lead-modal flow. Status
taxonomies are still different (this uses the 4-phase
Intake/Recruitment/Commercial/Fulfilment list; Candidates/Families/
Organisations keep their own per-tab status lists) — that part hasn't
changed and isn't meant to.

## Status (2 Oct 2026)

**Stages A1–A3 built and live. A5 end-to-end testing done against the
real deployment** (T01/T06/T07/T08 pass, T09 partial — see
[`STAGE_A5_TEST_REPORT.md`](STAGE_A5_TEST_REPORT.md)). **A4 (WhatsApp
bot) not started** — explicitly deferred by the user; A5's bot-related
scenarios (T02-T05) are N/A until it exists. 28 automated unit tests
also passing across three test files (mocking the network boundary,
separate from the live T01-T09 checks).

### Stage A1 — schema, constants, utilities
- `schema.js` - the `AmanaRequest` field list (JSDoc typedef, not
  TypeScript - this repo has no build step) and `createEmptyRequest()`.
- `constants.js` - status/category vocabularies. **Draft, pulled
  straight from the brief's wording - needs business sign-off before
  Stage A4 is built against it.**
- `utils.js` - `normalizeNigerianPhone()`. `generateRequestReference()`
  is now vestigial for the real flow (Code.gs's `nextId_('REQ')` is
  authoritative) - kept for standalone/session-local use only.
- `smoke-test.js` - 13 checks. Run: `node whatsapp-intake/smoke-test.js`

### Stage A2 — Sheets register (merged into the existing script)
- `../apps-script/Code.gs` - `appendRequestRow` (generates the ID via
  the existing `nextId_('REQ')`), `updateRequestRow`,
  `findRequestBySessionId`, `appendBotSession`, `updateBotSession`,
  duplicate detection (same phone + overlapping staff category within
  30 days - flags, doesn't silently merge), and an Automation Log
  writer wired into the shared `doPost` catch block. `doGet`'s
  `?action=stats` now also returns a `requests` summary alongside the
  existing `candidates`/`families`/`organisations` ones.
- `sheets-client.js` - the Node-side caller, reading the existing
  `APPS_SCRIPT_URL`/`APPS_SCRIPT_SECRET`.
- `sheets-client.smoke-test.js` - 5 checks against a mocked `fetch`.

### Stage A3 — website intake form
- `../request-staff.html` - the form. **Not linked from the main nav
  yet.** Grouped sections rather than a literal JS step-wizard - the
  data contract is what has the real acceptance-test stakes.
- `../api/whatsapp-intake-request.js` - validates, normalizes the
  phone number (and now also formula-injection-guards every field the
  same way `api/lead.js` does, before it reaches the same Sheet),
  calls `sheets-client.appendRequestRow()`, sends a confirmation email
  (Resend, if `RESEND_API_KEY` is set) and a stubbed WhatsApp
  acknowledgement.
- `../api/whatsapp-intake-request.test.js` - 10 checks on validation logic.

## Stage A4 — explicitly deferred

Per the user: build everything except the WhatsApp API integration
itself. `sendWhatsAppAcknowledgement_()` in `api/whatsapp-intake-request.js`
is a one-function stub - swapping in a real WhatsApp Business API call
later means replacing that function's body alone.

**Not built**: the 15-question conversation state machine, session
resume/correction/handoff logic, and the actual provider integration.
Needs the WhatsApp Business API account + credentials and the
signed-off 15-question wording first.

## Verified against the live Sheet (2 Oct 2026)

Done - see [`STAGE_A5_TEST_REPORT.md`](STAGE_A5_TEST_REPORT.md) for
the full pass/fail writeup (T01, T06, T07, T08 pass; T09 partial - a
real gap around network-level failure logging, documented there; T02-T05
N/A, Stage A4 on hold). `request-staff.html` is now linked from the
main nav and footer on every page, indexed (noindex removed), and in
`sitemap.xml` - it's a real, launched page, not a staging one.

## Not started

Stage A5's WhatsApp-bot scenarios (T02-T05, blocked on Stage A4) and
all of Part 2 (Hiyame). A4 needs a WhatsApp Business API
provider, credentials, an approved message template, and the
15-question wording signed off.
