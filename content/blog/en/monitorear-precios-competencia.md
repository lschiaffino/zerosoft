---
title: "Track your competitors' pricing with a robot and a flow"
description: "A robot that reads your competitors' pricing pages every day, keeps the history in a spreadsheet and alerts you when something changes or when the page gets redesigned. Step by step with Robots and Flow."
date: "2026-10-18"
author: "zerosoft"
tags: ["robots", "flow", "browse-ai"]
---

Browse AI published a good use case: [how to automate SaaS competitor price monitoring](https://www.browse.ai/blog/how-i-automated-saas-competitor-price-monitoring). A robot reads the pricing page, stores the data and pings Slack. The idea is right, and it applies to any small team selling against two or three rivals: hearing about a price increase from a customer on a call means hearing about it late.

This post builds the same thing with Robots, the zerosoft browser automation app, and Flow, our workflows. No per-extraction credits: on your server, the robot runs in your own Chromium. We'll walk through the exact steps, the decisions worth making and where Robots still falls short.

## What to watch

Before you open any tool, make the list. For each competitor, look at their pricing page and write down:

- **Each plan's name and price.** The obvious part.
- **The billing toggle.** Nearly every page has a monthly/annual switch. The price you see on load is usually the annual one. Decide which one you want to read and stick with it.
- **Limits that matter for your deals.** Included users, contacts, storage. Plenty of price increases arrive as a lower limit with the same price.
- **The promo copy**, if there is any. A "50% off the first year" changes the comparison even when the list price doesn't move.

Three competitors with four data points each already gives you a dashboard nobody on your team keeps today.

## Step 1: the robot

In Robots, start from the **Check a price every day** template. It comes with two inputs, the product URL and the price selector, plus a daily schedule. For a SaaS pricing page, adjust it like this:

1. **Go to URL**: `{{inputs.url}}`, with the competitor's pricing page as the input value.
2. **Click** with the visible text `Monthly`. When there's no stable selector, Robots finds the element by the text you typed.
3. **Wait** until the price selector shows up. Pages that load prices with JavaScript need this step.
4. **Extract** in "All matches (list)" mode on the plan-name selector, saved as `plans`. It returns a list with each element's text, up to 200.
5. **Extract**, same mode, on the price selector, saved as `prices`.
6. **Screenshot**, named `page`. It's stored with the run, and an image of the page on that day settles the "since when do they charge that?" question.

To find selectors: right-click the price, Inspect, Copy selector, then trim it down to something readable like `.pricing-card .price`. If you'd rather skip the inspector, the Robots recorder is a bookmarklet: open it on the page, do the clicks by hand, and it gives you back the steps with selectors picked in order of stability (data-testid, id, name, aria-label, visible text).

If an element only shows up sometimes, like a promo banner, use **If element exists** with "Skip the next steps" before the step that extracts its text: when the banner isn't there, the robot skips that step and keeps going.

Run the robot by hand once. The runs panel shows the screenshot and the JSON output, something like:

```json
{
  "plans": ["Starter", "Pro", "Business"],
  "prices": ["$12", "$29", "$59"]
}
```

## Step 2: the schedule

On the robot, set the schedule to **Every day** at 9:00 in your time zone. It also takes intervals (every 15 minutes at the shortest) or a cron expression. For pricing, once a day is enough; nobody changes their pricing page every hour, and fewer visits are also kinder to the site you're reading.

One robot per competitor is the easiest to maintain: when one of them redesigns their page, you break a single robot.

## Step 3: the flow that records and alerts

Every finished run emits the `robot.run.finished` event, with the robot's name and its output. In Flow:

1. **Trigger: event** `robot.run.finished`. Under advanced, filter on `robot.name` equals "Pricing: Competitor A".
2. **Google Sheets**, append operation, with one row: `{{now}}`, `{{trigger.robot.name}}`, `{{trigger.output.plans | json}}`, `{{trigger.output.prices | json}}`. That's your history: one row per day per competitor.
3. **If**: `{{trigger.output.prices | json}}` not equal to `["$12","$29","$59"]`, the last value you know.
4. On the true branch, **Slack** or **Email**: "Competitor A's pricing page changed: {{trigger.output.prices | json}}".

When an alert comes in, you check it, update the value in step 3 and you're done.

An honest gap: Robots doesn't compare one run with the previous one on its own. The comparison is the flow condition against the value you entered. If you want it to compare against yesterday automatically, you can do it with a Google Sheets step in read mode and a code node that checks the last row, but that's a longer flow.

## Step 4: get alerted when the robot fails, too

When a run fails, `robot.run.failed` is emitted with the step number and the error. Build a second, tiny flow that emails you that error.

This matters more than it looks. If the selector stops finding the prices, it's almost always because the competitor redesigned their pricing page. And a pricing page redesign usually comes with a change in prices or plans. The failure is a signal in itself.

## What to do with the data

The history in the spreadsheet answers concrete questions:

- **When did it change?** The first row with the new value. That day's screenshot confirms it.
- **What changed?** Price, plan name or number of plans. A plan that disappears is usually a consolidation upward.
- **What do we tell sales?** One line in the team channel when something changes, with the screenshot. If you use the CRM, it's good material for notes on the deals where that competitor is in play.

## Limits worth knowing

A run's limits are in the code: up to 100 steps, 20 pages, 5 screenshots and 180 seconds. One robot runs at a time per workspace, so if you track ten competitors, stagger them: the ones that overlap wait for the next cron pass. On zerosoft Cloud the browser minutes you use are metered; the code ships a monthly per-workspace allowance set with `ROBOTS_FREE_MINUTES_PER_MONTH` (120 minutes by default). A pricing robot takes seconds per run.

For comparison: Browse AI's Free plan gives you [50 credits a month and monitoring at most once an hour](https://www.browse.ai/pricing).

What Robots doesn't do yet, and paid scraping tools often include:

- **It doesn't adapt on its own** when the page changes. If the selector breaks, you fix it (and step 4 tells you).
- **No proxies or geolocation.** If the competitor shows different prices by country, the robot sees the ones for your server's country.
- **No captcha solving.** A page behind a captcha won't be read.
- **No prebuilt robots** for popular sites. You start from a generic template.

## A couple of house rules

Read public pages, once a day, and respect the site's terms. Robots can keep a session between runs for pages behind a login, but a pricing page doesn't need one, and that's for the best.

## On one card

- One robot per competitor: go to URL, click "Monthly", wait, extract plans and prices, screenshot.
- Daily schedule. More often adds nothing.
- Flow on `robot.run.finished`: a spreadsheet row, a condition against the last value, an alert.
- Flow on `robot.run.failed`: a broken selector is usually a redesign.
