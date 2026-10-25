---
title: "A sales forecast you can defend: commit, best case and pipeline"
description: "How to build a monthly forecast for a small team with three categories, a goal per person and a submitted number each period, and how zerosoft CRM does it."
date: "2026-10-25"
author: "zerosoft"
tags: ["crm", "sales", "forecast"]
---

Small teams usually forecast in one of two ways. The first is to add up everything that is open and call it "pipeline". The second is to ask the team lead how much they think will close and write the answer down. The first gives an inflated number. The second gives a number that depends on that week's mood.

Pipedrive publishes a [sales forecasting guide](https://pipedrive.com/es/blog/pronostico-de-ventas) that recommends combining quantitative and qualitative methods. We agree. Here is a concrete version for teams of two to fifteen people: which categories to use, how to set goals, which number gets submitted and how it gets corrected over time. Each step maps to what zerosoft CRM does today.

## One number is not enough: use three categories

A useful forecast separates what already happened from what might happen. Four columns are enough:

- **Closed won**: deals closed as won inside the period.
- **Commit**: open deals the rep is willing to bet will close in the period.
- **Best case**: open deals that can close if everything goes right.
- **Pipeline**: the rest of the open deals with a close date in the period.

Closed won plus commit is the "most likely" number. It is the one you tell the rest of the company. Best case and pipeline are the margin: they explain why a month came out better than expected.

In zerosoft, the forecast (`/app/crm/forecast`) shows exactly those columns by month or quarter, with the goal next to them and a weighted total. One detail worth knowing: open deals count in the period of their close date, and won deals in the period when they were closed. An open deal with no close date lands in no period. The screen tells you how many there are ("N open deals have no close date"), and that count is the first item of every review.

## The category comes from the stage, and you can override it

So nobody has to classify every deal by hand, zerosoft assigns the category from the stage probability:

- 70% or more: commit.
- 40% or more and under 70%: best case.
- Under 40%: pipeline.

Those thresholds live in the code and are not configurable yet. If your stage probabilities are reasonable, most deals already land where they belong.

Then comes the valuable part: each deal has a category selector in the forecast table, with "Automatic" and four manual options. Overriding is a judgment call. A deal in Negotiation (70%) where you know the buyer is waiting on budget goes down to best case. A deal in Proposal (40%) with a signed purchase order that is not invoiced yet goes up to commit. There is also "Omit", which takes a deal out of the forecast without closing it, useful for a dormant deal you do not want to lose but do not want to count either.

Every category change is recorded in the deal history with who made it, so in the review you can ask "why did this deal drop from commit?" and the answer is on file.

## Goals per person, not one goal for everyone

A forecast without a goal is a list of amounts. With a goal, it is a distance. In the CRM settings you load a won-value quota per person, monthly or quarterly. The forecast uses it to show how much of the goal is already won in each row ("45.5% of goal won"), and the team total adds up the individual goals.

A practical rule for setting them: start from what the team won in the last three periods of the same kind, not from what the company needs. If the gap between the two is large, that is a planning problem and should be discussed as one, not hidden behind a goal nobody believes.

If you work with defined sales teams, the forecast filters by team and by pipeline. That helps when you have one pipeline for new business and another for renewals and do not want to mix the two numbers.

## The number each person submits

The qualitative part of the method is this: each rep looks at their deals and submits **one number** for the period. It may match closed won plus commit or not. If it does not, the note (up to 500 characters) explains why: "the $18,000 deal depends on the client approving the budget on the 3rd".

In zerosoft, each submission is saved with date, author and note. The latest one counts, but the history stays visible under "View submission history". That lets you see how much the number moved during the month, something a shared spreadsheet overwrites without a trace. Admins can adjust another person's number, and the history shows who did it.

When closed won plus commit and the submitted number differ by more than 15 or 20% on a regular basis, there is something to talk about: either the person is conservative, or the stages do not reflect reality.

## When deals are shared

If two people work a deal, the forecast can split it by percentage. Each deal's splits count in the per-person rows, in the quotas and in the total, so a $10,000 deal split 60/40 contributes $6,000 and $4,000 and the total stays $10,000, not $20,000. With no splits, the whole deal belongs to the owner.

## The monthly review in 20 minutes

A meeting template, using only the forecast screen:

1. **Close the previous period.** Look at last month with the "Previous period" button. Compare goal, closed won and submitted number. Write down the gap between submitted and won, per person.
2. **Fix what does not count.** Check the warning about deals with no close date. Each one gets a date or gets closed.
3. **Review commit one by one.** For each deal in commit, one question: what has to happen for it to close, and when? If nobody can answer, it drops to best case.
4. **Look at the next period.** With "Next period" you see what lands next month. If commit plus best case does not reach the goal, you see the problem early.
5. **Each person submits their number.** With a note. It happens in the same meeting, not afterwards.

Twenty minutes is enough for five people. For more, each team lead does steps 3 and 5 beforehand and the meeting is spent on the differences.

## What it does not do yet

To avoid overpromising: zerosoft does not run statistical forecasting models or predict close dates on its own. The forecast is transparent arithmetic over the categories and probabilities you define, and that is the point. The 70% and 40% thresholds cannot be edited from the interface. And if you want to cross the forecast with other data, the report builder can group by forecast category.

## How to try it

If you are already on zerosoft, open CRM, Reports and Forecast. Load a quota per person in the settings and review the categories of this month's open deals. If you are coming from another CRM, the [CSV contact migration](/blog/migrar-contactos-de-hubspot-por-csv) lets you start with real data. And since the code is open under AGPL, you can run everything on your own infrastructure and read in `lib/crm-forecast.ts` exactly how each column is calculated.

A good forecast gets discussed every month with the same numbers in view, and every cycle makes it more honest.
