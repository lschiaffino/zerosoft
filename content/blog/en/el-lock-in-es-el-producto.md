---
title: "Lock-in isn't a side effect of SaaS: it's the product"
description: "Incomplete exports, proprietary formats, integrations that break, prices that scale with your success. These aren't accidents: they're the strategy."
date: "2026-06-16"
author: "Zerosoftware"
tags: ["lock-in", "saas", "open source"]
---

When you evaluate a SaaS tool, you look at the features, the entry price and the interface. The vendor, meanwhile, looks at something else: how much it will cost you to leave. That number — your exit cost — is the most valuable asset they have. Lock-in isn't a side effect of the model. It is the model.

## The four classic tactics

**1. The incomplete export.** The button exists, so technically "you can take your data". What you take is the contacts. What stays: the activity history, the notes, the file attachments, the automations you built over years. You get the bricks; they keep the house.

**2. Proprietary formats.** Your data comes out in a format only that tool understands — or in a CSV so degraded that rebuilding the relationships between tables takes weeks. Technically exportable, practically useless.

**3. Integrations that break.** While you're in, everything connects to everything. The day you announce you're leaving, you discover those integrations were the glue of your operation: the site form, the billing sync, the webhook that triggers your pipeline. Leaving doesn't cost the subscription: it costs rebuilding half the company.

**4. Prices that scale with your success.** Per-contact, per-seat, per-record pricing has an elegant, perverse property: your bill grows when your business grows. You doubled your customer base, you doubled your invoice. Your growth is their revenue model. You're not paying for more software — the software is the same — you're paying for having done well.

## How to spot it before you sign

You don't need faith, you need ten minutes of due diligence:

- **Export on day one.** Create test data and try the export before migrating anything. If what comes out isn't enough to rebuild your operation, you already know what that button is worth.
- **Look at the pricing curve at 10x.** Work out what you'd pay with ten times your current users, contacts or records. If the number bothers you today, it will hurt in two years.
- **Read the API limits.** Low rate limits and a toy API are a signal: they don't want your data leaving through the service door.
- **Ask about the format.** Do they document their data model? Do they export in open formats (CSV, JSON, ICS, vCard) or only in their own?

## The alternative: ownership

The only structural defence against lock-in is ownership. Software whose code you can download, whose database lives on your server — or on a cloud billed at cost that you can leave in an afternoon.

That's how we run Zerosoftware: all the code is open source; if you use our cloud, you pay what the infrastructure costs, with no margin; and your data exports complete, in open formats, with one click. If we ever do things wrong, leaving must be easy. Staying should be a decision, not a sentence.
