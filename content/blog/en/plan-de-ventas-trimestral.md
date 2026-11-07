---
title: "Quarterly sales plan: from a revenue goal to meetings per week"
description: "How to turn a revenue goal into per-person quotas and a weekly meeting count, with a worked example and how to load it into zerosoft CRM."
date: "2026-11-07"
author: "zerosoft"
tags: ["crm", "sales", "planning", "playbook"]
---

A revenue goal for the quarter is a number nobody can execute on a Tuesday at ten in the morning. What you can do on a Tuesday is book a meeting, send a proposal or follow up. A sales plan is the work of translating the first into the second.

Pipedrive publishes a [seven-step guide to building a sales plan](https://www.pipedrive.com/en/blog/sales-plan) with a template, and its core idea is to split the goal into activity targets and result targets. We agree with that idea. Here is the version for a team of two to six people, with the math done backwards and with what zerosoft CRM stores and what it does not yet.

## Step 1: pick one goal and one period

One goal, one quarter. If you have three goals today ("grow, retain, launch the new product"), the sales plan takes only the one measured in money collected or deals won.

The example we will use throughout (the numbers are made up to show the math, replace them with yours):

- Quarter goal: 60,000 USD in won value.
- Sellers: 2.
- Average ticket of your last won deals: 4,000 USD.

If you have no history, use your best estimate and write down that it is an estimate. By the third review you will have real data.

## Step 2: from money to deals

Divide the goal by the average ticket: 60,000 / 4,000 = 15 won deals in the quarter. That is 7 or 8 per person.

This step often corrects the goal by itself. If 15 deals in 13 weeks sounds reasonable, keep going. If it sounds impossible for two people, the problem is the goal or the ticket, and it is better to find out now.

## Step 3: from deals to meetings

You need two conversion rates from your own pipeline:

- Meeting to proposal sent. Say 50%.
- Proposal to won deal. Say 30%.

Multiplied, that is 15% of meetings ending in a deal. For 15 deals you need 15 / 0.15 = 100 meetings in the quarter. Over 13 weeks that is about 8 per week in total, 4 per person.

"4 per person per week" is an instruction someone can follow. Before, it was "sell 30,000 USD".

To get your real rates, open the CRM reports: the funnel tab shows how many deals move from one stage to the next in the range you choose, and the conversion tab gives you the percentage. Use a six-month range if you have volume; with fewer than 30 deals the percentage swings a lot and should be read as a rough guide. If your stages are not well defined yet, start with the [pipeline hygiene rules](/blog/higiene-del-pipeline).

## Step 4: load the quotas into the CRM

The plan's numbers need to live somewhere the team looks. In zerosoft CRM, under Settings › Quotas, you create one quota per person, per metric and per period:

- Metrics: won value (in the workspace base currency), deals won and meetings booked.
- Periods: monthly or quarterly, calendar-based.

For the example, each person would have three quarterly quotas: 30,000 won value, 7 deals won and 50 meetings. The CRM overview and the reports show the progress of each one and compare the percentage reached with the percentage expected at that point of the period. If 40% of the quarter has passed and you are at 25% of the quota, it shows as behind.

Three details to avoid surprises:

- The expected pace is linear. There is no seasonality, so if your fourth quarter closes strong in December, the board will show you behind in October. Keep that in mind when you read it.
- Meetings count the CRM's meeting-type activities. Bookings made in Cal create a meeting activity on their own; meetings that happen elsewhere have to be logged by someone.
- If a deal has its credit split between several people, each one adds their percentage to won value.

What is missing: quotas for calls, emails or tasks. Pipedrive has a wider range of activity goals, and if your plan depends on counting cold calls, today you have to keep that count separately, for example with a saved report on activities.

## Step 5: spread the work across stages

With the funnel above, the plan per stage for the whole team looks like this:

| Stage | Count in the quarter | Per week |
|---|---|---|
| Meetings | 100 | 8 |
| Proposals sent | 50 | 4 |
| Deals won | 15 | 1 or 2 |

Paste the table into the team channel and review it every week. If meetings are going well and proposals are not, the bottleneck is not prospecting. Look at why meetings do not move forward; the loss reasons in the reports help answer that.

## Step 6: add a follow-up cushion

Deals do not close in order of arrival. A deal that enters in week 11 will probably close next quarter. That is why the pipeline should cover the goal more than once before the quarter is far along. A practical rule: at the halfway point, the open amount in proposal stages or later should be at least double what is left to win. It is our own rule, not an industry standard, and you can adjust it with your history.

To check it, the CRM forecast adds up open deals by category. How to set it up is in [the post on forecasting for small teams](/blog/forecast-de-ventas-para-un-equipo-chico).

## Step 7: review every week and rewrite every quarter

A plan without review is one more document. Reserve a fixed 30 minutes (the [weekly CRM review](/blog/revision-semanal-del-crm) works as an agenda) and answer three questions with the board open:

1. Are we above or below the expected pace on each quota?
2. Which stage is piling up deals?
3. What changes this week?

When the quarter closes, recompute the ticket and the rates with real data and build the next one. The goal of the first plan is to have a baseline; the third one starts to look like a prediction.

## Where the plan lives

All of the above works in a spreadsheet. The difference of having it in the CRM is that progress is computed from the deals and meetings you already logged, without anyone copying numbers into a sheet on Friday. And since zerosoft is AGPL and can be self-hosted, the history of your quotas and deals stays in your database, exportable to CSV or JSON whenever you want. If you come from Pipedrive, the [migration guide](/blog/migrar-de-pipedrive-a-crm) covers how to bring your deals over; quotas and goals have to be re-entered by hand, because they are not imported.
