# Amana

Verified Hands. Trusted Homes.

Static marketing site for Amana, a Nigerian domestic and household talent platform connecting families, diaspora households and organisations with verified, trained and professionally managed household staff.

## Pages

- `index.html`: homepage
- `family.html`: for families and households, including pricing and the Placement vs Managed Staffing comparison
- `professionals.html`: for household professionals joining Amana
- `business.html`: for estates, developers, corporates, embassies & NGOs
- `diaspora.html`: the £400 diaspora package, linked from the homepage and Family page (not in the main nav)
- `privacy.html`: privacy policy
- `ops.html`: password-gated internal operations dashboard, not in the nav, not indexed

## Stack

Plain HTML/CSS/JS, no build step or framework.

- `css/style.css`: design system and styles
- `js/script.js`: nav, FAQ accordion, scroll reveal, lead modal

## Local preview

Serve the folder with any static file server, e.g.:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Product docs

- [docs/PRD.md](docs/PRD.md): product requirements
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): technical architecture

## Setup

**Lead form, notifications and dashboard.** Requests go to `api/lead.js`, which forwards them to a Google Apps Script that files them into your Google Sheet (and saves CVs to Drive). Each submission immediately emails the team (`NOTIFY_EMAIL` in `apps-script/Code.gs`, can be several addresses separated by commas) and sends the person who submitted a short confirmation email. Full steps: [docs/INTAKE_SETUP.md](docs/INTAKE_SETUP.md). Set `APPS_SCRIPT_URL` and `APPS_SCRIPT_SECRET` in Vercel. Until then the form shows a "could not send" message instead of a success screen.

**Operations dashboard.** `ops.html` is a password-gated internal page (not in the nav, not indexed) showing live pipeline stats: totals, status breakdowns, candidates by role, weekly submissions and the latest requests. It calls `api/ops.js`, which checks a password against `OPS_PASSWORD` in Vercel, then reads live data from the same Apps Script. Needs `OPS_PASSWORD`, `APPS_SCRIPT_URL` and `APPS_SCRIPT_SECRET` set in Vercel.

**WhatsApp button.** In `js/script.js`, set `SITE_CONFIG.whatsapp` to the number in digits with country code (for example `2348012345678`). The floating chat button appears once it is set. `SITE_CONFIG.email` adds an email fallback to the form's error message.

**Real photos.** Photos live in `assets/img/` as WebP. To swap one, replace the file and keep the same name. Ideal sizes: `hero-home` 1700px wide, the rest about 1000px.

**Domain.** When you have a custom domain, replace `https://amana-ng.vercel.app` in each page's canonical and `og:` tags, in `sitemap.xml` and in `robots.txt`.
