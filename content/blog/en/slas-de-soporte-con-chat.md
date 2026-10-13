---
title: "Support SLAs with Chat: a playbook that fits on one page"
description: "How to set up response-time targets in Chat with SLA policies, assignment rules, office hours, priorities, canned responses and CSAT — and exactly how the SLA clock works."
date: "2026-08-11"
author: "Zerosoftware"
tags: ["chat", "support", "playbook"]
---

An SLA is a promise with a timer. "We answer within an hour" sounds great on a pricing page and terrible when a customer waits four. The point of setting one up in your tool isn't the badge; it's that the whole team can see, at a glance, which conversation is about to break the promise.

This is how we'd set up support SLAs in Chat for a small team — two to eight people answering a webchat widget. We'll cover each piece in the order you should configure it, and we'll be precise about how the clock actually works, because that's where most SLA setups lie to you.

## How the SLA clock works

Read this first. It's three rules, straight from the code.

1. **SLA policies are per widget and per priority.** Each widget can have one policy for each of the four priorities: `low`, `medium`, `high`, `urgent`. A policy has a **first response** target in minutes and an optional **resolution** target in minutes (anything from 1 minute up to 30 days).
2. **No policy means a default.** If a widget has no policy for a conversation's priority, first response defaults to **60 minutes** and there's no resolution target.
3. **The clock starts when the conversation is created and runs on wall-clock time.** First response is stamped the first time an agent replies (a message or an attachment). Resolution is stamped when the conversation is marked resolved. The bot's automatic answer does **not** count as a first response — a canned reply from a machine isn't the promise.

Two consequences worth knowing up front:

- **Office hours don't pause the clock.** If someone writes at 11 pm and your first-response target is 60 minutes, that conversation shows as breached by midnight. We'll deal with this below.
- **Snoozing doesn't pause it either.** Snooze hides a conversation until a time you pick (it reopens automatically after), but the SLA keeps counting from creation.

In the inbox, every open conversation carries a badge: "Reply in 23m" while it's on time, "Breached" once it isn't — and it tells you whether it was the first-reply or the resolution SLA that broke.

## Step 1: decide your targets per priority

New conversations start at **medium**. Agents change priority from the conversation view. So in practice, medium is "everything" and the other three are exceptions an agent flags. A reasonable starting point for a small team, as a hypothetical:

| Priority | First response | Resolution |
| --- | --- | --- |
| urgent | 15 min | 4 h |
| high | 30 min | 1 day |
| medium | 2 h | none |
| low | 1 day | none |

Then set them in **Chat → your widget → SLA**: one row per priority, minutes for first response, minutes for resolution (leave it empty for no target). Saving a policy for a priority replaces the previous one.

Be honest with these numbers. A target you breach every day trains the team to ignore the badge.

## Step 2: office hours, and making the clock fair

In the widget settings, enable **Office hours**: a timezone plus a start and end time for each day of the week. Outside those hours, the widget shows visitors an away banner with when you're back. That sets the right expectation for the customer.

Since the SLA clock doesn't know about office hours, you have two honest options:

- **Keep wall-clock targets and accept night breaches.** Simple, and the breach is a true fact — someone did wait.
- **Size medium and low targets to cover the night.** If you're closed for 14 hours, a medium first-response target of, say, 16 hours means "next business morning" without lying. Keep tight targets only for urgent and high, which an agent sets when they're actually on shift.

We'd pick the second for most small teams. Business-hours-aware SLA math is something we'd like to add; today it isn't there.

## Step 3: assignment rules, so nobody stares at an unowned queue

Unassigned conversations are where SLAs go to die. Under **Chat → your widget → Rules**, add rules that run in order, top to bottom. The first one that matches assigns the conversation. Four match types:

- **Keyword** — the visitor's message contains a word, case-insensitive. Example: `refund` goes to whoever handles billing.
- **Time range** — the current time falls in a window like `09:00-13:00`. Useful for shifts. Note: it uses the server's clock, not the widget's office-hours timezone, so check what timezone your server runs in.
- **Round-robin** — assigns to the team member with the fewest conversations assigned on that widget.
- **Catch-all** — always matches; put it last as a safety net.

Rules only touch conversations nobody owns: they never override a manual assignment. A solid default stack: a couple of keyword rules for specialists, then round-robin, then catch-all to a lead.

## Step 4: canned responses to buy time on first reply

Most first replies are some version of "got it, looking into it" or a standard answer to a standard question. Add those under **Chat → your widget → Canned responses**, each with a shortcut, a title and a body.

In the reply box, type `/` followed by part of a shortcut or title — `/refund`, say — and pick from the list. The body drops into the composer, and you can edit it before sending. A real first reply in ten seconds is the cheapest SLA improvement there is.

One rule: canned responses acknowledge, they don't stall. "We'll get back to you" sent to stop the clock and then forgotten is worse than a breach.

## Step 5: the bot, used carefully

Chat has an auto-answer bot, and we'll be clear about what it is: **keyword matching, not an LLM**. It scores the visitor's words against your canned responses or your Docs pages (title matches count double), and replies once per conversation, only if nobody answered yet. No match, it sends just the greeting.

That's useful for deflecting "what are your hours?"-type questions. Since it doesn't count as a first response, it won't make your numbers look better than they are — which is exactly how it should be.

## Step 6: CSAT, the other half of the SLA

Fast and wrong is still wrong. When a conversation is resolved, the widget asks the visitor to rate it from 1 to 5, with an optional comment. The score shows up on the conversation.

## Step 7: read the numbers weekly

**Chat → Settings** shows, across your widgets: average first-response time, percentage of conversations within the first-response SLA, average resolution time, number of resolved conversations, and CSAT average and response count (over the most recent 1,000 conversations).

A fifteen-minute weekly review is enough: if the within-SLA percentage drops, look at which priority and which hours. If CSAT drops while SLAs hold, your problem isn't speed.

## What's not there yet

To keep the playbook honest: no business-hours-aware SLA clock, no automatic escalation or email alert when an SLA is about to break (the badge and the inbox are the alert), no AI agent, and no conversation export. If your support operation depends on those, a mature help desk is the better choice today. For a small team that wants clear promises and a shared view of who's late, this is enough — free to self-host, or on Zerosoft Cloud with a free tier.
