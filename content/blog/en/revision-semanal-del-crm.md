---
title: "The 30-minute weekly CRM review"
description: "A weekly ritual for small sales teams: one dashboard, a saved view, two bookmarked filters, two dynamic lists and one rotating report. What to look at, in what order, and what to do with what you find."
date: "2026-09-06"
author: "Zerosoftware"
tags: ["crm", "reports", "playbook"]
---

Most teams look at their CRM in two modes: frantically, the day before a board meeting, and never, the rest of the time. Neither works. The first produces numbers nobody trusts; the second produces a CRM nobody updates, which is how you end up with the first.

The fix is boring and effective: thirty minutes, once a week, same day, with an agenda that doesn't change. This is the one we'd run, built on what Zerosoft CRM actually has: dashboards, reports, saved views and dynamic lists.

## Set it up once (about 20 minutes)

The review only takes 30 minutes if you don't build anything during it. Do this once.

### A "Weekly review" dashboard

In `/app/crm/dashboards`, create a dashboard and add these widgets:

- **KPI** ×4: new contacts, new deals, won amount and activities. Each KPI widget picks a metric, an optional pipeline and a range (7 days, 30 days, 90 days, quarter or 12 months). Use 7 days for a weekly review.
- **Weighted forecast**: open pipeline weighted by each stage's probability.
- **Pipeline funnel**: how many deals sit in each stage.
- **Won vs lost**: the trend by month.
- **Open tasks** and **Activity leaderboard**: who's doing the work, and what's pending.

Nine widgets, one screen. You can have several dashboards (one per pipeline, for example), but for the weekly review one is enough.

### A saved view on contacts

On the contacts page, filter by **created date** from last Monday, sort newest first, and save it as a view called "New this week". Saved views appear as tabs above the table, so next week it's one click. You'll use it to check that every new contact has an owner and a lifecycle stage.

### Two deal filters, bookmarked

Named saved views exist for contacts today; on the deals table, filters and sort live in the URL, so a browser bookmark does the same job. Set up and bookmark:

1. **Past close date**: close date before today, stage is not Closed won, stage is not Closed lost.
2. **No amount**: sort by amount, ascending.

One caveat: filter dates are absolute, not "today" in a relative sense. Update the date each week; it takes five seconds.

### Two dynamic lists

In `/app/crm/lists`, create two **dynamic** lists. A dynamic list is a filter that recalculates itself every time you open it:

- **Untouched leads**: lead status = New.
- **Bad timing**: lead status = Bad timing.

The first is your triage queue. The second is the pile of people who said "not now", which is the cheapest pipeline you'll ever have.

## The agenda

Same order every week. Set a timer if you have to.

### Minutes 0–5: the numbers

Open the dashboard. Read the four KPIs out loud. Each one shows the change vs. the previous period of the same length, so "won amount" for the last 7 days comes with how it compares to the 7 days before.

Don't discuss yet. Just note anything surprising: a drop in activities, a spike in new contacts, a week with zero wins. Those are the questions for the rest of the meeting.

### Minutes 5–15: the board

This is the core. Open the deals board and walk it left to right.

- **"No activity in N days" badges.** Any open deal with no activity in more than 14 days is flagged on its card. For each one, the owner says one sentence: what's next and when. If there's no answer, it's closed lost (with a reason) before the meeting ends.
- **Past close date filter.** For each deal: new date with a reason, new stage, or close it.
- **No amount filter.** Fill them in, or admit you don't know enough to call it a deal.

Ten minutes goes fast. If the board is too big to walk in ten minutes, that's itself the finding: you have too many open deals for your team size.

### Minutes 15–20: tasks

Open `/app/crm/tasks` and look at **Overdue**, filtered by owner. Don't shame anyone; reschedule or close. A task overdue for two weeks is a task nobody is going to do. Delete it or turn it into a decision.

### Minutes 20–25: contacts and lists

Open the "New this week" view: any contact without an owner or lifecycle stage gets one now. Then open the two dynamic lists; the member count is right on the lists page.

- **Untouched leads** should be close to zero. If it's growing week over week, leads are arriving faster than you work them. Assign them now, or change how you qualify.
- **Bad timing**: pick three people who said "not now" more than a quarter ago and assign a check-in task. Three a week is 150 a year.

### Minutes 25–30: one report, rotating

`/app/crm/reports` has seven views: Overview, Funnel, Forecast, Sources, Owners, Activity and Conversion. Each takes a range (7d, 30d, 90d, quarter, 12m), a bucket (day, week, month, quarter) and filters by pipeline, source, priority and owner. Don't look at all of them every week; rotate:

- **Week 1, Funnel.** Stage-to-stage conversion. Where's the biggest drop? That's next month's focus.
- **Week 2, Sources.** Contacts, deals and amount by source. Is the channel that brings the most leads also the one that brings the most pipeline?
- **Week 3, Overview.** Lost reasons, won vs lost, average days to close. If "Went silent" leads the lost reasons, your follow-up is the problem, not your pitch.
- **Week 4, Conversion and Owners.** Won divided by created in the period, compared with the previous period, and the per-owner breakdown: won, lost, win rate and completed activities. Use it to spot who needs help, not to rank people.

When a report configuration is useful, save it with **Save report** so next month it's one click.

## What this review is not

It's not a forecast call with the CEO. It's not a coaching session. It's not where you redesign the pipeline. If one of those comes up, write it down and schedule it separately. The review works because it's short and predictable.

Two honest limits to know:

- **Reports don't convert currencies.** Amounts are summed per report in one currency. If you sell in several, filter by pipeline or keep that in mind when reading totals.
- **No scheduled email reports.** Nobody gets a PDF on Monday morning. The review is the delivery mechanism.

## Why it works

A weekly review isn't really about the numbers. It's about the fact that everyone knows that on Monday at 10 their deals will be on screen. That small, predictable pressure is what makes people log the call on Thursday instead of "later".

Thirty minutes a week is two hours a month. It's the cheapest sales tool you'll ever buy, and you already have it.
