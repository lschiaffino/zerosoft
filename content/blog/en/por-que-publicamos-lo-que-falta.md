---
title: "Why the README lists what each product is missing"
description: "Every product in the README has a Known gaps line next to its features. Why we publish them and how it changes what we build."
date: "2026-09-13"
author: "zerosoft"
tags: ["honesty", "marketing", "open source"]
---

Open the README of zerosoft and look under any product. Right after the feature list there's a line in italics that starts with *Known gaps*. It's not hidden in a changelog or buried in a forum thread. It's in the first file anyone reads.

Most software companies would call that bad marketing. We think it's the only kind that works long-term, and we made it a rule.

## What the list actually says

Here are some of the gaps as of this update, product by product:

- **CRM:** tables only scroll sideways on a phone. Quotes have no e-signature or payments. Forms have no multi-step pages, conditional fields or file uploads. Exchange rates are entered by hand.
- **Track:** no keyboard shortcuts, no realtime sync, no Git/GitHub integration, no public API or webhooks, no Linear import.
- **Cal:** no Outlook or iCloud calendars. Google Calendar, yes.
- **Chat:** web widget only (no email or WhatsApp), no internal notes or tags on conversations. The bot uses AI when a key is configured and falls back to keyword matching.
- **Docs:** no realtime co-editing, no JSON/Markdown export, no Notion import.
- **The site:** the status page lists services; live monitoring isn't wired up yet.
- **Enterprise:** SSO/SAML, audit logs, custom roles and white-label live in `/ee` and are in development.

Read that list again if you're evaluating a HubSpot or Linear replacement. Some of those are dealbreakers for some teams. That's exactly why they're there.

## Why we do it

### Because you'll find out anyway

A gap you hide is a gap your user discovers three weeks after migrating, in the middle of a sales week, when they try to send a sequence or open the Track board with a keyboard shortcut. At that point it's not a missing feature anymore. It's a broken promise, and the trust doesn't come back.

A gap you publish costs you the user who needed it on day one. That's fine. They should keep using the tool that has it. We'd rather lose them honestly than keep them unhappily.

### Because the AI line matters right now

When this post was first written, Chat's bot matched keywords against canned responses and docs pages, and the README said so in plain words: *not an LLM*. Calling it "AI-powered" would have been easy and wrong. Today the bot does use an AI model when AI is enabled, and the README says that too, including that it falls back to keyword matching when AI is off.

### Because it keeps us honest internally

Writing "we don't have X" next to "we have Y" changes how a team works. Our contributing guide has a rule: product pages may only claim features that exist in `main`. Not "on a branch". Not "next sprint". In `main`.

That rule only works if the opposite list exists too. When a claim and a gap contradict each other, someone notices, and one of them gets fixed, usually the claim.

### Because it's an open-source project

In a closed product, a gap list is a confession. In an open-source project, it's a to-do list anyone can pick up. Every line in *Known gaps* is a place where a contributor can make a real difference, and [contributing doesn't need anyone's permission](/blog/como-contribuir-a-zerosoftware).

Outlook calendars for Cal, Markdown export for Docs, a public API for Track: those aren't secrets we're embarrassed about. They're issues waiting for someone, us included.

## What honest marketing looks like in practice

Publishing gaps is one piece. The full policy is a handful of boring rules we apply everywhere, including this blog:

- **Only claim what exists in the code.** If a feature isn't merged, it isn't on the product page. "Coming soon" is allowed only when it's labeled as such, which is why our Cal page says Outlook and iCloud aren't supported yet instead of quietly listing "calendar sync".
- **Say where the incumbent is ahead.** HubSpot has a huge integrations ecosystem. Linear has keyboard-first speed and realtime sync we don't. Notion has realtime collaboration and a massive template library. Pretending otherwise insults the reader.
- **No invented numbers.** No made-up user counts, no testimonials we didn't receive, no benchmarks we didn't run. When we give an example, we say it's hypothetical.
- **No fake prices.** Self-hosting costs $0 under AGPLv3. zerosoft Cloud has a free tier, then charges per workspace for usage (clicks, bookings, emails, storage), with free seats. We won't quote a per-unit number until it's real.
- **Tell people who shouldn't switch.** If your marketing team runs campaigns from the CRM, ours isn't for you yet. If you need SAML this quarter, wait. Saying that out loud is part of the product.

## "Isn't this just bad for business?"

In the short term, maybe. A competitor's landing page full of checkmarks looks better than ours with a list of what's missing.

But think about what the checkmark page is optimizing for: the first click. We're optimizing for the second year. Software you've moved your contacts, your calendar and your documents into is software you need to trust. And trust isn't built by the features list: anyone can write a features list. It's built by the line underneath it.

There's also a simpler reason. Our code is public. Anyone can open `lib/` and check whether Chat calls a language model. Lying about features in an open-source project isn't just wrong; it's pointless. The only consistent position is to say it first.

## How a gap leaves the list

The same way it got there: in public. A feature ships, the product page can claim it, and the line comes out of *Known gaps*. If you're waiting for a specific one, watch the README, or [send a PR](/blog/como-contribuir-a-zerosoftware) and take it off the list yourself.
