# Intake and dashboard setup (Google Sheet)

Every form on the site (families, professionals, organisations) lands in your Google Sheet. Professionals can attach a CV, which is saved to Google Drive. The sheet is the team's dashboard.

```
Website form  ->  /api/lead (Vercel)  ->  Apps Script  ->  Google Sheet + Drive + email
```

The browser never sees the Apps Script address. Vercel checks the submission and forwards it with a shared secret.

## One-time setup (about 10 minutes)

1. Open the Google Sheet, then **Extensions > Apps Script**.
2. Delete the sample code and paste in everything from `apps-script/Code.gs`. Save.
   - Optional: set `NOTIFY_EMAIL` at the top if alerts should go somewhere other than your own inbox.
3. In the function dropdown choose **setup** and click **Run**. Approve the permissions (Sheets, Drive, sending email).
4. Open **Execution log**. Copy the line that starts with `SECRET`. This creates the tabs and the Dashboard.
5. Click **Deploy > New deployment > Web app**. Set *Execute as*: **Me**, and *Who has access*: **Anyone**. Deploy and copy the Web app URL (it ends in `/exec`).
6. In Vercel (project `amana-ng` > Settings > Environment Variables) add:
   - `APPS_SCRIPT_URL`: the Web app URL
   - `APPS_SCRIPT_SECRET`: the secret from step 4
7. Redeploy the site (or push any commit). Submit a test request on the site and check the sheet.

If you edit the script later: **Deploy > Manage deployments > Edit > New version**, otherwise the live version stays on the old code.

## Updating the script (already set up once)

`apps-script/Code.gs` in this repo is the source of truth. If it changes (new features, fixes), your live copy needs updating:

1. Open the Apps Script editor, select everything in `Code.gs`, delete it, and paste the current version from the repo.
2. Click **Save**.
3. **Deploy > Manage deployments**, click the pencil icon on the existing deployment, set **Version** to **New version**, and click **Deploy**. This keeps the same URL, so nothing on the site needs to change.
4. If the change added a new script property or config (like `PRESET_SECRET`), run **setup** again. It's safe to re-run; it won't duplicate your data.

## Immediate email notifications

Every submission emails the team straight away, no delay, no separate step. Set `NOTIFY_EMAIL` at the top of `Code.gs`, one address or several separated by commas, e.g. `'hello@amanastaff.com, ops@amanastaff.com'`. Leave it empty to notify whoever owns the script instead.

The person who submitted the form also gets a short confirmation email immediately, letting them know Amana has their request.

## Admin dashboard

`admin.html` on the site is a live view of the pipeline, split into its own page per sidebar item (Overview, Candidates, Families & Orgs, Diaspora, Requests) rather than one long scroll - each has its own search box and status filter, and an "Export CSV" button for offline use. It isn't in the nav and isn't indexed by search engines, but it isn't hidden from anyone who has the direct link, so treat the link the same way you'd treat a shared login page.

Setup: in Vercel, add an environment variable `ADMIN_PASSWORD` with a password of your choice, then redeploy. The dashboard reads live data through `api/admin.js`, using the same `APPS_SCRIPT_URL` and `APPS_SCRIPT_SECRET` as the lead form, so nothing extra is needed on the Apps Script side beyond having the current `Code.gs` deployed.

### Signing in: named accounts with super/general roles

There's no single shared password any more. Two kinds of login:

1. **The "owner" account** - username `owner`, password is whatever `ADMIN_PASSWORD` is set to in Vercel. This always works, independent of everything else below, so the business owner can never be locked out. Always full ("super") access.
2. **Named accounts** - created from the dashboard's "Manage Users" page (visible only to super admins), with a username, a temporary password, and a role:
   - **Super**: everything a general admin can do, plus deleting a staff request, syncing a candidate to the CRM, and managing other admin accounts (create, disable/re-enable).
   - **General**: can view and search every page (Candidates, Families & Orgs, Diaspora, Requests) and export CSVs, but cannot delete anything, cannot sync to the CRM, and doesn't see the Manage Users page at all.

A session is a signed cookie, not something stored in the browser's own storage - closing the tab doesn't sign you out (it lasts 12 hours), but nothing about it is readable or usable by a script running on the page, unlike the old shared-password approach.

