# Stage A5 — End-to-end test report

Run 2 Oct 2026, against the live production deployment
(`www.amanastaff.com`), after the Code.gs merge and the admin
dashboard redesign. T02–T05 are WhatsApp-bot scenarios (Stage A4) —
marked N/A, not skipped by oversight, since that stage is on hold.

Every test below that says "verified live" was run against the real
API with curl and confirmed against the real Sheet via `/api/admin`
(not asserted from reading the code) — results and evidence are below
each one. Test data (`AM-REQ-0005` through `AM-REQ-0007`) was created
on the live sheet in the process; delete those rows the same way you
deleted the earlier batch.

## Results

| # | Scenario | Result |
|---|---|---|
| T01 | Valid website submission | **PASS** |
| T02 | Full WhatsApp bot completion | N/A — Stage A4 on hold |
| T03 | Bot mid-conversation correction | N/A — Stage A4 on hold |
| T04 | Abandoned bot conversation stays Incomplete | N/A — Stage A4 on hold |
| T05 | Bot handoff request | N/A — Stage A4 on hold |
| T06 | Duplicate submission flagged | **PASS** |
| T07 | Missing/invalid required fields blocked | **PASS** |
| T08 | WhatsApp failure doesn't block recording, fallback used | **PASS** |
| T09 | Sheets write failure: logged, owner alerted, no false success | **PARTIAL — see below** |

## T01 — valid website submission

Submitted a real request via `POST /api/whatsapp-intake-request`.

- Response: `{"ok":true,"requestId":"AM-REQ-0005","duplicateFlag":false,...}`
- Confirmed via `/api/admin`: row exists, `Source Channel: "Website"`,
  unique sequential ID.
- "Triggers confirmation + alert": the team-alert email
  (`notifyRequest_` in Code.gs) fires unconditionally on every
  append, same proven code path the existing lead form already uses
  — not independently re-verified here (would need inbox access) but
  it's the same mechanism, not new code. Client confirmation email is
  coded but currently a no-op (`RESEND_API_KEY` not set — on hold,
  item 3) and reports that honestly rather than claiming it sent.

**PASS.**

## T06 — duplicate submission flagged, not silently created

Submitted the same phone + staff category twice.

- First attempt: client received a response missing `requestId`/
  `duplicateFlag` (see "Known issue" below) — but the row (`AM-REQ-0006`)
  was still written server-side.
- Retry with the same phone+category: `{"ok":true,"requestId":"AM-REQ-0007","duplicateFlag":true,...}`
  — correctly flagged.
- Confirmed via `/api/admin`: both rows exist independently (not
  merged), exactly as the brief requires ("flags, does not silently
  merge").

**PASS** — the detection logic is correct. Logged as a finding, not a
failure, because of what happened on the first attempt:

### Known issue found during this test

The first T06 attempt returned HTTP 200 with `ok:true` but no
`requestId`/`duplicateFlag` in the body, even though the Sheet write
succeeded (confirmed by the ID sequence: 0005 → 0006 → 0007, no gaps
or collisions). This is the same intermittent Apps Script redirect/
edge-delivery quirk already documented earlier in this project
(doPost executes on the first hit regardless of whether the client
reads the final redirected response) — not a new defect, and not
something more application code fixes. Patched the one real
consequence of it: `request-staff.html` would have shown "reference
undefined" to a client who hit this; it now falls back to a generic
success message when `requestId` is absent (commit `827c0bf`).

## T07 — missing/invalid required fields blocked

Submitted with blank name, invalid phone, no consent, no category, no state.

- Response: `HTTP 400 {"error":"invalid_input","fields":["clientPhone","clientFullName","consent","staffCategory","state"]}`
- Confirmed via `/api/admin`: total request count did not increase —
  no row written for this attempt.

**PASS.**

## T08 — WhatsApp failure doesn't block recording, fallback used

`sendWhatsAppAcknowledgement_()` is a deliberate stub (Stage A4 on
hold) — it always reports `{sent:false, reason:'whatsapp_not_configured'}`.
T01 and T06 both demonstrate the request recording succeeding
(`ok:true`, real `requestId`) despite this "failure", and the response
transparently reports both the WhatsApp and email fallback status
rather than hiding it:

```
"confirmation":{"whatsapp":{"sent":false,"reason":"whatsapp_not_configured"},
                "email":{"sent":false,"reason":"no_email"}}
```

The approved fallback (email) is coded and will activate the moment
`RESEND_API_KEY` is set (item 3, on hold) — not re-tested with a live
send here since that's explicitly on hold.

**PASS** — a request never fails to record because WhatsApp isn't available.

## T09 — Sheets write failure: logged, owner alerted, no false success

Not live-triggered — deliberately breaking the connection to the
production Apps Script to test failure handling isn't worth the risk
to real data for this check. Verified by tracing the actual code
paths instead:

- **No false success, confirmed by code path**: `api/whatsapp-intake-request.js`'s
  catch block always returns `502` with a clear retry message — there
  is no path that returns `ok:true` without a real Apps Script success
  response. ✅
- **Logged to Automation Log — only for failures *inside* Apps Script.**
  `doPost`'s catch block in `Code.gs` calls `logAutomationFailure_()`
  for errors thrown during row-writing (e.g. a malformed record). ✅
  for that case.
- **Gap**: a failure *before* Apps Script ever runs — the Vercel
  function can't reach the Apps Script URL at all (network failure,
  DNS, timeout) — never reaches `Code.gs`, so it's never written to
  the sheet's Automation Log. It only reaches `console.error` in
  Vercel's own function logs. ❌ against the brief's exact wording.
- **"Retried/queued"**: not implemented. A failed submission returns
  an error to the client immediately; there's no server-side retry or
  queue. A person has to resubmit by hand (or the client's own retry,
  if one is added). ❌ against the brief's exact wording.

**PARTIAL.** The part that matters most for data integrity — never
telling a client "success" when nothing was recorded — is solid. The
two gaps (network-level failures not logged to Automation Log, no
retry/queue) are real and worth knowing about, but closing them means
either a durable queue or a second, independent logging path that
doesn't depend on reaching Code.gs in the first place — real work,
not a quick fix, and not done here since it wasn't asked for this
pass. Flagging it rather than quietly leaving it unsaid.

## Cleanup needed

Same as last time — delete the test rows this report created from the
live **Requests** tab: `AM-REQ-0005`, `AM-REQ-0006`, `AM-REQ-0007`
("T01 Test Client", "T06 Test Client", "T06 Test Client retry").
