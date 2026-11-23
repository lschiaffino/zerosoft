---
title: "How to fill out a timesheet so someone can actually use it"
description: "What to record, how often and in how much detail: a weekly timesheet layout, rules for notes, good and bad entry examples, and how it works in Time, the zerosoft hours app, including what it doesn't do yet."
date: "2026-11-23"
author: "zerosoft"
tags: ["time", "harvest", "timesheets"]
---

Harvest published a [guide on how to write a timesheet](https://www.getharvest.com/blog/how-do-you-write-a-timesheet), aimed at mid-sized companies that have to pick a format, define a pay period and collect approvals. If you're a team of three to fifteen people who bills by the hour, or just wants to know where the week went, your problem is smaller and more practical: what to record so the sheet is useful when someone who wasn't there opens it.

This post proposes a layout, rules for notes and a weekly routine. At the end, how it works in Time, the zerosoft hours app, and what it doesn't have yet.

## A timesheet answers four questions

Before the layout, the purpose. A sheet works if, opened six months later, it answers:

1. **Who** worked.
2. **For which client or project**.
3. **On what kind of work** (design, development, meetings, admin).
4. **How long**, and whether it can be billed.

Everything else is optional. If your sheet answers those four, it already beats most spreadsheets going around.

## The minimum layout: one row per project and task

The structure that holds up best is a weekly grid. Each row is a project with a task, each column is a day, and totals go at the end:

| Project and task | Mon | Tue | Wed | Thu | Fri | Total |
|---|---|---|---|---|---|---|
| Rivera site, design | 3:00 | 2:30 | | 1:00 | | 6:30 |
| Rivera site, development | | 3:00 | 5:00 | 4:00 | 2:00 | 14:00 |
| Internal, meetings | 1:00 | 0:30 | 1:00 | | 1:00 | 3:30 |
| Total | 4:00 | 6:00 | 6:00 | 5:00 | 3:00 | 24:00 |

Two decisions worth making once and not revisiting:

- **Short, fixed tasks.** Five to eight task types for the whole team. If everyone invents their own, reports by task can't be compared.
- **Internal work counts too.** Meetings, admin and training get their own project, marked non-billable. If it isn't logged, billable hours look more efficient than they are and the real cost of a client is understated.

## How often to log

There are three habits and they behave differently:

- **With a timer, as it happens.** The most precise and the easiest to forget: you start the timer, get interrupted, two hours pass.
- **End of day, ten minutes.** The middle ground. You still remember what you did, and it's short enough not to feel heavy.
- **On Friday, from memory.** The least reliable. Hours drift toward what "should" have happened, and long Mondays disappear.

For a small team the rule that holds up best is: **log at the end of each day and review the week on Friday**. Keep the timer for work you do in one stretch and bill by the minute.

## How to write notes

The note turns an hour into an explanation. Compare:

| Weak note | Useful note |
|---|---|
| "Worked on the site" | "Mobile mockup of the home page, menu tweaks" |
| "Meeting" | "Call with Rivera: scoping the online store" |
| "Misc" | "Answered 12 support emails and fixed the contact form" |
| "Fixes" | "Cart bug: the coupon was applied twice" |

A rule that helps: **verb plus object**. If whoever invoices has to ask what you meant, the note failed. Two or three lines are enough; it doesn't need to be a diary.

## How to write the duration

Pick one format and keep it. Decimals (1.5) or hours and minutes (1:30), but don't mix them inside one report without saying so. On rounding, decide it in writing: if you round, always round the same way, and if you don't, the policy should say so. The worst case is everyone rounding by their own judgment.

## The weekly routine in five steps

1. **Monday**: open the new week and copy the rows from the previous one, so you don't rebuild the grid.
2. **Every day**: log hours and one note per entry when you finish.
3. **Friday afternoon**: check the totals. Any empty day? Any row with weak notes?
4. **Friday**: if your team approves hours, submit the week.
5. **First working day of the month**: export the month and compare it with what was invoiced.

## How this works in Time

Time is the zerosoft hours app. One caveat first: on the site it's marked "Coming soon". The code is in the repository, but it isn't yet an app any workspace can open from the catalog. What follows describes what the code already does and what it doesn't.

**What it does:**

- **Timer and manual entry.** One timer per person (starting another stops the first) and durations typed as `1:30`, `1.5`, `1,5`, `90m` or `1h 30m`, up to 24 hours per entry.
- **Day view and a weekly grid**, with a row per project and task, totals per row, day and week, and a button to copy the rows from the last week with hours. The week runs Monday to Sunday.
- **Notes on every entry**, up to 2000 characters. You write them in the day view.
- **Projects with client, code, hourly rate and a budget in hours.** Each project can have its own team and its own tasks, each billable or not in that project.
- **Week approval.** The person submits their week and the hours are locked. Owners and admins approve it or return it with a note. While it's pending, the person can withdraw it.
- **Reports** by project, client, task or person, with hours, billable hours and amount, plus CSV export with date, person, client, project, task, notes, hours, billable and amount. A member sees only their own hours.
- **Keyboard shortcuts**: `N` opens a new entry.
- It runs on your server, with your data in your database.

**What it doesn't do yet**, worth knowing before you adopt it:

- Start and end time on each entry: you enter the duration.
- Reminders to nudge people to log their hours.
- Invoices from hours, expenses and payments.
- Rates per person or per task, and budget alerts.
- Editing a teammate's hours (today everyone edits their own).
- A public API and phone or desktop apps. It works in a phone browser.
- Importing from Harvest.

If you need to invoice from hours or send automatic reminders today, Harvest does that and Time doesn't. If what you want is a tidy sheet, approvals and a CSV you can open in any spreadsheet, the flow above is already there.

## A template to copy

If for now you track hours in a spreadsheet, this structure covers the essentials. One row per entry:

```
date | person | client | project | task | notes | hours | billable
2026-11-18 | Lucía | Rivera | Site | Design | Mobile mockup of the home page | 3.00 | yes
```

It's the same column order the Time CSV uses, so if you migrate later the columns already match.

## The summary on one card

- A sheet answers four things: who, for whom, on what kind of work and how long.
- One row per project and task; five to eight fixed tasks; log internal work too.
- Log at the end of each day and review on Friday.
- Notes with a verb and an object, not "misc".
- One duration format and a rounding policy, in writing.
- Time does the sheet, approvals and CSV. It doesn't invoice, remind or record start and end times yet.
