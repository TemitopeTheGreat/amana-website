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

**Lead form emails.** The request form posts to `api/lead.js`, which emails each submission through Resend. Set these in Vercel (Project Settings, Environment Variables), then redeploy:

- `RESEND_API_KEY`: your Resend API key
- `LEAD_TO_EMAIL`: the inbox that should receive leads
- `LEAD_FROM_EMAIL` (optional): a verified sender, for example `Amana <hello@yourdomain.com>`. Without it, Resend's test sender is used, which only delivers to the Resend account owner.

Until the first two are set, the form shows a "could not send" message instead of a success screen.

**WhatsApp button.** In `js/script.js`, set `SITE_CONFIG.whatsapp` to the number in digits with country code (for example `2348012345678`). The floating chat button appears once it is set. `SITE_CONFIG.email` adds an email fallback to the form's error message.

**Real photos.** Photos live in `assets/img/` as WebP. To swap one, replace the file and keep the same name. Ideal sizes: `hero-home` 1700px wide, the rest about 1000px.

**Domain.** When you have a custom domain, update the `SITE` constant in nothing but the canonical and `og:` URLs in each page's `<head>`, plus `sitemap.xml` and `robots.txt`.
