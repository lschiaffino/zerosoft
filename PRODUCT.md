# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
In priority order:
1. Small teams and startups (2–50 people, founders first) replacing paid SaaS (Bitly, Calendly, HubSpot, Linear, Intercom, Notion, n8n) with one suite. Daily, operational use: they live in Link, Cal, CRM, Track, Chat.
2. Developers who self-host the open source core on their own infra. They value the API, docs, webhooks and control.
3. Individuals (freelancers, creators) using Link, Cal, Notes, Board for themselves.

## Product Purpose
zerosoft rebuilds the software people pay for every month and sets it free. Success: a team cancels its subscriptions and runs on zerosoft without missing anything that matters.

## Positioning
"El software murió." Open source core (AGPLv3, `/ee` commercial): self-host every product for $0. Or zerosoft Cloud: generous free tier per workspace, then transparent usage-based pricing (price = cost × 3, both numbers shown), seats free. No competitor can truthfully claim open source + cost shown next to price.

## Operating Context
- One Next.js app is the whole company: marketing site, blog, docs, and 11 apps (Link, CRM, Cal, Track, Chat, Docs, Flow, Agents, Notes, Board, Robots) under `/[locale]/app/<product>`.
- Locales en / es / pt; Latin America is the home market. Spanish-first team.
- Catalog split: "Para equipos (B2B)" and "Para vos (Personal)".
- Public surfaces: product sites, /roadmap, /changelog, /feedback, booking pages, link-in-bio, help centers; planned: feedback.zerosoft.ai (public backlog with votes) and branding.zerosoft.ai (brand guidelines).
- Feedback from the in-app widget and support Chat feeds the roadmap; shipped items link to the changelog.

## Capabilities and Constraints
- Next.js 15 App Router, plain CSS (no Tailwind), next-intl, libsql/Turso, next-auth (Google), Vercel (Fluid Compute, Sandbox, AI Gateway).
- Don't advertise features before they are in production ("Próximamente").
- Every product keeps its own color.

## Brand Commitments
- Name: zerosoft, lowercase.
- The zeros ("los ceros") are the brand system: logo, separators, numbering, OG images. Rebrand keeps the zeros and per-product colors; logo, type, neutral palette and visual voice are open for redesign (decided 2026-10-16).
- Founder taste: minimal like Apple/Linear; no tags/pills, no heavily rounded corners (reads as "Claude slop").
- Copy voice: dry and concrete (Apple/Linear) plus one well-edited manifesto. Banned: "no es X, es Y", "sin…" triads, em dashes, "gratis/para siempre" slogans.

## Evidence on Hand
- Live product at zerosoft.ai; public repo github.com/lschiaffino/zerosoft.
- Real changelog in `content/changelog.ts`; 66 blog posts per locale in `content/blog/`.
- No customer testimonials, logos or usage metrics yet: do not fabricate them.

## Product Principles
1. Replace, don't approximate: each app must stand next to the product it replaces.
2. Honest by default: show real cost, real status, real gaps.
3. Simple first, power on demand: the basic path is short; advanced options live behind "Avanzado".
4. One suite, one feel: apps share navigation, settings and patterns; color tells you where you are.
5. Open: everything self-hostable, documented API and webhooks.

## Accessibility & Inclusion
WCAG 2.2 AA contrast and keyboard access across app and site; three locales with no hardcoded UI strings.
