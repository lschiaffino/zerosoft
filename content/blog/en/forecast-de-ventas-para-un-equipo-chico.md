---
title: "How to build a sales forecast a small team can defend"
description: "Categories, quotas and per-person submissions: how to turn a pipeline full of deals into a monthly number you can trust, with examples in zerosoft CRM."
date: "2026-11-05"
author: "zerosoft"
tags: ["crm", "sales", "forecast", "playbook"]
---

On the 28th someone asks how much we will close this month, and the answer comes from the gut feeling of whoever is closest to the keyboard. Sometimes it is right. When it is not, the amount that was "almost closed" turns out to never have been signed.

A forecast exists to stop guessing: it writes down, with fixed rules, what we think will happen, and later you compare it with what did happen. Pipedrive [describes its tool](https://www.pipedrive.com/en/features/sales-forecasting-software) as a projection that combines historical data, current sales and the live pipeline. For a team of three to eight people with little history, the useful part is different: simple rules and a number each seller signs off on.

Here is what we would use ourselves, and how to set it up with what zerosoft CRM does today.

## Step 1: separate what happened from what you expect

A forecast mixes three different things, and it pays not to add them blindly:

- **Won:** deals closed in the period. A fact.
- **Open and committed:** deals the seller would bet on.
- **Open and hoped for:** deals that could close if everything goes well.

In zerosoft CRM these layers are called Won, Commit, Best case and Pipeline. Open deals count in the period of their close date, and won deals in the period they were closed. Lost deals are left out.

The most honest math for the month is Won plus Commit. The board shows it as "most likely". Best case and Pipeline are the upside margin, not the plan.

## Step 2: define "commit" before the meeting

If every seller decides commit by their mood that day, the forecast measures mood. Write a criterion down. An example for a mid-ticket B2B team:

1. A proposal was sent and the buyer opened it.
2. There is a close date inside the period.
3. We know who signs, and that person replied in the last seven days.

If one of the three is missing, the deal is Best case, however much you like it.

In the CRM, the category defaults to the stage probability: 70% or more is commit, 40% or more is best case, the rest is pipeline. That is why your stage probabilities should reflect your own history (see [the pipeline hygiene rules](/blog/higiene-del-pipeline)). When a deal does not fit the default rule, each deal lets you pick its category by hand, and there is an Omit option that removes it from the forecast without losing it or marking it lost. A deal on hold because the customer waits for next year's budget is the typical case.

## Step 3: set a goal per person

A number without a goal does not say whether you are on track. Enter each person's won-value quota in the CRM settings (the Quotas section). The forecast shows it next to what is won and calculates the percentage reached.

Example with made-up numbers for illustration, not from any customer: a monthly goal of 20,000 USD for Ana, 8,000 won by the 15th, 6,000 in commit and 9,000 in best case.

- Won plus commit: 14,000. 6,000 short of the goal.
- With all of best case: 23,000. The goal is reached only if nearly every hopeful deal closes.

That second line is what you want to see on the 15th and not on the 28th: you need to open new deals now, not hope.

## Step 4: each person submits their number

This is the part that most separates a forecast from a report. The system calculates the report. A person makes the submission: they look at their won plus commit, adjust with what they know and send a number with an optional note.

In zerosoft every submission is stored with its date, the latest one counts, and the history can be opened. That lets you see how much the number moved during the month and who always adjusts downward near the end. Read that trend without blaming anyone: it usually means the commit criterion is loose, not that someone is lying.

A routine that works with five people:

1. Monday, 15 minutes: everyone submits their forecast for the month.
2. Open the team view and review only the commit deals with a close date nearby.
3. Deals that changed category since last week get explained in one sentence.

## Step 5: fix what breaks the forecast

Three problems dirty the number almost every time:

- **Deals without a close date.** They land in no period. The forecast view tells you how many open deals have no date, and that is the list to clean first.
- **Old dates.** A deal "for April 30" that is still open in November inflates the pipeline. Sort the deals table by close date in your [weekly review](/blog/revision-semanal-del-crm).
- **Mixed currencies.** The CRM converts to the workspace base currency using the exchange rates you enter by hand; if a rate is missing, it counts 1 to 1 and is listed in the reports. Enter the month's rates before looking at totals.

Filtering by pipeline also helps: renewals and new business have different cycles, and mixing them produces an average that describes neither.

## What it does not do yet

An honest note: the zerosoft forecast uses the stage probabilities and categories you define. It does not calculate probabilities from your closing history or predict with models. For a small team that is an advantage, because you can explain where every weight in the number comes from. If your volume justifies a statistical model, today you would export the deals (CSV or JSON) and build it outside.

## Where your forecast lives

A forecast stores decisions: who promised what and when. That history belongs to your company. In zerosoft the submissions sit in your database, whether you self-host for $0 or use zerosoft Cloud, and the CRM exports everything whenever you want to leave. The forecast is built in the CRM, but the usual fight (the deal nobody updates) gets solved with [tasks and workflows](/blog/workflows-crm-tareas-de-seguimiento) that create the next step on their own.

## Summary to print

1. Won plus commit is the plan. Best case is margin.
2. Write down the commit criterion and do not change it mid-month.
3. One goal per person, entered.
4. Each person submits their number on Monday, with a note.
5. Clean deals without dates, old dates and currencies before reading totals.
6. Review the submission history at month end: that is where you learn.
