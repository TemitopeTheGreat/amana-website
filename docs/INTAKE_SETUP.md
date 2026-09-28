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

## Operations dashboard

`ops.html` on the site is a live, password-gated view of the pipeline: totals, status breakdowns, candidates by role, submissions over the last 8 weeks, and the latest candidates and family requests. It isn't in the nav and isn't indexed by search engines, but it isn't hidden from anyone who has the direct link and the password, so treat the link and password the same way you'd treat any shared login.

Setup: in Vercel, add an environment variable `OPS_PASSWORD` with a password of your choice, then redeploy. The dashboard reads live data through `api/ops.js`, using the same `APPS_SCRIPT_URL` and `APPS_SCRIPT_SECRET` as the lead form, so nothing extra is needed on the Apps Script side beyond having the current `Code.gs` deployed (it adds a `stats` action to `doGet`).

To change the password later, update `OPS_PASSWORD` in Vercel and redeploy; anyone still signed in in their browser stays signed in until they close the tab or click Sign out.

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
