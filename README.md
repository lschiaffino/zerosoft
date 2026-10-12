# zerosoft.ai

**Software is dead.** We rebuild the tools you use every day and set them free: open source, free, forever. Self-host them, or let us run them and pay only the cloud they consume — at cost.

This repository is the whole company in one Next.js app: the marketing site, the blog, and six products — **Link, CRM, Track, Cal, Chat and Docs**.

Made of zeros. White background, black ink, nothing else.

---

## What's inside

- **Site** — home, products (all six live, each with its own detail page), API docs, status page (service list only — live monitoring is not wired up yet), and full legal (Terms, Privacy, Security). In **English, Spanish and Portuguese** (`/en`, `/es`, `/pt`, browser-detected).
- **Link** (`/app/links`) — the Bitly alternative: custom aliases, tags, password-protected / expiring / max-click links, UTM builder, QR codes (SVG and PNG), bulk create (up to 200 URLs), cookie-less analytics (day, referrer, country, device, browser, OS), per-link CSV export, and the **public REST API v1** with personal keys (`zs_…`), 100 req/min rate limit, documented at `/docs`.
  - *Known gaps:* no custom domains, no Bitly import.
- **CRM** (`/app/crm`) — the HubSpot alternative: contacts, companies, deals with multiple pipelines and a kanban board, activities timeline, tasks, static and dynamic lists, saved views, custom fields, CSV import with mapping and dedupe, CSV/JSON export, reports and dashboards, workflows (triggers on contact/deal/task/email events → email, task, field update, list, webhook, notify), Gmail read-only sync, and `/api/v1/crm/*`.
  - *Known gaps:* no time-based triggers (e.g. "deal stalled for N days"), no granular roles/permissions (team members are owner or member).
- **Track** (`/app/track`) — the Linear alternative: projects, issues with sub-issues and relations, custom statuses, priorities, estimates, cycles, list / board / calendar / Gantt views, saved views and filters, comments, attachments, activity log, notifications inbox.
  - *Known gaps:* no labels, no keyboard shortcuts, no realtime sync, no Git/GitHub integration, no public API or webhooks, no Linear import.
- **Cal** (`/app/calendar`) — the Calendly alternative: event types with custom questions, weekly availability, buffers, minimum notice and booking window, blocked slots, round-robin team hosts, routing forms, public booking pages (`/book/[slug]`), confirmation + host notification + 24h reminder emails (via Resend when `RESEND_API_KEY` is set).
  - *Known gaps:* no Google Calendar sync, no cancellation emails, no embed snippet, no public API or webhooks.
- **Chat** (`/app/chat`) — the Intercom alternative: embeddable webchat widget, shared inbox, states and priorities, assignment rules, SLA policies, canned responses, office hours, CSAT, people/visitors, and an auto-answer bot.
  - *Known gaps:* the bot is keyword matching over canned responses and docs pages, not an LLM; no conversation export.
- **Docs** (`/app/docs`) — the Notion alternative: block editor with slash menu and inline formatting, nested pages, `[[` page mentions, templates, comments, trash, title search, sharing (public / team / single user).
  - *Known gaps:* no realtime co-editing, no JSON/Markdown export, no Notion import.
- **Blog** — 30 posts per locale, Markdown in `content/blog/{en,es,pt}/`.
- **Auth** — Google OAuth via next-auth, plus a demo mode to explore the dashboard without credentials.

## Quickstart

```bash
npm install
cp .env.example .env.local   # then fill in the values (see below)
npm run seed                 # demo user, 12 links, ~450 clicks, 200 contacts, 40 companies, 65 deals, demo API key
npm run dev                  # http://localhost:3000
```

With `DEMO_MODE=true` (the default in `.env.example`) you can open `http://localhost:3000/en/app` and use every dashboard (Link, CRM, Track, Cal, Chat, Docs) immediately — no Google credentials needed.

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
| `DEMO_MODE` | `true` = everyone is the shared demo user, no login. Ignored when `NODE_ENV=production` unless `DEMO_MODE_ALLOW_PRODUCTION=true`. |
| `RESEND_API_KEY` / `EMAIL_FROM` | Transactional email (booking confirmations, reminders). Unset → emails are logged to the console. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob for file uploads. Required on Vercel; elsewhere, unset → files go to `public/uploads`. |
| `CRON_SECRET` | Required in production for `/api/calendar/reminders/due` (Vercel Cron sends it as a Bearer token). |
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
  [locale]/app/       product dashboards: links/, crm/, track/, calendar/, chat/, docs/
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
```

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · @libsql/client (local SQLite file or Turso) · next-intl · next-auth v4 · zero CSS frameworks.

## License

Open source. Take it, host it, modify it. That's the whole point.
