---
title: "Running cycles in Track: a playbook for small teams"
description: "How a small team can run two-week cycles in Track with issues, sub-issues, relations, estimates, custom statuses and four views — plus the parts that still need a workaround."
date: "2026-07-26"
author: "Zerosoftware"
tags: ["track", "cycles", "playbook"]
---

Cycles are the least glamorous good idea in project management. You pick a window — usually two weeks — decide what fits in it, do it, and look at what didn't make it. No story-point poker, no forty-field Jira form. Just a box of time and a list.

This is how we'd run cycles in Track for a team of three to ten people. It's a playbook, not a feature tour, so it includes the parts where Track makes you work a little: there's no "new cycle" button yet, and we'll show you the exact workaround.

## Step 0: one project per team, not per feature

In Track, a project owns its issues, statuses and cycles. Every issue gets an identifier built from the project slug: a project with slug `app` produces `APP-1`, `APP-2`, and so on.

The temptation is to create a project per initiative. Resist it. Cycles live inside a project, so if your team's work is spread across five projects, you get five parallel sprints and nobody knows which one matters. One project per team, labels for initiatives. Labels are free-form (up to 10 per issue, each with a color), and you can filter by them.

## Step 1: set up your statuses

A new project ships with five statuses: **Backlog, Todo, In progress, Done, Cancelled**. Each status belongs to one of those five categories under the hood, which is what keeps things sane when you add your own.

Most small teams need exactly one extra: **In review**. Today, custom statuses are created through the app's own endpoint, not a settings screen. While logged in, open your browser's dev console on any Track page and run:

```js
await fetch('/api/track/projects/<project-id>/statuses', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'In review', category: 'in_progress', color: '#666666' }),
}).then((r) => r.json());
```

The project id is the UUID in the URL (`/app/track/projects/<project-id>`). The `category` must be one of `backlog`, `todo`, `in_progress`, `done` or `cancelled`. New statuses go to the end of the list; to reorder, send the full list of status ids to `PATCH /api/track/projects/<project-id>/statuses/reorder` as `{ "statusIds": [...] }`.

Yes, it's clunky. A settings UI for statuses and cycles is the obvious next step. Note that these are internal, session-authenticated routes — Track has no public API yet.

## Step 2: create the cycle

Same story: cycles are created with a POST, and then they show up everywhere in the UI — the issue form, the properties panel, the filters, and the cycles list at the bottom of the project page.

```js
await fetch('/api/track/projects/<project-id>/cycles', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Cycle 14', startAt: '2026-08-03', endAt: '2026-08-14' }),
}).then((r) => r.json());
```

Our advice: create the next two or three cycles at once, so planning never blocks on someone opening the console. Name them boringly ("Cycle 14", "Cycle 15"). There's no edit endpoint for a cycle yet — if you get the dates wrong, delete it (`DELETE /api/track/cycles/<id>`) and recreate it.

## Step 3: planning — issues, sub-issues, estimates

Planning is where Track feels normal again. Everything below is in the UI.

- **Issues** have a title, a rich-text description, status, priority (urgent, high, medium, low), assignee, labels, due date, cycle and estimate.
- **Estimates** are plain whole numbers. Track doesn't impose a scale. Pick one and stick to it — we like 1, 2, 3, 5, and anything bigger than 5 gets split.
- **Sub-issues**: from any issue, create a subtask. It's a full issue with its own status and assignee, and the parent shows its children. Use them when a "5" turns out to be three "2s".
- **Relations**: `blocks`, `related` and `duplicates`. Add them from the issue detail by typing the other issue's identifier. The other issue shows the inverse ("blocked by", "duplicated by"), so dependencies are visible from both ends.

A practical planning meeting: filter the list by the **Backlog** status, sort by **priority**, and assign issues to the cycle from the properties panel until the sum of estimates looks like what your team actually shipped last time. You'll have to do that sum yourself — Track doesn't total estimates per cycle or chart velocity. A spreadsheet or a napkin works.

## Step 4: the four views, and when to use each

Track has four views, and each answers a different question.

- **List** — "what's in this cycle?" Filter by cycle, sort by priority or identifier. This is your planning and triage view.
- **Board** — "where is everything?" Columns are your statuses, in order. To move a card, change its status from the dropdown on the card (no drag-and-drop on the board yet). This is the standup view.
- **Calendar** — "what's due when?" Issues land on their due date; anything without one goes to an Unscheduled list. Useful for work tied to real dates: a launch, a client delivery.
- **Gantt** — "does the order make sense?" Bars run from start date to due date, and you can drag a bar to move it or drag its edges to change the start or end. That's also how you set an issue's start date. Combined with `blocks` relations, it's the best place to spot a dependency scheduled after the thing it blocks.

## Step 5: saved views so nobody rebuilds filters

Every combination of view type, filters and sort can be saved with a name, and you can mark one as your default for the project. Saved views are personal — each person keeps their own — so suggest a few to the team:

- **This cycle — board**: board view, filtered by the current cycle.
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

On the last day, filter the list by the cycle and look at what's not in a done category. For each leftover, decide: move it to the next cycle (one change in the properties panel), send it back to backlog, or cancel it. Cancelled is a real status for a reason — killing work on purpose is a feature.

Then do a five-minute retro. If you use Docs, the built-in **Weekly retro** template works fine for this, and you can link the page from the next cycle's issues.

## What's missing (honestly)

Track covers the core of a cycle workflow, but not all of it. Today there's no settings UI for statuses or cycles, no velocity or burndown charts, no automatic rollover of unfinished issues, no keyboard shortcuts and no realtime sync — refresh to see a teammate's changes. If those are central to how your team works, a more mature tracker like Linear is still the better fit, and we'd rather tell you now.

If what you need is a box of time, a list, and a team that agrees on what "done" means, you have everything above. And it runs on your own server for free, or on Zerosoft Cloud with a free tier.
