---
title: "Rule-based lead scoring: ten rules you can explain in a meeting"
description: "How a small team can build lead scoring from property rules and recent-activity rules, check it against deals it already won or lost, and turn the score into tasks with workflows."
date: "2026-10-18"
author: "zerosoft"
tags: ["crm", "sales", "lead scoring", "playbook"]
---

You have 300 open contacts and time to call fifteen. Lead scoring answers one question: which ones first. Everything else (models, weights, predictions) is a more or less expensive way to answer it.

[HubSpot's lead scoring guide](https://blog.hubspot.com/marketing/lead-scoring-instructions) walks through seven models, from fit by job title and company to predictive scoring with logistic regression. A team that closes 40 deals a year doesn't have enough data to train a predictive model. What does work at low volume is a handful of rules anyone on the team can read and argue about. This post builds those rules in zerosoft CRM, tests them against your history and connects them to actual work.

## How the CRM computes the score

Before designing rules, know exactly what the engine does. This comes from the code (`lib/crm-scoring-schema.ts`):

- **Property rules** compare a contact field: lifecycle stage, lead status, source, job title, email, phone, city, country, website or any custom field. Operators: equals, not equals, contains, greater than, less than, is set, is not set. Comparisons ignore case.
- **Activity rules** count something that happened in the last N days (1 to 365): emails opened, clicks, replies, meetings booked, forms submitted, calls or notes logged. Each rule has a minimum count.
- **Each rule adds once.** If it matches, it adds its points (between -1000 and 1000); otherwise zero. Three replies are not worth three times one reply. To reward intensity, create two rules: one with a minimum of 1 and one with a minimum of 3.
- **It recalculates on its own**, on every relevant event (an open, a meeting, a form) and once a day from the cron, so "last 30 days" windows expire without anyone touching anything.
- **It explains itself.** The contact page shows which rules added points and how many. Score is a sortable column you can also use in the advanced filter.

## Step 1: keep fit and interest apart

A contact can be your ideal customer with no urgency at all, or very active with no budget. If you mix both without labeling them, a 40 doesn't tell you which case you're looking at.

The CRM stores one score per contact, so the split lives in the names: every rule starts with "Fit:" or "Interest:". The breakdown on the contact page reads at a glance.

## Step 2: ten rules to start with

A starting point for a team selling software to small companies. The points are an example; you'll correct them in step 3.

| # | Rule | Type | Condition | Points |
|---|---|---|---|---|
| 1 | Fit: decision maker | Property | Job title contains "founder" | +15 |
| 2 | Fit: size | Property | `custom.employees` greater than 10 | +10 |
| 3 | Fit: market | Property | Country equals the one you serve | +10 |
| 4 | Fit: personal email | Property | Email contains "@gmail." | -10 |
| 5 | Interest: form | Activity | 1 form in 30 days | +20 |
| 6 | Interest: meeting | Activity | 1 meeting booked in 30 days | +30 |
| 7 | Interest: replied | Activity | 1 reply in 14 days | +25 |
| 8 | Interest: click | Activity | 1 click in 14 days | +10 |
| 9 | Interest: opens | Activity | 3 opens in 14 days | +5 |
| 10 | Disqualified | Property | Lead status equals "unqualified" | -50 |

Three decisions behind the table:

- **Opens are worth little.** Apple Mail preloads email images for privacy, which records opens nobody made. A click or a reply is a much firmer signal.
- **Company size lives on the contact.** Rules read contact fields, not company fields. If size matters to you, ask for it on your form and store it in a contact custom field (CRM forms map to custom fields).
- **One strong negative rule closes the door.** When someone marks a lead as unqualified, it should sink to the bottom even if it opens every email you send.

Set them up in **CRM → Settings → Lead scoring**.

## Step 3: check it against what already happened

A score is useful if the people who ended up buying sit at the top. Test it before you trust it:

1. Build one list with the contacts from your last 20 won deals and another with 20 lost ones.
2. Sort both by score.
3. Compare the medians. If the won list isn't clearly higher, some rule is measuring noise.
4. Open the odd cases (a lost contact at 70, a won one at 5) and read the breakdown. Often there's a rule adding points for something that predicts nothing.

One honest limit: activity rules look at the last N days from today, so a deal from six months ago no longer has its activity inside the window. For calibration, use recent deals or focus on the fit rules, which don't expire.

## Step 4: make the score create work

A number in a column doesn't call anyone. CRM workflows have a "Lead score changed" trigger with an optional threshold and a direction (up, down or either). Three recipes:

- **Rises past 50:** create a task for the owner that says "Call today" and update the lifecycle stage to SQL.
- **Rises past 30:** enroll in a follow-up sequence. We cover how to build one in [this post on sequences](/blog/secuencias-de-seguimiento-que-se-cortan-solas).
- **Drops below 30:** a review task. Someone who was warm and went cold deserves a human message before going back to the pile.

To notify another tool, the CRM emits the `contact.score_changed` event, which you can pick up from Flow or with a webhook.

## Step 5: one review a month

Fifteen minutes is enough. Look for rules that almost never match (unnecessary, or the condition is wrong) and rules that match almost everyone (they don't separate anybody). Adjust points gradually and log each change on a Docs page, so the next person knows why a rule is worth 25 and not 10.

## What it doesn't do yet

- No predictive score or weights suggested from your history.
- Rules only read contact properties, not the contact's company or deals.
- No separate score per pipeline or product; the fit/interest split is by name.
- Each rule adds once; there are no points per occurrence.

If you need any of that today, a bigger CRM is the better fit. If your problem is deciding who to call on Monday, ten rules you understand will serve you better than a model nobody can explain. zerosoft CRM runs for $0 on your own server, or on zerosoft Cloud with a free plan to start.
