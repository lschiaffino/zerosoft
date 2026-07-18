# zerosoft.ai

**Software is dead.** We rebuild the tools you use every day and set them free: open source, free, forever. Self-host them, or let us run them and pay only the cloud they consume — at cost.

This repository is the whole company in one Next.js app: the marketing site, the blog, and **Link** — the first product, a complete Bitly alternative.

Made of zeros. White background, black ink, nothing else.

---

## What's inside

- **Site** — home, products (Link and CRM live; Track and Cal as detailed coming-soon pages), API docs, status page, and full legal (Terms, Privacy, Security). In **English, Spanish and Portuguese** (`/en`, `/es`, `/pt`, browser-detected).
- **Link** (`/app`) — the Bitly clone, feature-complete:
  - Short links with custom aliases, tags, titles
  - Password-protected links (scrypt-hashed), expiring links, max-click limits
  - UTM builder
  - QR codes (SVG and PNG)
  - Cookie-less analytics: clicks by day, referrer, country, device, browser, OS
  - Archive, search, filter, sort, pagination
  - **Public REST API v1** with personal API keys (`zs_…`), Bearer auth, 100 req/min rate limit — documented at `/docs`
- **CRM** (`/app/crm`) — the HubSpot/Zoho alternative, feature-complete:
  - Contacts with lifecycle stages, lead statuses, sources, tags, custom fields
  - Companies with domains, industries, associated contacts and deals
  - Deals with multiple pipelines, editable stages and probabilities, kanban board with drag & drop, won/lost reasons
  - Activities: notes, tasks, calls, meetings and logged emails in a unified timeline per record
  - Task trays: overdue, today, upcoming, done
  - Static and dynamic lists (segments), saved views, bulk actions
  - Duplicate detection and merge, CSV import with column mapping and dedupe, one-click CSV/JSON export of everything
  - Reports: funnel, weighted forecast, won vs lost by month, sources, lifecycles, activity mix, average days to close
  - Same **public API v1** (`/api/v1/crm/*`) — same keys, same rate limit
- **Blog** — 30 posts per locale, Markdown in `content/blog/{en,es,pt}/`.
- **Auth** — Google OAuth via next-auth, plus a demo mode to explore the dashboard without credentials.

## Quickstart

```bash
npm install
cp .env.example .env.local   # then fill in the values (see below)
npm run seed                 # demo user, 12 links, ~450 clicks, 200 contacts, 40 companies, 65 deals, demo API key
npm run dev                  # http://localhost:3000
```

With `DEMO_MODE=true` (the default in `.env.example`) you can open `http://localhost:3000/en/app` (Link) and `http://localhost:3000/en/app/crm` (CRM) and use both dashboards immediately — no Google credentials needed.

The seeded demo includes a password-protected link: `http://localhost:3000/tryit` (password: `ceros`).

Production build:

```bash
npm run build && npm start
```

## Environment variables

| Variable | What for |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth. Create at [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) with authorized redirect URI `<NEXTAUTH_URL>/api/auth/callback/google`. |
| `NEXTAUTH_SECRET` | Session signing. Generate with `openssl rand -base64 32`. |
| `NEXTAUTH_URL` | Canonical app URL, e.g. `http://localhost:3000`. |
| `TURSO_DATABASE_URL` | Optional. Unset → local SQLite file at `data/zerosoftware.db`. Set to `libsql://<db>.turso.io` → remote [Turso](https://turso.tech) database (what production uses). |
| `TURSO_AUTH_TOKEN` | Auth token for the remote Turso database (`turso db tokens create <db>`). Ignored for local files. |
| `DEMO_MODE` | `true` = everyone is the shared demo user, no login. **Never in production.** |
| `SHORT_DOMAIN` | Public domain shown in short URLs, e.g. `zs.ai`. No trailing slash. |

## API v1

Every key is created in `/app/settings` and shown exactly once. The seed prints a demo key (`zs_demo_…`).

```bash
curl -X POST http://localhost:3000/api/v1/links \
  -H "Authorization: Bearer zs_demo_…" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/a/very/long/url", "slug": "my-link", "tags": ["demo"]}'
```

Endpoints: `POST /api/v1/links`, `GET /api/v1/links`, `GET /api/v1/links/:id/stats`. CRM: `GET/POST /api/v1/crm/contacts|companies|deals|tasks` plus `GET/PATCH` on `/:id`. Full reference with errors and examples at `/docs` (or `app/[locale]/docs/page.tsx`).

## Data and self-hosting

The app talks to a libSQL database. Locally it is a single SQLite file at `data/zerosoftware.db` — backup = copy that file, there is no other state. In production it is a remote [Turso](https://turso.tech) database selected purely by env vars (`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`), no code changes.

Production runs on Vercel + Turso at `https://zerosoft.ai`:

```bash
vercel link                                    # once
vercel env add TURSO_DATABASE_URL production   # libsql://<db>.turso.io
vercel env add TURSO_AUTH_TOKEN production
vercel env add NEXTAUTH_URL production         # https://zerosoft.ai
vercel env add NEXTAUTH_SECRET production
vercel env add GOOGLE_CLIENT_ID production
vercel env add GOOGLE_CLIENT_SECRET production
vercel env add SHORT_DOMAIN production         # zerosoft.ai
vercel --prod
```

To self-host on any $5 VPS instead:

```bash
git clone <repo> && cd zerosoft.ai
npm install && npm run build
# set .env.local: NEXTAUTH_URL, NEXTAUTH_SECRET, Google credentials, SHORT_DOMAIN=your-domain
npm start   # behind any reverse proxy with HTTPS
```

Export everything, always: links and analytics are yours (JSON via API, and the SQLite file itself if self-hosted). No hostages.

## Structure

```
app/                  Next.js App Router
  [locale]/           en / es / pt pages (home, products, blog, docs, legal, status)
  [locale]/app/       Link dashboard + CRM dashboard (crm/ sub-section)
  api/                links CRUD, keys, v1 public API (+ /api/v1/crm), auth
  r/[slug]/           the redirect engine (302 + cookie-less click tracking)
components/           UI (ZeroField canvas, header/footer, link/* dashboard, crm/* CRM, products/* mockups)
content/blog/         30 posts × 3 locales, Markdown with frontmatter
i18n/                 routing + request config (next-intl)
lib/                  db, auth, links, crm, analytics, rate limit, blog loader
messages/             en / es / pt UI strings
middleware.ts         locale negotiation + short-link passthrough
scripts/seed.ts       demo data (Link) · scripts/seed-crm.ts (CRM) — both run via npm run seed
styles/               globals.css, pages.css, link.css, crm.css (no Tailwind, hand-rolled)
legacy/               the original static prototype, kept for reference
```

## Stack

Next.js 14 (App Router) · TypeScript · better-sqlite3 · next-intl · next-auth v4 · zero CSS frameworks.

## License

Open source. Take it, host it, modify it. That's the whole point.
