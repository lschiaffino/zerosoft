---
title: "Zero bugs on a small team: triage, deadlines and one rule"
description: "How to run a zero-bug policy with three to ten people: a rule with two exits, deadlines by priority, a weekly on-call rotation and Track's triage queue for whatever arrives through Chat or Flow."
date: "2026-10-18"
author: "zerosoft"
tags: ["track", "bugs", "playbook"]
---

Linear has written about [running a zero-bug policy](https://linear.app/now/zero-bugs-policy): every reported bug is either fixed or explicitly declined, and none of them get parked in a backlog. Their deadlines are 48 hours for high-priority bugs and 7 days for everything else. To get there, they paused product work for three weeks and cleared roughly 175 open bugs.

The idea is sound, and it fits a small team even better. With five people there's no QA department and no manager handing out tickets, so the bug backlog grows quietly until a customer leaves. This post adapts the policy to a team of three to ten and shows how to run it in Track with what Track does today.

## The rule: every bug has two exits

A bug that comes in can end up in exactly two places:

1. **Fixed**, within the deadline for its priority.
2. **Declined**, with one line explaining why ("only happens on Safari 14", "working as intended").

The third exit, "we'll get to it later", is off the table. Fixing a bug costs about the same today as it does in six months. What changes is how long the customer lives with it and how much context you lose in the meantime.

## Deadlines a small team can actually meet

Copying the deadlines of a company with dozens of engineers is the fastest way to abandon the policy within a month. Here's a version mapped to Track's four priorities:

| Priority in Track | What it means | Deadline |
|---|---|---|
| Urgent | Broken for everyone, or data is being lost | Same day |
| High | An important feature fails for some customers | 2 business days |
| Medium | Annoying, has a workaround | 7 days |
| Low | Cosmetic | 7 days, or decline it |

Track doesn't measure deadlines or warn you when one passes. What it does have is a **due date** on every issue: when you accept a bug, set the date from the table. From then on, the **Overview** shows what's overdue in each project, and **My tasks** groups each person's work into Overdue, Today, Upcoming and No date. That's your alarm.

## Step 1: one place where bugs land

The policy falls apart if bugs arrive through five channels and someone has to remember to copy them over. In Track, each project can turn on **Triage for external issues** in its settings (the Triage tab; an admin turns it on). With triage on, issues that weren't created by a person in the app wait in a separate queue until someone accepts them. They stay out of lists and My tasks in the meantime, so the team's board doesn't fill up with noise.

What feeds that queue today:

- **Chat**: an agent in Agents with the **Create Track issue** tool can file the bug a visitor reports, with their contact details in the description.
- **Flow**: the **Track: create issue** step creates an issue from any flow. There's a template, "Chat bug report → Track issue", that uses AI to spot messages reporting a bug and opens a high-priority issue. The same step can turn CRM form submissions into issues (trigger "CRM: form submitted").

Bugs the team finds itself are filed from the app and go straight to the list, skipping triage. Every issue in the queue shows where it came from ("From Chat", "From Flow"), so you know who to get back to.

## Step 2: a weekly on-call

Someone has to watch the queue. On a small team, rotate on-call weekly among everyone who writes code, founders included. That person opens the triage queue twice a day and resolves each issue with one of three buttons:

- **Accept into** a status (by default, the first one in the Todo category), with priority, assignee and due date.
- **Decline**: the issue moves to the project's cancelled status. That's the "declined" exit. Leave the reason in a comment.
- **Duplicate**: type the original's identifier (say `ZER-12`). Track links them with a "duplicates" relation and cancels the copy.

If two people resolve the same issue at once, Track tells the second one that someone else already did, so nobody steps on anyone.

On-call doesn't fix everything. It decides. It assigns the bug to whoever knows that part of the code best, and if nobody does, it keeps it.

## Step 3: bugs first, every morning

The habit that makes it all work is simple: the first thing you do each day is your assigned bugs. Open **My tasks**, check Overdue and Today, and only then move on to cycle work.

So nobody rebuilds filters every day, save a view in the issue list: priority Urgent and High, label `bug`, sorted by priority. Labels belong to the workspace and are shared across projects, so `bug` means the same thing everywhere. Saved views are personal; share the recipe and let everyone save their own.

From the keyboard: `J` and `K` move through the list, `Enter` opens the issue and `C` creates a new one.

## Step 4: let the merge close the bug

Connect the GitHub integration (one webhook per workspace, with the repos you pick) and Track links every PR or commit that mentions an issue identifier in the branch, title or description. From the issue you can **copy the branch name** it suggests, something like `zer-123-fix-the-login`, so the PR is linked the moment you open it.

In the settings you choose what happens to the status: move the issue to In progress when the PR opens and to Done when it merges. In a PR description, only mentions preceded by a keyword like `fixes`, `closes` or `resolves` count toward closing. A "blocked by ZER-11" links without closing.

## Step 5: the Friday review

Fifteen minutes, whole team:

1. Look at the **Overview**: overdue issues per project and how many are waiting in triage.
2. Filter the list by the `bug` label and tally by assignee. If someone has more than four or five open, redistribute, or pull them out of the cycle for two days to clear their queue.
3. Look for patterns. If half this week's bugs came from the same module, that's a product issue, and it goes into the next cycle.
4. Hand on-call to the next person.

Track has no per-person bug dashboard; you do this count with filters. With ten or twenty open bugs, that's enough.

## Getting started: empty the backlog once

If you have forty old bugs today, the policy can't start until they're resolved. A cleanup week is usually enough for a small team:

- Select the old bugs in the list (`X` marks the active row, Shift+click marks a range) and use **bulk edit** to change status, priority, assignee or labels in one go.
- Anything nobody can reproduce goes to cancelled with a comment.
- The rest gets split up and fixed that week, with no new work.

## Telling the customer

Closing the loop is the part customers appreciate most. When a bug that came in through Chat moves to Done, reply in the same conversation. Today that reply is manual: Track and Chat don't reopen the conversation on their own yet. If you want to automate part of it, Flow has a "Track: issue changed status" trigger, and the "Urgent issue → Discord" template shows how to send a heads-up to a team channel.

## What you need, and what's missing

You need a project with triage turned on, a `bug` label, a deadline table the team agrees to and a rotating on-call. All of that runs in Track, on your own server for $0 or on zerosoft Cloud.

What Track doesn't do yet: measure bug deadlines, show a bug board per person, or reopen the Chat conversation when the issue closes. If your policy depends on those numbers, you'll be tracking them by hand for now.
