---
title: "Meeting notes that end in tasks"
description: "A meeting notes format in Docs with decisions and action items that have an owner and a date, a tracking table between meetings, moving the big items to Track and an automatic page for every Cal booking."
date: "2026-10-18"
author: "zerosoft"
tags: ["docs", "meetings", "templates"]
---

Notion's blog has a widely read post on [meeting notes templates](https://www.notion.com/blog/meeting-notes-template). It splits the work into three moments (before, during and after), and recommends sending an agenda, naming a notetaker and closing with next steps that have an owner.

All of that is right. The trouble shows up a week later: the notes exist, but nobody knows whether the action items got done. Follow-up is where meeting notes break down. This post suggests a short format in Docs where every action item has an owner and a date, a way to review them at the next meeting, and a rule for moving real work into Track.

## The starting template

Docs ships a **Meeting notes** template with three sections: Agenda, Notes and Action items (with a to-do). Create the page from the Docs home with **Start from a template** and add what's missing. Here's ours:

```
Date: 2026-10-20 · Attendees: @Ana, @Martín, @Lucía
Notes: @Martín

## Agenda
- Annual plan pricing (Ana, 10 min)
- Contacts CSV bug (Lucía, 5 min)

## Decisions
- The annual plan gets 2 months off. Decided by: Ana.

## Notes
...

## Action items
[ ] @Lucía: Fix the CSV export · due 10/22
[ ] @Ana: Update the pricing page · due 10/24

## Carried over from last meeting
- [[Product · 2026-10-13]]
```

Three changes from the built-in template:

1. **A Decisions section, separate from Notes.** A month from now nobody will reread the notes, but someone will ask "when did we decide this, and who?". One line per decision, with who made it.
2. **Every action item gets an @person and a date.** When you type `@` and pick a teammate, Docs sends them a notification that you mentioned them on that page. That notification replaces "I'll send you the notes".
3. **A link to the previous meeting** with `[[`, which searches pages by title as you type. That's why it pays to title them all the same way: `Product · 2026-10-20`.

Docs doesn't let you save your own templates yet. Our workaround: a "Templates" page with this version inside, and **Duplicate** whenever you need it. Duplicate copies the page with all its subpages.

## Before: the agenda lives on the same page

Create the meeting page the day before and write the agenda there, with who's bringing each topic and how many minutes it gets. Anyone who wants to add a topic adds it on the page. If someone wants to weigh in on an item ahead of time, they can leave a **comment on that block**: the comment sticks to the agenda item and gets resolved when it's covered.

A rule that saves meetings: if the agenda is empty the night before, the meeting is canceled.

## During: notes from someone who isn't talking

One person takes notes, rotating weekly. Three shortcuts help them keep up:

- `/` opens the block menu: headings, lists, to-dos, quotes, code, tables.
- `[[` links another page: a spec, a customer's page, the previous meeting.
- `@` mentions someone.

Docs saves on its own as soon as you stop typing. If two people edit the page at once, Docs warns that someone else edited it while you were writing and lets you load the new version or overwrite it with yours. Real-time editing with multiple cursors doesn't exist yet, so during the meeting one person types and everyone else comments.

## After: ten minutes to tidy up

Right after the meeting, the notetaker:

1. Turns loose notes into short bullets.
2. Checks that every action item has an @person and a date. An action item with no owner isn't an action item.
3. Moves anything decided mid-discussion into Decisions.
4. Decides which action items go to Track (see below).

If the notes have to go outside the team, say to a customer, the page menu exports to **Markdown** or **PDF**. For a teammate, **Copy link** is enough.

## Follow-up: a table of open action items

This is the step almost every template skips. Each meeting's action items stay on that meeting's page, and nobody opens five pages to see what's still pending.

The fix in Docs is one standing page, "Open action items", with a **database block** (`/database`): a table with typed columns. Ours:

| Action | Owner | Due | Status | Meeting |
|---|---|---|---|---|
| Fix the CSV export | Lucía | 2026-10-22 | Open | Product · 10-20 |
| Update the pricing page | Ana | 2026-10-24 | Open | Product · 10-20 |

Columns: Action (text), Owner (select with the team's names), Due (date), Status (select: Open, Done, Dropped), Meeting (text).

The database block can't filter, sort or group yet, and it has no relations to other pages. For a small team that's workable: delete the done rows every week and the table stays short.

The next meeting opens with that table, five minutes. Every overdue item has three ways out: it got done, it gets a new date, or it's dropped out loud.

## What goes to Track and what stays in Docs

Not every action item is the same. A simple rule:

- **It stays in Docs** if it takes less than a day and doesn't depend on anyone else: "send X the contract", "confirm the date with the vendor".
- **It goes to Track** if it's product work, has subtasks, or someone else will need to see where it stands. In Track it gets a status, a priority, a cycle and comments, and it shows up in the person's **My tasks**.

When an item moves to Track, replace its text in the notes with the issue identifier (`APP-57`). Today that's manual: you copy the title and create the issue in Track. Docs and Track aren't connected by a block or an automatic link yet.

## Customer meetings: one page per booking

If you schedule meetings with Cal, Flow can create the notes page for you. Build a flow with the **Cal: booking created** trigger and the **Docs: create page** step, with a title like:

```
{{trigger.eventType.title}} · {{trigger.invitee.name}}
```

and put the invitee's email and the date in the content (`{{trigger.invitee.email}}`, `{{trigger.startsAt}}`). Blank lines separate paragraphs. The step only creates paragraphs, so you add the template's headings when you open the page. Flow also ships the "New Cal booking → Track task" template, which creates an issue to prepare each meeting.

## What Docs doesn't do (yet)

Notion summarizes notes with AI and drafts the list of action items. Docs has no AI inside the editor. It also lacks real-time editing and a database with filters. What it does have is enough for every meeting to end with written decisions and owned action items: a template, mentions, links between pages, per-block comments, version history and export. It runs on your own server for $0 or on zerosoft Cloud, and if you want to see how this fits with the rest of your wiki, we have a [guide to building an internal wiki with Docs](/blog/wiki-interna-con-docs).
