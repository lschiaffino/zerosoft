# AGENTS.md

Guidance for coding agents (and the people driving them) working in this
repository. Humans should read [CONTRIBUTING.md](CONTRIBUTING.md) too; this
file is the short, operational version. Follow [AI_POLICY.md](AI_POLICY.md):
the person who opens the pull request must understand and test the change.

## Stack

- Next.js 15 App Router, React 19, TypeScript (strict).
- next-intl with three locales: `en`, `es`, `pt`. Strings in
  `messages/<locale>/<app>.json`.
- libSQL through `lib/db.ts`: a local SQLite file in development, Turso in
  production. No ORM.
- Plain CSS in `styles/`, with design tokens in `styles/themes/default.css`
  (light) and `styles/themes/dark.css` (dark). No Tailwind, no CSS-in-JS.
- Vitest (`tests/unit`) and Playwright (`tests/e2e`).

## Where things are

- App pages: `app/[locale]/app/<app>/`. Note `calendar` for Cal and `links`
  for Link.
- App API routes: `app/api/<app>/`. Public API: `app/api/v1/`.
- Server logic: `lib/<app>.ts`, `lib/<app>-*.ts`, or `lib/<app>/`.
- Components: `components/<app>/`.
- App registry: `lib/products.ts`.
- Session and workspace: `lib/session.ts`, `lib/workspace.ts`, `lib/teams.ts`.
- Migrations: `lib/schema/migrations.ts`.
- Crons: `app/api/cron/minute` (every minute), `app/api/cron/tick` (hourly),
  `app/api/cron/robots` (every 5 minutes), `app/api/cron/send-render` (every
  minute), `app/api/cron/calls` (every minute: Calls scheduling, the recording
  bot and transcription).
- Separate services: `services/calls-bot/` (the Calls meeting bot, Docker on
  Railway; protocol in `docs/calls-bot.md`). Not part of the Next.js build.
- Enterprise code: `ee/`. Do not edit it in outside contributions.

## Setup without network

```bash
npm install
cp .env.offline.example .env.local
npm run seed
npm run dev
```

`.env.offline.example` enables `DEMO_MODE` and the `*_FAKE` flags, which swap
every external provider (AI models, Google, Microsoft, Slack, Stripe,
WhatsApp and others) for local fakes. When you add an integration with an
external service, add a fake behind a `<APP>_<THING>_FAKE` flag, use it in
`playwright.config.ts`, and list it in `.env.offline.example`.

## Checks

Run before you report a change as done:

```bash
npm run typecheck
npm run lint
npm test
npx tsx scripts/check-ee-boundary.ts
```

The full e2e suite is heavy and CI shards it. Locally, build once and run the
specs that cover your change:

```bash
npm run build
CI=1 npx playwright test tests/e2e/<area>*.spec.ts
```

Use `E2E_PORT` to avoid port clashes when several suites run at once.

## Definition of done

A feature is done when a person can use it end to end, not when its tests
pass.

1. **Tried in the browser.** Build (`npm run build`), start the app, and walk
   through the flow as a user (Playwright or a real browser). If you could
   not, say so plainly in your report: a change isn't merged without that
   pass.
2. **Meets the common list for every app** (below), not only what was asked.
3. **Tests.** Unit tests in `tests/unit` for logic. If what the user sees
   changes, e2e tests in `tests/e2e`. If you add tabs, columns or events,
   update the tests that count them. Keep `tests/e2e/app-smoke.spec.ts`, which
   runs the common list across all apps, up to date.
4. **Checks pass** (above), and CI is green.

### Common list for every app

Everything a person creates (page, note, board, project, issue, contact, link,
flow, agent, robot, widget, event type):

- shows up in the app's list and, if the app has a sidebar list (like Docs or
  Board), there too, with the open one marked;
- can be found with Cmd+K;
- can be opened, renamed and deleted, and the list and sidebar update without
  a reload;
- has a clear empty state, a loading state and an error message;
- looks right in light and dark mode and at 390px wide, with no horizontal
  scroll;
- works from the keyboard: visible focus, Esc closes, Enter confirms.

The reference for the experience is the app we replace (Notion for Docs,
Linear for Track, HubSpot for CRM, and so on). If something is obvious there,
it should be here too.

## Conventions

- **i18n.** Add every new string to `en`, `es` and `pt` in the same change.
  Never hardcode user-facing text in components.
- **Data scoping.** Every query on user data is scoped to the current
  workspace from the session. Never trust an id from the request without
  checking that it belongs to that workspace.
- **Migrations.** Append a new entry at the end of the list in
  `lib/schema/migrations.ts` with the next id (`NNN_short_name`). Never edit,
  reorder or remove a published migration or `lib/schema/baseline.ts`.
  Migrations must tolerate running twice and in parallel (`IF NOT EXISTS`,
  `addColumn`).
- **Crons.** Work done from a cron claims each row first (compare-and-set) so
  two overlapping runs never do the same thing twice.
- **ee/ boundary.** Core code imports from `ee/` only through
  `ee/lib/license.ts` (`isEnterprise()`, `hasFeature()`). Every file in `ee/`
  carries the `SPDX-License-Identifier: LicenseRef-Zerosoft-EE` header.
- **Design.** Reuse existing components and tokens. No pill shapes or large
  radii.
- **Copy.** Plain and concrete. No em dashes, no "it's not X, it's Y", no
  "no X, no Y, no Z" triads, no "free forever", no invented metrics or
  testimonials, and no claims about features that don't exist. Voice guide:
  `docs/voice.md` (`tests/unit/copy-lint.test.ts` enforces the mechanical
  part on the site's JSON).
- **Backlog.** `research/ideas.json` feeds the public roadmap board (see
  `research/README.md`). When you build an idea from it, mark it
  `"status": "done"` with the id of its entry in `content/changelog.ts`.
- **Feature parity.** When you add or remove a capability, update
  `content/feature-parity/<app>.ts` (`status` and `lastReviewed`). The parity
  percentage on each product page comes from there.
- **Security.** Security bugs never go on the public board or in public
  issues: fix them directly, and report them privately as described in
  [SECURITY.md](SECURITY.md).

## Pull requests

- One change per pull request, with a description of what you tested.
- Disclose AI assistance in the template.
- The author signs the [CLA](CLA.md) once, through the bot comment.
