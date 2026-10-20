---
title: "What to automate first: five flows for a small team"
description: "A rule for picking what to automate, and five concrete flows you can build in Flow from templates: leads, bookings, deals, bugs from chat and billing."
date: "2026-10-18"
author: "zerosoft"
tags: ["flow", "automation", "guide"]
---

Lists of "things to automate today" share one problem: they give you ideas, but they don't tell you which one to start with. And the first automation matters, because it decides whether the team trusts the next ones.

This post has two parts. First, a short rule for choosing. Then, five flows you can build in Flow in a few minutes, each with its trigger, its steps and the detail that usually breaks.

## The rule: frequency times the cost of forgetting

Before you open the editor, write down every repetitive task your team does and put two numbers next to it:

- **How many times a week it happens.** A new lead might happen thirty times. Month-end close, once.
- **What it costs when someone forgets.** A lead nobody calls for two days goes cold. A missing row in an internal spreadsheet costs almost nothing.

Multiply them. Whatever ends up on top goes first. Then apply two filters:

1. **The rule fits in one sentence.** "Every form submission creates a contact and posts in #sales" can be automated. "Reply to angry customers in the right tone" still needs a person.
2. **A mistake can be undone.** A duplicate Slack message is annoying. A duplicate charge is a problem. Start with what's reversible.

With that list sorted, these are the five flows that most often end up on top for a small team.

## 1. Form lead: CRM contact plus a Slack alert

**Trigger:** the CRM's `form.submitted` event.
**Steps:** "CRM: create contact" with the submission's email and name, then a Slack message.

The "Form lead → CRM + Slack" template comes ready. The alert text pulls from the event data:

```
New lead from {{trigger.form.name}}: {{trigger.submission.values.email}} ({{trigger.utm.utm_source | default:direct}})
```

The `default:direct` filter avoids a message with a hole in it when the lead has no UTMs. If your UTMs follow a convention, this alert already tells you which campaign it came from (we wrote one up in [UTMs without the spreadsheet](/blog/utms-sin-planilla)).

**What breaks:** spam submissions. Add a Filter node before the contact step, with conditions that the email exists and doesn't contain the domain that sends you junk. If the filter fails, the branch stops and no contact is created.

## 2. New booking: a task to prepare for the meeting

**Trigger:** Cal's `booking.created`.
**Step:** "Track: create issue" in the project you pick.

The "New Cal booking → Track task" template builds the title from the event type and the invitee's name:

```
Prepare: {{trigger.eventType.title}} with {{trigger.invitee.name}}
```

The description gets the invitee's email and the start time. If you'd rather have a spreadsheet, the "New booking → Google Sheets row" template adds one row per booking with date, name, email and event.

**What breaks:** cancelled bookings. Build a second flow on `booking.cancelled` that alerts you, or the task stays open for a meeting that no longer exists.

## 3. Daily digest of new deals

**Trigger:** Schedule, every day at 09:00, in your time zone.
**Steps:** "CRM: recent deals" (last 24 hours), a Filter that continues only if there's at least one, and an email.

The email body lists deal names with two chained filters:

```
{{nodes.deals.output.deals | map:name | lines}}
```

The Filter in the middle matters more than it looks: a digest that arrives empty five days in a row teaches people to ignore it.

**What breaks:** timing, less than before. On zerosoft Cloud the scheduler checks every minute, so a 09:00 flow starts within a minute or so of 09:00. Self-hosted, it follows how often you call `/api/cron/minute` or `/api/cron/tick`: once an hour via the tick means a flow can start up to an hour late. For a daily digest either works. For something that has to go out at an exact second, Flow isn't built for that.

## 4. Bug reported in chat: an issue in Track

**Trigger:** Chat's `message.received`.
**Steps:** "AI: generate text" to classify the message, an If node, and "Track: create issue" on the true branch.

The AI step's instruction is short on purpose:

```
Answer only "bug" if the message reports a bug or an error. Otherwise answer "other".
```

With a 10-token cap, the output is one word, and the If node checks it with `contains`. The "Chat bug report → Track issue" template has it ready.

**What breaks:** trusting the classification blindly. For the first few weeks, check the run history: every run stores what went into and came out of each node, so you can see which messages the AI flagged as bugs and which it didn't. That step counts against your AI quota.

## 5. Deal won: customer in Stripe

**Trigger:** the CRM's `deal.won`.
**Step:** the Stripe node with the "create customer" operation.

The "Deal won → Stripe customer" template fills in the name and a description with the amount. You need a Stripe credential, which is stored encrypted and masked in every run's logs.

**What breaks:** duplicates. This is the only one of the five that touches money, and by the rule above it should be the last one you turn on. Flow sends Stripe an idempotency key per run and per node, so a retry of the same run won't create two customers. If someone marks the deal as won twice, though, that's two separate runs: add a Filter or check Stripe before you trust it fully.

## What each one costs you

In Zapier, every action that runs is a task. The Team plan starts at [$103.50 a month with 2,000 tasks](https://zapier.com/pricing). As an example: with 30 form submissions a day, flow 1 runs two actions per submission, about 1,800 tasks a month. That one flow alone gets you close to the ceiling, and there are four more.

Flow on your own server doesn't charge per task. There are caps so a badly built loop can't take anything down: 1,000 runs per hour per workspace, 200 steps per run and 300 emails a day from the Send email node, all configurable when you self-host.

## What Flow doesn't have yet

Outside zerosoft's own apps, Flow has nodes for Slack, Google Sheets, Gmail, Stripe, Notion, Discord and Telegram. For everything else there's an HTTP request node that calls any public HTTPS API, and an incoming webhook with a secret URL. If the tool you use has no API, Flow can't reach it. There's also no Zap importer: you rebuild each flow, which takes minutes with the templates.

## Where to start

Make the frequency-times-cost list, pick whatever lands on top and open Flow from a template. Run it with the Test run button on real data, check each node's output, and only then turn it on. When something fails, and at some point something will, the next read is [what to do when a flow fails](/blog/cuando-un-flow-falla).
