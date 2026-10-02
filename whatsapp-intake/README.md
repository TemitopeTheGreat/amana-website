# Amana WhatsApp intake (new, separate system)

This is **Part 1 ("AMANA")** of the staged brief in
`Amana_Hiyame_Claude_Code_Prompts.md` (in the user's Downloads folder,
not in this repo): a WhatsApp Business API bot + a new 7-tab Google
Sheet, feeding a recruitment pipeline (Intake → Recruitment →
Commercial → Fulfilment). Part 2 of that brief later connects this to
a separate Next.js app called Hiyame.

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
taxonomies in particular are not compatible (this system's
Intake/Recruitment/Commercial/Fulfilment phases vs. the existing
per-tab status lists in `Code.gs`).

## Status

**Stage A1 only** (schema + constants + shared utilities). Built
because it's the one stage in the brief that depends on none of the
Stage A0 blockers (WhatsApp Business API account, Google Workspace
service account, confirmed form location, locked schema sign-off) -
none of those are sorted yet as of 2 Oct 2026.

- `schema.js` - the `AmanaRequest` field list (JSDoc typedef, not
  TypeScript - this repo has no build step) and `createEmptyRequest()`,
  so every later stage writes the same fields.
- `constants.js` - the controlled status/category vocabularies.
  **Draft, pulled straight from the brief's wording - needs the
  business sign-off the brief's Stage A0 calls for before Stage A4
  (the bot) is built against it.**
- `utils.js` - `generateRequestReference()` and
  `normalizeNigerianPhone()`.
- `smoke-test.js` - run with `node whatsapp-intake/smoke-test.js`.
  No test framework in this repo; plain `assert`, exits non-zero on
  failure.

## Not started

Stage A2 (Sheets API layer), A3 (website form), A4 (WhatsApp bot), A5
(end-to-end tests), and all of Part 2 (Hiyame). Each of those needs at
least one Stage A0 item that isn't sorted yet:

- A2 needs a Google Workspace service account.
- A3 needs a decision on where the form lives.
- A4 needs a WhatsApp Business API provider, credentials, and an
  approved message template.
- A4's bot script also needs the 15-question wording and field names
  formally signed off, not just taken from the brief draft.

Building further than A1 without those would mean coding against
guesses for things the brief itself says are business decisions, not
engineering ones.
