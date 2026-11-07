# Self-hosting zerosoft

Every app in this repository runs on your own server under the AGPLv3. This
page covers running it in production. For local development, see
[CONTRIBUTING.md](../CONTRIBUTING.md).

## With Docker

```bash
git clone https://github.com/lschiaffino/zerosoft && cd zerosoft
cp .env.example .env          # set NEXTAUTH_URL, NEXTAUTH_SECRET, SHORT_DOMAIN and a sign-in method
docker compose up -d          # http://localhost:3000, put any HTTPS reverse proxy in front
```

Data lives in two volumes: `zerosoft-data` (the SQLite file) and
`zerosoft-uploads` (attachments). Back them up and you have everything.

Without Docker: `npm ci && npm run build && npm start`.

## Database

The app talks to a libSQL database. By default it is a single SQLite file at
`data/zerosoftware.db`: to back up, copy that file. To use a remote
[Turso](https://turso.tech) database instead, set `TURSO_DATABASE_URL` and
`TURSO_AUTH_TOKEN`. No code changes are needed. Migrations run on start.

## Reverse proxy and client IPs

Your reverse proxy must add the client address to `X-Forwarded-For` (nginx:
`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`; Caddy and
Traefik do it by default). Rate limits per IP read the rightmost entry; with
more than one proxy in a chain, set `TRUST_PROXY_HOPS`.

**If nothing sits in front of the app, set `TRUST_PROXY=0`.** Otherwise a
client can send its own `X-Forwarded-For` and pick its rate-limit bucket. This
includes sign-in by email code: its limits (codes sent, codes checked, the
daily lockout) are counted per IP. With `TRUST_PROXY=0` those limits are shared
by everyone on the server, so if your team signs in by email code, prefer a
reverse proxy over `TRUST_PROXY=0`.

## Crons

Background work runs from HTTP endpoints protected by `CRON_SECRET` (sent as a
Bearer token). On Vercel, `vercel.json` schedules them. Self-hosted, call them
from cron or a systemd timer:

| Endpoint | How often | What it does |
| --- | --- | --- |
| `/api/cron/minute` | every minute | Flow queue (schedules, delays, retries), Cal reminders, workflow steps |
| `/api/cron/tick` | every hour (or more often) | Flow and Robots schedules, webhook retries, daily jobs |
| `/api/cron/robots` | every 5 minutes | Due robot runs, one per workspace in parallel (`ROBOTS_CRON_CONCURRENCY` caps it) |
| `/api/cron/send-render` | every minute | Send document rendering, kept apart for memory |

```bash
* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/minute
```

Every job claims its rows before working on them, so overlapping runs are safe.

## Robots and Flow

- **Robots** run in a local headless Chromium by default when `ROBOTS_RUNNER`
  is unset: `npm ci` installs `playwright-core`; add the browser once with
  `npx playwright-core install --with-deps chromium` (or point
  `ROBOTS_CHROMIUM_PATH` at an installed Chrome). `ROBOTS_RUNNER=none`
  disables runs. The same SSRF guard as webhooks blocks private hosts unless
  `ALLOW_PRIVATE_WEBHOOKS=true` or the host is in `ROBOTS_ALLOWED_PRIVATE_HOSTS`.
- **Schedules** use 5-field cron expressions with a time zone; robot intervals
  are at least 15 minutes.
- **Credentials** for integrations (Slack, Google Sheets, Stripe, Notion,
  Discord, Telegram, API keys, logins) live in `/app/flow/credentials`,
  encrypted per workspace. Keep `CREDENTIALS_KEY` (or `NEXTAUTH_SECRET`)
  stable.
- **Code node** needs Vercel Sandbox credentials (`FLOW_CODE_RUNNER=sandbox`
  plus `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`). Without them it
  stays disabled. User code never runs inside the app process. Runs are capped
  per workspace by `FLOW_CODE_RUNS_PER_HOUR` (default 300) and
  `FLOW_CODE_RUNS_PER_DAY` (default 2000); set either to `unlimited` to lift it.

## Managed services: bring your own

On Zerosoft Cloud we run a few services for you and bill them by usage.
Self-hosted, you bring your own:

- **AI.** Set `AI_GATEWAY_API_KEY` (Vercel AI Gateway) and, for the platform
  assistant, `OPENROUTER_API_KEY`. Set `AI_FREE_TOKENS_PER_MONTH=unlimited` so
  your own key isn't capped by the cloud quota. Without a key, AI features are
  off and the rest of the app works.
- **WhatsApp for Groups.** Connect a number through the WhatsApp Cloud API
  (Meta) or your own [WAHA](https://waha.devlike.pro) or
  [Evolution API](https://github.com/EvolutionAPI/evolution-api) server from the
  Groups settings. The "managed" option uses our server and is only available
  on the cloud (`GROUPS_BRIDGE_URL` and `GROUPS_BRIDGE_KEY` point at it).
- **Email.** Set `RESEND_API_KEY` and `EMAIL_FROM`. Without it, emails are
  logged to the console.

## Enterprise features

SSO/SAML, SCIM, audit export, custom roles, white-label and multi-workspace
admin live in `ee/` and need a license key in production
(`ZEROSOFT_LICENSE_KEY`). See [ee/README.md](../ee/README.md). Everything else
works without one.

## Environment variables

`.env.example` lists every variable with comments. The main ones:

| Variable | What for |
| --- | --- |
| `NEXTAUTH_URL` | Canonical app URL, for example `https://zerosoft.example.com`. |
| `NEXTAUTH_SECRET` | Session signing. Generate with `openssl rand -base64 32`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in. Create at [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) with the redirect URI `<NEXTAUTH_URL>/api/auth/callback/google`. The Gmail and Google Calendar integrations use the same client (redirect URIs in `.env.example`). |
| `RESEND_API_KEY` / `EMAIL_FROM` / `RESEND_EMAIL_DOMAIN` | Transactional email and sign-in by email code. Unset: emails are logged to the console. |
| `EMAIL_LOGIN_DISABLED` | `true` turns off sign-in by email code. |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Optional remote libSQL database. Unset: local SQLite file at `data/zerosoftware.db`. |
| `DEMO_MODE` | `true` makes everyone the shared demo user, with no sign-in. Ignored when `NODE_ENV=production` unless `DEMO_MODE_ALLOW_PRODUCTION=true`. Never on a real deployment. |
| `SHORT_DOMAIN` | Public domain shown in short URLs, for example `zs.example.com`. No trailing slash. |
| `NEXT_PUBLIC_SITE_URL` | Public site URL for canonical links, sitemap and structured data. |
| `NEXT_PUBLIC_GITHUB_REPO` | `owner/name` of the source repository the site links to. Set it in a fork. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob for uploads. Required on Vercel. Elsewhere, unset: files go to `UPLOADS_DIR` (default `data/uploads`) and are always served through access-checked routes. |
| `CRON_SECRET` | Required in production for the cron endpoints above. |
| `ENCRYPTION_KEY` | Encrypts OAuth tokens and webhook secrets at rest. Unset: derived from `NEXTAUTH_SECRET`. |
| `CREDENTIALS_KEY` | Optional dedicated key for Flow and Robots credentials (AES-256-GCM, bound to each workspace). Rotating it means re-entering saved credentials. |
| `FLOW_CODE_RUNNER` | `sandbox` or `none`. See "Robots and Flow". |
| `ROBOTS_RUNNER` | `sandbox`, `local` or `none`. Default: `sandbox` on Vercel, `local` elsewhere when `playwright-core` is installed. |
| `VERCEL_TOKEN` / `VERCEL_PROJECT_ID` / `VERCEL_TEAM_ID` | On Vercel, Link custom domains are added to the project through the Vercel API. Self-hosted, leave unset: domains are verified by DNS. |
| `APP_HOSTS` | Extra hostnames that serve the app (comma-separated), so they aren't treated as custom short-link domains. |
| `TRUST_PROXY_HOPS` / `TRUST_PROXY` | Client IP for rate limits. See "Reverse proxy and client IPs". |
| `ALLOW_PRIVATE_WEBHOOKS` | `true` allows webhooks and robots to reach private hosts and plain http (self-hosting on a private network). Never on a public server. |
| `AI_GATEWAY_API_KEY` / `AI_MODEL` | AI features through the Vercel AI Gateway. |
| `OPENROUTER_API_KEY` / `ASSISTANT_MODEL` | The platform assistant (Cmd+J). |
| `AI_FREE_TOKENS_PER_MONTH` / `AI_RATE_LIMIT_PER_MINUTE` / `AI_ENABLED` | AI quota per workspace, rate limit, and an off switch. |
| `ZEROSOFT_LICENSE_KEY` | Enterprise license key for `ee/` features (optional). |
| `ADMIN_EMAILS` | Emails that can see the feedback, roadmap and changelog admin pages. |

Social network apps (Meta, LinkedIn, X, TikTok, YouTube, Threads) are covered
in [social-networks.md](social-networks.md).
