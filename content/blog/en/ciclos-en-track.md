---
title: "Running two-week cycles in Track: a playbook for small teams"
description: "How a small team runs cycles in Track with issues, sub-issues, relations, estimates, custom statuses and four views, plus what it still lacks."
date: "2026-07-26"
author: "zerosoft"
tags: ["track", "cycles", "playbook"]
---

Cycles are the least glamorous good idea in project management. You pick a window (usually two weeks), decide what fits in it, do it, and look at what didn't make it. No story-point poker, no forty-field Jira form. Just a box of time and a list.

This is how we'd run cycles in Track for a team of three to ten people. It's a playbook, not a feature tour, so it also says what Track is still missing.

## Step 0: one project per team, not per feature

In Track, a project owns its issues, statuses and cycles. Every issue gets an identifier built from the project slug: a project with slug `app` produces `APP-1`, `APP-2`, and so on.

The temptation is to create a project per initiative. Resist it. Cycles live inside a project, so if your team's work is spread across five projects, you get five parallel sprints and nobody knows which one matters. One project per team, labels for initiatives. Labels are free-form (up to 10 per issue, each with a color), and you can filter by them.

## Step 1: set up your statuses

A new project ships with five statuses: **Backlog, Todo, In progress, Done, Cancelled**. Each status belongs to one of those five categories under the hood, which is what keeps things sane when you add your own.

Most small teams need exactly one extra: **In review**. On the project page, open **Settings**, then the **Statuses** tab, and add it with the In progress category. That's also where you rename or recolor any status, reorder them (the order is the board's column order), and delete the ones you don't use, moving their issues to another status.

## Step 2: create the cycle

In **Settings**, **Cycles** tab, click **New cycle**. The form suggests the number and dates that follow the last cycle, with the same length, and warns you if it overlaps another one. From then on the cycle shows up everywhere in the UI: the issue form, the properties panel and the filters.

Our advice: create the next two or three cycles at once, so planning never blocks. Name them boringly ("Cycle 14", "Cycle 15"). If you get the dates wrong, edit it from the same list.

## Step 3: planning (issues, sub-issues, estimates)

Planning is where Track feels normal again. Everything below is in the UI.

- **Issues** have a title, a description, status, priority (urgent, high, medium, low), assignee, labels, due date, cycle and estimate.
- **Estimates** are plain whole numbers. Track doesn't impose a scale. Pick one and stick to it. We like 1, 2, 3, 5, and anything bigger than 5 gets split.
- **Sub-issues**: from any issue, create a subtask. It's a full issue with its own status and assignee, and the parent shows its children. Use them when a "5" turns out to be three "2s".
- **Relations**: `blocks`, `related` and `duplicates`. Add them from the issue detail by typing the other issue's identifier. The other issue shows the inverse ("blocked by", "duplicated by"), so dependencies are visible from both ends.

A practical planning meeting: filter the list by the **Backlog** status, sort by **priority**, and assign issues to the cycle from the properties panel until the sum of estimates looks like what your team actually shipped last time. You'll have to do that sum yourself: Track doesn't total estimates per cycle or chart velocity. A spreadsheet or a napkin works.

## Step 4: the four views, and when to use each

Track has four views, and each answers a different question.

- **List**: "what's in this cycle?" Filter by cycle, sort by priority or identifier. This is your planning and triage view.
- **Board**: "where is everything?" Columns are your statuses, in order. To move a card, drag it to another column or change its status from the dropdown on the card. This is the standup view.
- **Calendar**: "what's due when?" Issues land on their due date; anything without one goes to an Unscheduled list. Useful for work tied to real dates: a launch, a client delivery.
- **Gantt**: "does the order make sense?" Bars run from start date to due date, and you can drag a bar to move it or drag its edges to change the start or end. That's also how you set an issue's start date. Combined with `blocks` relations, it's the best place to spot a dependency scheduled after the thing it blocks.

## Step 5: saved views so nobody rebuilds filters

Every combination of view type, filters and sort can be saved with a name, and you can mark one as your default for the project. Saved views are personal (each person keeps their own), so suggest a few to the team:

- **This cycle. Board**: board view, filtered by the current cycle.
- **My stuff**: list, filtered by your assignee, sorted by priority.
- **Urgent, any cycle**: list, priority urgent + high.
- **Dated work**: calendar, filtered by a label like `client`.

When a new cycle starts, update the cycle filter on the "This cycle" view and save it again.

## Step 6: during the cycle

The daily loop is short:

1. Open the board. Anything sitting in **In progress** for too long gets a comment.
2. Comments support @mentions; the mentioned person gets a notification in the Track **Inbox**, which also collects assignments, status changes and comments on your issues.
3. Attach screenshots or logs to the issue (up to 10 MB per file).
4. Each issue keeps an activity log: who changed status, priority, assignee, cycle or title, and when. When someone asks "why did this slip?", the answer is usually in there.

## Step 7: closing the cycle

On the last day, filter the list by the cycle and look at what's not in a done category. For each leftover, decide: keep it for the next cycle, send it back to backlog, or cancel it. Then click **Complete** in the cycles list: everything still unfinished moves to the next cycle in one go (or ends up with no cycle if there isn't one). Cancelled is a real status for a reason: killing work on purpose is a feature.

Then do a five-minute retro. If you use Docs, the built-in **Weekly retro** template works fine for this, and you can link the page from the next cycle's issues.

## What's missing (honestly)

Track covers the core of a cycle workflow, but not all of it. Today there are no velocity or burndown charts, cycles aren't created on a cadence, there's no command palette and no realtime sync: refresh to see a teammate's changes. If those are central to how your team works, a more mature tracker like Linear is still the better fit, and we'd rather tell you now.

If what you need is a box of time, a list, and a team that agrees on what "done" means, you have everything above. And it runs on your own server for free, or on zerosoft Cloud with a free tier.
