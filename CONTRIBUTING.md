# Contributing to zerosoft

Thanks for helping. This guide covers what we accept, how the code is laid
out, how to run it offline, and what a pull request needs to be merged.

## Scope

zerosoft rebuilds the tools teams pay for (HubSpot, Linear, Notion, Calendly,
Intercom and more) as one open source app. Good contributions:

- bug fixes, with a test that fails before the fix;
- features that the tool we replace has and we don't (each app's product page
  shows its feature parity, from `content/feature-parity/<app>.ts`);
- translations and copy fixes in English, Spanish or Portuguese;
- accessibility, performance and self-hosting improvements.

**Issue first for anything big.** A new feature, a new table, a new
dependency, or a change that touches more than one app needs an issue where a
maintainer agrees on the approach before you write code. Small fixes can go
straight to a pull request.

Out of scope for outside contributors: anything under `ee/` (see
[Licensing and the CLA](#licensing-and-the-cla)), and security issues, which
go to security@zerosoft.ai privately (see [SECURITY.md](SECURITY.md)).

## How issues and pull requests work

- **Issues aren't assigned.** You don't need permission to work on an open
  issue. If several pull requests fix the same thing, we merge the first one
  that is correct, tested and green. Comment on the issue if you start
  something large, so others can see it.
- **Labels** tell you where to start:
  - `good first issue`: small and well scoped.
  - `help wanted`: we'd welcome a PR.
  - `app:<name>` (for example `app:crm`, `app:track`): which app it touches.
  - `size:xs` to `size:xl`: rough effort. `size:l` and up need an agreed
    approach in the issue first.
  - `ee`: an enterprise feature. Built by the core team only.
  - `needs triage`: not reviewed by a maintainer yet.
- Keep each pull request to one change. Large rewrites mixed with fixes are
  hard to review and will be asked to split.

## Architecture map

One Next.js 15 App Router app. Every product follows the same layout:

| What | Where |
| --- | --- |
| Pages of an app | `app/[locale]/app/<app>/` (for example `app/[locale]/app/crm/`) |
| API routes of an app | `app/api/<app>/` |
| Public REST API | `app/api/v1/` |
| Server logic | `lib/<app>.ts` and `lib/<app>-*.ts` (for example `lib/crm.ts`, `lib/crm-import.ts`); a few apps use `lib/<app>/` |
| UI components | `components/<app>/` |
| UI strings | `messages/<locale>/<app>.json` for `en`, `es` and `pt` |
| Styles | `styles/` with tokens in `styles/themes/default.css` (light) and `styles/themes/dark.css` (dark) |
| Database schema | One file per migration in `lib/schema/migration-files/` (the older numbered list is `lib/schema/migrations.ts`) |
| Database client | `lib/db.ts` (libSQL: a local SQLite file, or Turso) |
| Session, workspace and permissions | `lib/session.ts`, `lib/workspace.ts`, `lib/teams.ts` |
| App registry (names, paths, categories) | `lib/products.ts` |
| Background jobs | `app/api/cron/minute` (every minute), `app/api/cron/tick` (hourly), `app/api/cron/robots` (every 5 minutes), `app/api/cron/send-render` (every minute) |
| Marketing site and blog | `app/[locale]/` and `content/blog/<locale>/` |
| Enterprise features | `ee/` (separate license) |
| Tests | `tests/unit/` (Vitest) and `tests/e2e/` (Playwright) |

Note that a few paths differ from the app name: Cal lives at
`app/[locale]/app/calendar`, and Link at `app/[locale]/app/links`.

## Offline development

You don't need any account or API key. `.env.offline.example` turns on demo
mode and replaces every external provider (AI models, Google, Microsoft,
Slack, Stripe, WhatsApp, Notion and others) with a local fake:

```bash
npm install
cp .env.offline.example .env.local
npm run seed
npm run dev          # http://localhost:3000/en/app
```

Each flag is commented in the file. The same fakes are what the end-to-end
tests use (see `playwright.config.ts`), so a feature that works offline is a
feature the e2e suite can cover.

If you need a real provider, copy the relevant variable from `.env.example`
into `.env.local`. Never commit `.env.local` or real keys.

## Checks

Run these before you push:

```bash
npm run typecheck                    # tsc --noEmit
npm run lint                         # eslint, zero warnings
npm test                             # vitest, unit tests
npx tsx scripts/check-ee-boundary.ts # ee/ headers and imports
```

The end-to-end suite is heavy: more than 140 Playwright specs against a
production build. CI runs it on every pull request, split into shards, so you
don't need to run all of it locally. Run the specs for the area you changed:

```bash
npm run build
CI=1 npx playwright test tests/e2e/crm-import.spec.ts
```

Set `E2E_PORT` to run on a port other than 3210. A pull request is mergeable
when the "CI result" check is green.

## Rules for code

**Definition of done.** A feature is done when a person can use it from start
to finish in the browser, not when its tests pass. Everything a person creates
(a page, contact, issue, flow, event type and so on) must show up in the app's
list, be findable with Cmd+K, open, rename and delete without a reload, have
empty, loading and error states, work in light and dark mode and at 390px
wide, and work from the keyboard. `tests/e2e/app-smoke.spec.ts` checks this
across all apps; keep it up to date.

**i18n.** Every UI string goes in `messages/<locale>/<app>.json`, and you add
it to `en`, `es` and `pt` in the same pull request, so the three locales keep
the same keys. If you can't write one of the languages,
add your best attempt and say so in the PR; a maintainer will fix it.

**Data scoping.** Every query that reads or writes user data is scoped to the
current workspace (the session from `lib/session.ts`). Never trust an id from
the request without checking it belongs to that workspace. Add a test when you
touch access control.

**Migrations.** Schema changes go in a new file in
`lib/schema/migration-files/`, named and with the id
`YYYYMMDD_HHMM_short_name` (UTC, for example `20261113_0415_crm_quotes`).
Never edit, reorder or delete a published migration, and never edit
`lib/schema/baseline.ts`. Migrations must be safe to
run twice and in parallel (`IF NOT EXISTS`, `addColumn`).

**Crons.** Anything that runs from a cron claims each row first (a
compare-and-set update) so two overlapping runs never do the same work twice.

**Design and copy.** Use the existing components and tokens. No pill shapes or
large radii. In product copy: no em dashes, no invented metrics or
testimonials, and no claims about features that don't exist in `main`.

**Feature parity.** When you add or remove a capability, update
`content/feature-parity/<app>.ts` (`status` and `lastReviewed`).

**Commits.** Short, imperative subject lines. Prefixes like `feat(cal):` or
`fix(link):` are welcome but not required.

## Licensing and the CLA

- Everything outside `ee/` is AGPLv3. Your contribution is published under
  the AGPLv3.
- **Sign the CLA once.** On your first pull request, a bot asks you to sign
  the [Contributor License Agreement](CLA.md) by posting a comment. You keep
  the copyright in your work; the CLA gives us a broad license to use it,
  including the right to relicense it. We can't merge a pull request until
  every author has signed.
- **`ee/` doesn't accept outside pull requests.** It holds the enterprise
  features under a separate license (see [ee/README.md](ee/README.md)). Core
  code must not import from `ee/` except `ee/lib/license.ts`; CI enforces
  this.

## AI-assisted contributions

Welcome, with conditions: you understand and have tested every line, and you
say in the pull request that you used AI. See [AI_POLICY.md](AI_POLICY.md). If
you use a coding agent, point it at [AGENTS.md](AGENTS.md).

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
