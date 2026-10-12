# Contributing to Zerosoft

Thanks for helping. Zerosoft is one Next.js app containing six products: Link, CRM, Track, Cal, Chat and Docs.

## Setup

```bash
npm install
cp .env.example .env.local   # DEMO_MODE=true lets you use the app without Google OAuth
npm run seed
npm run dev                  # http://localhost:3000
```

## Before opening a PR

```bash
npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e
```

CI runs exactly these. A PR needs all of them green.

## Ground rules

- **Data scoping.** Every query that reads or writes user data must be scoped to the current workspace (`user.id` / `user.team`). Add a test when you touch access control.
- **Schema changes** go in a new migration in `lib/schema/migrations.ts`. Never edit a published migration or `baseline.ts`.
- **i18n.** UI strings live in `messages/{en,es,pt}`. Keep the three locales in key parity.
- **Honest marketing.** Product pages may only claim features that exist in `main`.
- **Licensing.** Code outside `/ee` is AGPLv3. Code inside `/ee` is under the Zerosoft Enterprise License; core code must not depend on it except through `ee/lib/license.ts`. By contributing you agree your contribution is licensed under the license of the folder you change.

## Commit style

Conventional-ish: `feat(cal): …`, `fix(link): …`, `chore(ci): …`. Spanish or English are both fine.
