---
title: "One suite or a separate tool for each job: the trade-offs"
description: "Shared login, one database and one search, or specialized products that go deeper. What zerosoft's apps share today, what they don't, and when to pick specialists."
date: "2026-09-27"
author: "zerosoft"
tags: ["product", "tools", "architecture"]
---

There are two ways to equip a small company with software. You pick the best tool for each job (a link shortener, a CRM, an issue tracker, a scheduler, a support inbox, a wiki) and glue them together. Or you pick one suite that does all six, a bit less deeply, but in one place.

zerosoft is the second kind. That makes us biased, so this post tries hard to be fair: what being "integrated" actually buys you in our case (verified in the code, not on a slide), what it doesn't, and when six specialized tools are simply the better answer.

## What "integrated" means in zerosoft, concretely

"Integrated suite" is a phrase that often hides a bundle of separate apps with a shared logo. So here's what our eleven apps share today:

- **One app, one login.** CRM, Chat, Agents, Flow, Robots, Track, Link, Docs, Notes, Cal and Board are one Next.js application. You sign in once with Google and you're in all of them.
- **One workspace model.** Teams work the same way everywhere: an owner invites people, each member is owner, admin or member, and members operate inside the shared workspace. Invite your colleague once; they don't need to be added to each tool.
- **One notifications inbox.** Track mentions, assignments, status changes and comments, new Chat messages, and the CRM's "notify user" workflow action all land in the same inbox.
- **Chat knows your CRM.** When a visitor in a Chat conversation has an email that matches a CRM contact, the conversation's side panel shows that contact with a link straight to their record.
- **One Google connection setup.** The CRM's Gmail sync and Cal's Google Calendar sync reuse the same Google OAuth credentials as the login.
- **One API key, one webhook system.** A personal `zs_…` key works across the public API: `/api/v1/links`, `/api/v1/crm/*`, `/api/v1/calendar/*`. Link's `link.created` / `link.clicked` and Cal's `booking.*` webhooks go through the same signed delivery and retry machinery.
- **One database.** Everything lives in one libSQL database: a single SQLite file if you self-host. One thing to back up, one thing to move, one thing to query.

That last one is underrated. When your contacts, bookings, issues and conversations sit in one file, "where is our data?" has a one-word answer.

## What's *not* connected yet

Equally concrete. These are things you might assume a suite does, and ours doesn't today:

- **Cal bookings don't create or update CRM contacts.** Someone books a demo; your CRM doesn't hear about it automatically. (The `booking.created` webhook can bridge it, if you wire it up.)
- **Link clicks don't show up on CRM contacts.** Link analytics are cookie-less by design, and they aren't tied to people.
- **Chat doesn't create CRM contacts.** It shows the matching one if it already exists; it doesn't add new ones.
- **Docs pages and Track issues don't reference each other.** Docs `[[` mentions link to other Docs pages, not to issues.

We'd rather list these than let "integrated" do more work than it should. If cross-product automation is your main reason to switch, check this list against your workflow first.

## Where six specialized tools win

Let's not pretend. A company that does only scheduling, or only issue tracking, for a decade will go deeper than a suite that does six things. Concretely, the specialists are ahead on:

- **Depth.** HubSpot has email sequences, open tracking, quotes and products; our CRM has none of those yet. Linear has keyboard shortcuts and realtime sync; Track doesn't. Notion has realtime co-editing and imports; Docs doesn't. Calendly connects to Outlook and iCloud; Cal is Google-only for now.
- **Ecosystems.** The big tools have marketplaces with hundreds or thousands of integrations. We have an API, webhooks and CRM workflows. That's a starting kit, not an ecosystem.
- **AI features.** Several incumbents ship LLM-powered features. Our Chat bot and Agents use AI models with your Docs pages as context; the incumbents' AI is more mature.
- **Mobile apps and maturity.** Native apps, years of edge cases, enterprise compliance paperwork. We don't have native mobile apps, and our enterprise features (SSO, audit logs, custom roles) are [still in development](/blog/open-core-explicado).
- **Blast radius.** With six vendors, one outage takes down one tool. With one suite, a bad deploy touches everything. Self-hosting lets you control when you update; it doesn't make a single app less single.

If one of those tools is the core of your business (a sales team living in sequences, an engineering org that needs realtime boards), keep the specialist for that job. That's not a failure of the suite idea. It's just the right call.

## Where the suite wins

The suite's advantages are less flashy and, for many small teams, bigger:

- **The glue is gone.** Six tools need someone to maintain Zapier-style automations, keep users in sync across six admin panels and remember who has access to what. Each connection is a little integration project that breaks quietly.
- **Onboarding and offboarding are one action.** Add a person to the team once. Remove them once. In a six-tool stack, the offboarding checklist is where access leaks.
- **One bill model, one data story.** Per-seat pricing across six products compounds fast as the team grows: check any of their pricing pages and multiply. zerosoft is free to self-host under AGPLv3; zerosoft Cloud has a free tier, then charges per workspace for usage (clicks, bookings, emails, storage), with free seats.
- **One export, if you leave.** Your data isn't spread across six vendors' export formats. Self-hosted, it's one SQLite file you already own.

## A rule of thumb

Say you're a hypothetical five-person agency: a few hundred contacts, client calls booked through a scheduling page, a project board, a support widget on a couple of client sites, and an internal wiki. None of those jobs is your core product. They're the plumbing of the business. That's the sweet spot for a suite: good enough everywhere, one place to look, nothing to glue.

Now say you're a fifty-person sales-led company where outbound sequences *are* the business. Use a specialist CRM. You can still run Link, Cal or Docs from zerosoft next to it: the products don't require each other.

That's maybe the most honest thing about our suite: it's six products in one app, not a bundle you have to swallow whole. Use the ones that fit and leave the rest.
