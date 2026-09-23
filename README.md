# Amana

Verified Hands. Trusted Homes.

Static marketing site for Amana, a Nigerian domestic and household talent platform connecting families, diaspora households and organisations with verified, trained and professionally managed household staff.

## Pages

- `index.html`: homepage
- `professionals.html`: for household professionals joining Amana
- `business.html`: for estates, developers, corporates, embassies & NGOs

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

**Lead form and dashboard.** Requests go to `api/lead.js`, which forwards them to a Google Apps Script that files them into your Google Sheet (and saves CVs to Drive). Full steps: [docs/INTAKE_SETUP.md](docs/INTAKE_SETUP.md). Set `APPS_SCRIPT_URL` and `APPS_SCRIPT_SECRET` in Vercel. Until then the form shows a "could not send" message instead of a success screen.

**WhatsApp button.** In `js/script.js`, set `SITE_CONFIG.whatsapp` to the number in digits with country code (for example `2348012345678`). The floating chat button appears once it is set. `SITE_CONFIG.email` adds an email fallback to the form's error message.

**Real photos.** Photos live in `assets/img/` as WebP. To swap one, replace the file and keep the same name. Ideal sizes: `hero-home` 1700px wide, the rest about 1000px.

**Domain.** When you have a custom domain, replace `https://amana-ng.vercel.app` in each page's canonical and `og:` tags, in `sitemap.xml` and in `robots.txt`.
