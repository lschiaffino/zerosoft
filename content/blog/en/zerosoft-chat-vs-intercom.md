---
title: "Chat vs Intercom: what each does today"
description: "Intercom is far ahead on AI, channels, integrations and help center. Chat is a self-hostable webchat inbox with SLAs and CSAT. Who should switch, and who shouldn't."
date: "2026-09-23"
author: "zerosoft"
tags: ["chat", "intercom", "comparison"]
---

Let's get the uncomfortable part out of the way: Intercom and zerosoft Chat are not the same category of product anymore. Intercom has become an AI-first customer service platform. Chat is a webchat widget with a shared inbox and the support basics done properly. Comparing them feature by feature would be silly, so instead, here's where each one actually stands, and an honest answer to "should I switch?"

## The short version

- **Intercom** is a mature customer service suite: an AI agent that answers on its own, many channels, a help center, outbound messaging, mobile SDKs and a big integrations marketplace. If support is a core function with real volume, it's built for you.
- **Chat** is open source (AGPLv3), self-hostable, and does the essentials: an embeddable webchat widget, a shared inbox, assignment rules, SLA policies, canned responses, office hours and CSAT. It fits small teams that want a clean inbox they own, without per-seat pricing.

## Where Intercom is clearly ahead

**AI.** This is the big one. Intercom's AI agent reads your content and answers customers in natural language, resolving many conversations end to end. In Chat, the bot answers with an AI model, using your Docs pages and canned responses as context, and hands off to a person when it isn't sure (with AI turned off, it falls back to keyword matching and replies once). zerosoft Agents adds tools on top (CRM, Cal, Track, Flow). Intercom's AI is more mature and has more channels, and we won't pretend otherwise.

**Channels.** Intercom handles conversations across multiple channels (email, messaging apps, social and more) in one inbox. Chat is a website widget. That's it, for now.

**Help center.** Intercom ships a public help center with articles, collections and search. Chat doesn't. You can point Chat's bot at your Docs pages, but Docs is an internal knowledge tool, not a public, SEO-ready help site.

**Outbound and in-product messaging.** Product tours, banners, targeted messages, email campaigns. Chat only responds; it doesn't reach out.

**Mobile SDKs.** Intercom has native SDKs to put support inside iOS and Android apps. Chat has a JavaScript widget for websites.

**Integrations and API.** Intercom has an app marketplace and a public API. Chat has no public API yet, no webhooks for chat events and no conversation export.

**Ticketing, workflows and reporting depth.** Intercom has tickets, visual workflow builders, and detailed reporting. Chat's reports are a single, focused panel: average first response, percentage within the first-response SLA, average resolution time, resolved count, and CSAT.

**Maturity.** Years of production use at very large companies, security certifications, enterprise features. Our enterprise pieces (SSO/SAML, audit logs, custom roles, and white-label for the widget) are in development in `/ee`, not shipped.

## Where Chat holds up

**The support basics, done carefully.**

- **Widget:** one `<script>` tag, your color, bottom-left or bottom-right, a welcome message, and up to 20 pre-chat fields (text, email or number). Visitors can send images, audio and files up to 10 MB, and they see typing indicators and read receipts.
- **Inbox:** open, pending, snoozed and resolved states; filters for unassigned and mine; priorities (low, medium, high, urgent); snooze that reopens on its own.
- **Assignment rules:** keyword, time range, round-robin and catch-all, evaluated in order, never overriding a manual assignment.
- **SLA policies:** a first-response and optional resolution target per widget and per priority, with a live "Reply in Xm" or "Breached" badge on every conversation. We wrote a [playbook on support SLAs with Chat](/blog/slas-de-soporte-con-chat), including where the clock is simpler than you might want (it runs on wall-clock time, not business hours).
- **Canned responses:** type `/` in the reply box to search and insert.
- **Office hours:** per-day schedule and timezone; outside hours the widget shows an away banner with when you're back.
- **CSAT:** a 1–5 rating with optional comment, asked when a conversation is resolved.
- **People:** a list of visitors with their conversations and notes. If a visitor's email matches a contact in zerosoft CRM, the conversation shows that contact.

**You own it.** AGPLv3, self-hostable, conversations in your own database. For teams with data-residency concerns, or who simply don't want their customer conversations in yet another vendor's cloud, that matters.

**The suite.** Chat shares login, team and data with CRM, Docs, Track, Cal and Link. Your Docs pages can feed the bot; your CRM contacts show up next to the chat.

**Pricing that doesn't punish growth.** Intercom combines per-seat pricing with usage-based charges for its AI agent; check their pricing page for current numbers, because they change. Chat self-hosted costs $0. zerosoft Cloud has a free tier, then charges per workspace for usage (clicks, bookings, emails, storage), with free seats.

## Who should stay on Intercom

Honestly, many teams. Stay if:

- You rely on an AI agent to resolve a meaningful share of conversations. Chat's bot is simpler and less proven.
- You support customers on more than one channel (email, WhatsApp, social) and want them in one place.
- You need a public help center, product tours or outbound messaging.
- You support users inside a native mobile app.
- Your support stack depends on integrations (CRM sync, ticketing, data warehouses) or on Intercom's API.
- You need enterprise requirements today: SSO, audit logs, custom roles, formal compliance.

For those teams, moving to Chat would be a step backwards.

## Who Chat is for

- Small teams (two to ten people) answering website chat, where the job is "reply fast and don't drop anything".
- Companies that want support conversations on their own server, under an open-source license.
- Teams already using zerosoft CRM or Docs who want the chat next to their contacts and knowledge.
- Anyone who has looked at a per-seat-plus-per-resolution bill and decided their volume doesn't justify it.

## How to try it

Create a widget in **Chat**, copy the embed snippet, and put it on a staging page. Set two SLA policies, one assignment rule and five canned responses. Run it for a week next to your current tool, if you can, and compare honestly: if you missed the AI agent every day, you have your answer.

## The bottom line

Intercom is the more capable product by a wide margin, especially on AI and channels. Chat is a focused, honest, self-hostable webchat inbox with the support fundamentals (SLAs, rules, CSAT) built in. Pick the one that matches the job you actually have.