Accounts, password hashes (never plaintext), and lockout state live in a new **Admin Users** tab in the same Google Sheet - `setup()` in `Code.gs` creates it. Five failed logins in a row locks a named account for 15 minutes; the "owner" account has no such lock (it's throttled with a fixed delay instead) since there's no sheet row to track it against.

Optional: set `ADMIN_SESSION_SECRET` in Vercel to any long random string, for defense-in-depth (session cookies are currently signed with `ADMIN_PASSWORD` itself if this isn't set - fine to start, but a dedicated secret means a session token can't be forged by anyone who only knows the login password).

To change the owner password later, update `ADMIN_PASSWORD` in Vercel and redeploy.

### Candidate CVs

Every candidate who uploads a CV through the application form gets it saved to a Google Drive folder named "Amana CVs" (`saveCv_()` in `Code.gs`), with the file's Drive link stored in the Candidates tab's "CV link" column. The admin dashboard's Candidates page surfaces this as a "View CV" link per row - no separate file storage was added, it's reading the same Drive link that was already being written to the sheet.

### Syncing a candidate to the CRM

The Candidates page has a "Sync to CRM" button per row (and a "Sync all unsynced to CRM" button above the table) - visible and usable by super admins only; general admins don't see this column at all. It isn't wired to a real CRM yet - `CRM_WEBHOOK_URL` is unset until you add it in Vercel, so clicking it today shows "CRM not connected yet" and nothing is sent anywhere.

To connect it: set `CRM_WEBHOOK_URL` in Vercel to your CRM's inbound-webhook URL (HubSpot, Zoho, Pipedrive and most others accept a plain webhook; if yours needs a bearer token, also set `CRM_API_KEY`). `api/admin-sync-candidate.js` then POSTs a JSON payload (name, phone, email, role, experience, location, status, CV link) to that URL, and on success asks `Code.gs` to stamp a "CRM Synced At" timestamp on that candidate's row so the button shows "Synced" afterwards instead of offering to resend it. Salesforce typically needs a proper OAuth connection rather than a static webhook URL - if that's your CRM, this will need a small follow-up change rather than just an env var.

### Why form submissions used to feel slow

Both the website's "Become a Staff" and "Request Staff" forms used to send two emails (an internal alert + a confirmation to the person who submitted) *before* responding to the browser - each `MailApp.sendEmail()` call is a real network round trip, and doing two of them before saying "success" was adding several extra seconds to every submission. Both forms now get a response the moment their row is safely written; the two emails still send, just via a second call that happens after the browser already has its answer (`handleNotifySubmission_` / `handleNotifyRequestSubmitted_` in `Code.gs`). CV uploads still take a little longer than a request with no attachment - that part is just the cost of uploading a file to Drive, not something this fixed.

### Security headers

`vercel.json` sets a Content-Security-Policy, HSTS, `X-Frame-Options: DENY`, and a few other standard headers on every response - mainly to stop the site (and especially `admin.html`) from being embedded in another page (clickjacking) and to restrict what a browser will load or connect to if a script was ever injected somewhere. It allows Google Fonts and nothing else external, since that's the only third-party resource any page actually loads.

### Site analytics

The dashboard's **Analytics** page shows page views, CTA clicks (Request Staff, Become a Staff, WhatsApp, etc.), a click-through rate, and an 8-week trend - self-hosted, not a third-party tracker. No cookies, no visitor ID, nothing stored in the browser; each row in a new **Site Analytics** sheet tab is just "this page was viewed" or "this button was clicked," anonymous by design.

`js/script.js` fires these on every page via `api/track.js`, which forwards to `Code.gs`'s `track` action. That action deliberately skips the shared `LockService` lock every other write uses (see the comment on it in `Code.gs`) - it's by far the highest-frequency action, and a burst of visitors should never make a real form submission wait behind it. A plain `appendRow` is good enough for a page-view counter; losing one occasionally isn't a problem the way losing a client's data would be.

### Why there's a combined `api/admin-users.js` instead of three separate files

Vercel's Hobby plan caps a deployment at 12 serverless functions. Adding `api/track.js` for analytics would have pushed past that, so the three Manage Users endpoints (list/create/enable-disable accounts) were combined into one file routed by an `op` field in the request body, freeing two slots. If that plan limit ever stops being a constraint (upgrading to Pro, for instance), there's no pressure to re-split them - it's a reasonable shape either way.

## What the team sees

| Tab | Holds | Status pipeline |
| :--- | :--- | :--- |
| Dashboard | Counts and charts, updates itself | n/a |
| Candidates | Professionals who applied, with a CV link | New, Contacted, In verification, In training, Approved, Placed, On hold, Rejected |
| Families | Household and diaspora requests | New, Contacted, Quote sent, Matching, Placed, Lost |
| Organisations | Estate, corporate, embassy and NGO enquiries | New, Contacted, Proposal sent, Won, Lost |

- **Status** is a dropdown, coloured by stage. Filters are on every header.
- **Candidates** also has one checkbox per vetting stage (identity, police certificate, guarantors, references, medical, assessment, training) and a "Vetting progress" count like `4 of 7`. Set the status to *Approved* when all are done.
- **Assigned to** and **Internal notes** are for the team. Everything else is filled by the form.
- Each row gets an ID such as `AM-C-0001` (C candidate, F family, O organisation).

## CVs and privacy

- CVs are saved in a Drive folder called **Amana CVs**, private to your Google account. Share that folder with the team members who review candidates, or the CV links won't open for them.
- The sheet holds personal data (names, phone numbers, CVs). Share it only with people who need it, and use "Viewer" access where you can.
- The form asks for consent before submitting. Decide how long you keep rejected candidates' data, in line with NDPR.
- Limits: CVs must be PDF or Word and up to 2.5 MB. CVs are optional.

## Outgrowing the sheet

A sheet works well up to a few thousand rows and a small team. When you need logins per staff member, audit trails, matching and payroll, move to the database design in `ARCHITECTURE.md`. The sheet columns map directly onto those tables, so the data can be imported.
