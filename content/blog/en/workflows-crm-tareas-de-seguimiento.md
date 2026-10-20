---
title: "CRM workflows that create follow-up tasks"
description: "How to use zerosoft CRM workflows to create follow-up tasks: the real triggers and actions, five recipes for small teams, and the limits to know."
date: "2026-08-08"
author: "zerosoft"
tags: ["crm", "workflows", "automation"]
---

Deals rarely die because someone said no. They die because nobody followed up. The proposal went out on a Tuesday, the week got busy, and by the time anyone remembered, the prospect had signed with someone who did remember.

The fix is to create the follow-up before anyone has to think about it. That's what workflows in zerosoft CRM are for, and the most useful thing they do is boring: create a task, with a date, attached to the right record.

## The pieces

A workflow lives in `/app/crm/workflows` and has three parts: a name, one or more **triggers** and one or more **actions**. Creating, editing, toggling, running and deleting workflows is **admin-only**: they're shared configuration for the whole workspace, and you don't want every member wiring automations.

The triggers that exist today:

- **Contact created**, **Contact updated**
- **Deal created**, **Deal updated**
- **Deal stage changed** (optionally only from a given stage and/or to a given stage)
- **Deal won**, **Deal lost**
- **Task due**
- **Email received**
- **Manual**

And the actions:

- **Create task**
- **Create activity** (a note, call, meeting or email entry on the timeline)
- **Send email**
- **Update field** (standard or custom)
- **Add to list** (static lists)
- **Webhook**
- **Notify user** (an in-app notification)

A workflow can have up to 10 triggers (any one of them fires it) and up to 20 actions, which run in order. Every run is logged in the workflow's run history with its status, so when something didn't happen, you can see why instead of guessing.

## How "Create task" behaves

This is the action you'll use most, so it's worth knowing exactly what it does:

- **Subject**: the task title. It's literal text; placeholders aren't filled in task subjects.
- **Due in days**: how many days from now. If empty, it defaults to 1.
- **Owner ID**: optional. Leave it empty and the task is created without an owner.
- **Associations come for free.** If the trigger was a deal, the task is attached to that deal, plus the deal's first contact and that contact's company. If it was a contact, it's attached to the contact and their company. The task shows up on the record's timeline, in the "next task" banner on the detail page, and in `/app/crm/tasks` under Overdue, Today or Upcoming.

## Five recipes for a small team

### 1. Every new lead gets a first touch

- Trigger: **Contact created**
- Action: **Create task**, subject "First call", due in 1 day

The simplest one and the one that pays off fastest. Every new contact, whether it came from the API or from someone typing it in, gets a dated task. Warning: CSV imports create contacts too. Switch this off before importing a few thousand rows unless you want a few thousand tasks.

### 2. Proposal sent → chase it in three days

- Trigger: **Deal stage changed**, to stage = your "Proposal sent" stage
- Action: **Create task**, subject "Follow up on proposal", due in 3 days

The stage filter takes the stage's ID, not its name. The quickest way to get it is `GET /api/v1/crm/pipelines` with your API key, which lists each pipeline with its stages. Yes, pasting an ID is rough; it's on our list.

### 3. Revisit lost deals

- Trigger: **Deal lost**
- Action: **Create task**, subject "Check back in", due in 90 days

Losing on timing or budget is different from losing on fit. A task three months out costs nothing and turns some "no"s into "not yet"s. zerosoft already asks for a lost reason when a deal is closed as lost, so the person who gets the task knows the context.

### 4. Won → kick off onboarding

- Trigger: **Deal won**
- Actions: **Create task** "Send onboarding kickoff", due in 1 day, then **Notify user** with a message like `Closed {{deal.name}} for {{deal.amount}} {{deal.currency}}`

Notification messages and emails do support placeholders: `{{contact.firstName}}`, `{{contact.fullName}}`, `{{contact.email}}`, `{{company.name}}`, `{{deal.name}}`, `{{deal.amount}}`, `{{deal.currency}}` and custom fields as `{{contact.custom.your_key}}`.

### 5. A task went overdue → make noise

- Trigger: **Task due**
- Action: **Notify user**, message `Overdue task for {{contact.fullName}}`

**Task due** fires once per task when its due date passes and it's still open. Change the date and it re-arms. It's driven by the scheduled `/api/cron/minute` and `/api/cron/tick` endpoints: on our cloud it runs every minute; if you self-host, point any cron at either one with your `CRON_SECRET` as a Bearer token, or this trigger never fires.

## The limits, honestly

Workflows are deliberately simple. Before building your process on them, know what they don't do:

- **No conditions or branches.** There's no "only if amount > 10,000" or "only if lifecycle is SQL". A trigger fires for every matching event. The stage filter on "Deal stage changed" is the only built-in narrowing.
- **"Updated" means any update.** "Deal updated" and "Contact updated" fire on every edit, including small ones. Pairing them with "Create task" is a great way to bury your team. Prefer specific triggers (stage changed, won, lost).
- **"Email received" depends on Gmail sync,** which is manual and read-only: emails come in when someone clicks sync, not in the background.
- **No delays or wait steps.** "Due in N days" sets the task's date; the workflow itself runs immediately.
- **Manual runs have no record attached.** "Run now" is good for testing an email or a webhook; a task created that way isn't linked to anything.
- **Loop protection.** An action like "Update field" can trigger other workflows, but a workflow never re-runs within the same chain and chains stop at three levels. You can't build an infinite loop; you also can't build a 10-step cascade.

## A sane starting set

If you're setting this up today, start with recipes 2 and 3. They cover the two moments where deals leak most: the silence after a proposal and the quiet after a loss. Add recipe 1 if leads come in faster than you can triage them. Add 5 once people actually work from the task list.

Then leave it alone for a month and look at the run history. If a workflow keeps creating tasks nobody completes, it's noise. Turn it off. The goal isn't more tasks. It's that the right follow-up already exists when someone opens the CRM on Monday.
