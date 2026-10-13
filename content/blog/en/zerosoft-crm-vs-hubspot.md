---
title: "zerosoft CRM vs HubSpot: what each does today"
description: "Where HubSpot is far ahead, where zerosoft CRM holds up, and who should stay with HubSpot. The gaps are listed, not hidden."
date: "2026-10-05"
author: "zerosoft"
tags: ["crm", "hubspot", "comparison"]
---

HubSpot is a marketing, sales, service and content platform with a CRM in the middle, built over almost two decades by a large company. zerosoft CRM is a sales CRM: contacts, companies, deals, email, quotes, forms and the reporting around them. This post says where HubSpot wins, what zerosoft CRM does today, and who should pick which.

## The short version

- **Stay on HubSpot** if marketing runs through your CRM (campaigns, landing pages, nurture flows), if you need a large integrations marketplace, AI assistants or mobile apps, or if you need SSO and audit logs this quarter.
- **Look at zerosoft CRM** if you use the pipeline, contact records, sales email and reports, you pay for seats and tiers you don't touch, and you'd rather own the database, the API and the code.

## Where HubSpot is far ahead

**Marketing.** HubSpot runs campaigns, nurture flows, landing pages and behavior-based segmentation. zerosoft CRM has no marketing module. Sequences are sales sequences, not campaigns.

**Integrations marketplace.** HubSpot has a large app marketplace. zerosoft CRM has a REST API, signed webhooks for contact and deal events, a webhook action in workflows, and native ties to Flow, Cal, Chat and the rest of the suite.

**AI.** HubSpot ships AI assistants for writing, summarizing and prospecting. zerosoft CRM can draft an email with AI when AI is enabled, and that's it.

**Mobile.** HubSpot has iOS and Android apps. zerosoft CRM works in a mobile browser, and tables scroll sideways on a phone.

**Quotes and forms, at the edges.** zerosoft quotes have no e-signature provider and can't take payments. Forms have no multi-step pages, conditional fields, file uploads or CAPTCHA.

**Gmail at scale.** Sending and syncing as the user needs a Google OAuth client verified for restricted scopes. Until that verification is done, only test users can connect Gmail on a self-hosted instance with an unverified client.

**Enterprise.** SSO, SCIM, audit logs, field-level permissions, compliance paperwork and a partner network. Our enterprise features live in `/ee` and are in development.

## What zerosoft CRM does today

**Records and associations.** Contacts, companies and deals, with many-to-many associations, labels, a primary company, company hierarchies, tags and custom fields. Every record has a timeline, tasks and a change history.

**Pipelines.** Multiple pipelines with your own stages and probabilities, a kanban board and a table view. More in [keeping the board honest](/blog/higiene-del-pipeline).

**Sales email.** Send from the timeline through your Gmail, with templates, snippets and variables. Automatic Gmail sync logs threads to every matching contact. Open and click tracking ignores bots and scanners. Sequences send multi-step emails and tasks, and stop on reply, booking or unsubscribe.

**Products, line items and quotes.** A product catalog, line items on deals with discounts and tax, multi-currency with manual exchange rates, and quotes with a public page where the customer accepts or declines.

**Forms and lead scoring.** Hosted or embedded forms that create or update contacts, with UTM capture and anti-spam. Scoring rules on properties and recent activity.

**Lists, views, reports and dashboards.** Static and dynamic lists, saved views, a funnel, a weighted forecast, performance by source and owner, quotas, and dashboards built from widgets. Enough for [a weekly review](/blog/revision-semanal-del-crm).

**Workflows.** Triggers on records, tasks, email, meetings, quotes, forms and score changes, with actions like create a task, update a field, send an email, call a webhook, enroll in a sequence or run a Flow. Recipes in [CRM workflows that create follow-up tasks](/blog/workflows-crm-tareas-de-seguimiento).

**Teams.** Roles, record visibility (all records, own, or own plus sales team) and round-robin lead assignment.

**Import and export.** CSV import for contacts, companies and deals, with a built-in "HubSpot export" mapping preset and dedupe. Export to CSV or JSON. The [HubSpot migration guide](/blog/migrar-contactos-de-hubspot-por-csv) walks through it.

**API.** `/api/v1/crm/*` with the same personal `zs_` keys as the rest of zerosoft, with scopes, documented at [/docs](/docs).

## Pricing

HubSpot sells hubs by tier and by seat, with some products priced by marketing contacts. The numbers change often, so check their pricing page.

zerosoft CRM costs $0 to self-host under AGPLv3, with every core feature. On zerosoft Cloud there's a free tier, then per-workspace usage pricing. Seats are free, and contacts aren't billed.

## Who should stay on HubSpot

- Teams where **marketing and sales share the CRM** and run campaigns from it.
- Companies whose stack depends on **marketplace integrations**.
- Reps who work from a **phone app**.
- Teams that need **e-signature or payments on quotes**.
- Organizations that need **SSO, audit logs and custom roles** today.

## Who zerosoft CRM fits

- Small sales teams that use HubSpot for **contacts, pipeline, email and quotes** and pay for much more.
- Founders and agencies who want **pipelines, sequences and reports** without a sales call or a tier upgrade.
- **Developers** who want a documented API, full export and the option to self-host on a SQLite file or Turso.
- Teams that care about **where customer data lives**.
- Anyone already using **Cal, Link, Chat or Flow**.

## Test it with your own data

Export a slice of your HubSpot contacts, companies and deals, import them with the HubSpot preset, build one pipeline and run your next weekly review from it. An afternoon is enough to know.
