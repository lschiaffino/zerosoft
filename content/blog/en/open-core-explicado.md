---
title: "Open core, explained: what's free, what's /ee, and why the line is there"
description: "Every Zerosoft product is AGPL. One folder, /ee, isn't. Here's exactly what lives there, what its draft license says, what's actually built today and how we decided where to draw the line."
date: "2026-08-15"
author: "Zerosoftware"
tags: ["open source", "open core", "licensing"]
---

"Open core" is one of those phrases that can mean anything from "genuinely open with a few paid extras" to "a crippled demo with a GitHub repo". So instead of defining it in the abstract, here's ours, with the folder names.

Zerosoft is one repository. Everything in it is AGPLv3 — except one folder called `/ee`. That's the whole model. The rest of this post is about what goes in that folder, what doesn't, and why.

## What's in the core (all of it, basically)

Every product feature you use day to day is outside `/ee`, under [AGPLv3](/blog/por-que-agpl):

- **Link:** custom aliases, QR codes, bulk create, custom domains, link-in-bio pages, webhooks, cookie-less analytics, the public API.
- **CRM:** contacts, companies, deals with multiple pipelines, lists, custom fields, reports and dashboards, workflows, import and export.
- **Track, Cal, Chat, Docs:** all of it. Cycles and Gantt views, routing forms and round-robin hosts, SLA policies and CSAT, nested pages and sharing.
- **Teams:** workspaces with owner, admin and member roles, invites, and admin-only actions like CRM workflows, export and bulk delete.

None of that requires a license key. None of it is "free up to N users". Self-hosting all six products costs nothing, forever. Our own [ee/README.md](https://github.com/lschiaffino/zerosoft/blob/main/ee/README.md) puts it bluntly: everything outside `/ee` is AGPLv3 "and always will be".

## What lives in /ee

The list is short and, today, mostly a plan. The README says "what lives here (as it gets built)":

- **SSO / SAML and SCIM provisioning** — log in with your company's identity provider, provision and deprovision users automatically.
- **Audit logs** — who did what, when, for compliance.
- **Custom roles and granular permissions** — beyond owner / admin / member.
- **White-label** — remove Zerosoft branding from booking pages and the chat widget.

Let's be precise about status, because that's the point of this blog: **these features are in development.** What exists in the folder today is the licensing plumbing — `ee/lib/license.ts`, which verifies a license key — and the license text itself. If you need SAML next week, Zerosoft isn't there yet, and we'd rather you hear it from us.

## How the plumbing works

Two rules keep `/ee` from leaking into the core:

1. **Core code never imports from `/ee`** except through `ee/lib/license.ts`, which exposes `isEnterprise()` and `hasFeature()`.
2. **Enterprise features must degrade cleanly.** Without a license, the core keeps working exactly the same.

License keys are verified **offline**: an Ed25519 signature over a small JSON payload (customer, expiry date, features). No phone-home, no telemetry, no server of ours that has to be up for your instance to work. You set `ZEROSOFT_LICENSE_KEY` in your environment; if it's missing or invalid, `/ee` simply stays off.

## What the /ee license says

The [Zerosoft Enterprise License](https://github.com/lschiaffino/zerosoft/blob/main/ee/LICENSE) is source-available, not open source. In short — and the license text is what actually counts:

- **Development and testing are free.** Read it, copy it, modify it, run it in non-production environments without paying.
- **Production use needs a subscription** that covers your scope of use (users, instances or usage).
- **No redistribution, no reselling it as a service, no bypassing license checks.** Forks of the repo are fine, as long as `/ee` keeps its license and notices.

One more honest note: **the license is a draft pending legal review.** It says so at the top, and some of its bracketed details aren't filled in yet. It will be finalized before the first commercial sale. Until then, it states our intended terms in good faith. Questions go to hola@zerosoft.ai.

## Why the line is drawn exactly there

We had a simple test: **does a small team need it to do its job?** If yes, it goes in the core. Contacts, pipelines, booking pages, issues, a shared inbox, documents, an API, webhooks, exports — a five-person company needs all of that, so it's all free.

The `/ee` features fail that test on purpose. Nobody at a five-person company is asking for SAML. Audit logs, SCIM and fine-grained custom roles show up when there's a security team, a compliance requirement, a procurement checklist. Those are the organizations that already expect to pay for software, that need someone to answer the phone, and that get real value from a contract.

There's a second, less obvious reason: those features are where the support burden is. Identity providers are all slightly different; audit requirements are specific to industries. Charging for them funds the people who make them work.

## What we promise not to do

Open core has a known failure mode: the company slowly moves useful features from the free side to the paid side, or starts shipping new essentials only behind the license. Some open-core products got worse for their free users this way.

Our guardrails against that:

- **The core can't be taken back.** What's been published under AGPL stays AGPL. Even if we changed our minds, the last free version is forkable forever.
- **The `/ee` list is public and specific.** It's in the README. If it ever grows to include something a small team needs, you'll see it in a diff.
- **Our hosted cloud doesn't sell the core either.** Zerosoft Cloud has a generous free plan, then charges for usage — what scales — with transparent prices published before we ever charge you. We sell convenience and enterprise extras, never the features themselves.

## Who should care about /ee

Honestly, most readers of this blog shouldn't. If you're a freelancer, a startup or a small company self-hosting Zerosoft, the core is the product and you'll never touch a license key.

If you're at a larger organization that needs SSO, audit trails or custom roles: those are coming, the code will be readable before you buy, and you can test it for free. Write to us and tell us which one you need first — it genuinely helps us decide what to build next.
