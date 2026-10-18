---
title: "How to write an issue someone can actually finish"
description: "Rules for issue titles, descriptions and size, three plain-text templates for bugs, tasks and investigations, and how to use sub-issues, relations and estimates in Track."
date: "2026-10-18"
author: "zerosoft"
tags: ["track", "issues", "templates"]
---

The Linear Method has a chapter worth reading: [write issues, not user stories](https://linear.app/method/write-issues-not-user-stories). The argument is that the "as a user, I want…" format has turned into a ritual that hides the work, and that an issue should describe a concrete task with a clear outcome.

We agree. But "a concrete task" is easy to say and hard to write at six on a Tuesday evening. This post turns the idea into rules you can check and three templates you can paste, written for a small team where the same person writes the issue, does it and closes it.

## The test for a well-written issue

Before you save an issue, ask three questions:

1. **Is it clear when it's done?** If two people could argue about whether it's finished, the criterion is missing.
2. **Does it fit in two or three days of work?** If not, it's several issues.
3. **Could someone who missed the meeting start it?** If it needs "ask Juan", context is missing.

An issue that passes all three almost always gets finished. One that fails any of them sits in In progress for weeks.

## Titles: a verb and an object

Titles get read in lists, on the board and in the inbox, often without opening the issue. They have to say what gets done.

| Before | After |
|---|---|
| Login | Show the password error under the field |
| Export bug | Contacts CSV downloads without the email column |
| Improve onboarding | Skip the team step for solo users |
| Look into payments | Find out whether Mercado Pago supports recurring charges |

Three rules:

- **Start tasks with a verb** ("Add", "Move", "Remove"). For bugs, describe the symptom the way the user sees it.
- **No prefixes** like `[BUG]` or `FRONT:`. That's what labels are for. In Track, labels belong to the workspace, are shared across projects, and each issue can have up to 10.
- **Under ten words.** If it doesn't fit, it's probably two issues.

## Descriptions: just enough to start

A good description is short. It has the context the person needs to get going and the criterion for knowing they're done. Everything else (the product discussion, the alternatives, the strategic why) goes in a separate, linked document.

In Track the description is plain text, up to 5,000 characters. And Track doesn't have issue templates yet. Our workaround: keep the three templates below on a Docs page called "Issue templates" and copy them when you need one.

### Template 1: bug

```
What happens:
The contacts CSV downloads without the email column.

Steps to reproduce:
1. CRM > Contacts > Export
2. Open the file

What should happen:
Email is the first column, like in the table view.

Where:
Chrome 129, test workspace. Reported by a customer through Chat.

What the customer said (verbatim):
"I export and the emails aren't there, I have to copy them by hand."
```

The last section matters. Paste the customer's words exactly, without summarizing. When the issue arrives through triage from Chat or Flow, the description holds whatever the agent or the flow filed; if the customer's actual message is missing, copy it from the conversation before you accept the issue.

### Template 2: task

```
Why:
Solo users see an "Invite your team" step that doesn't apply to them.

What to do:
If the workspace has one member, skip onboarding step 3.

Done when:
- A new user with no team goes from step 2 to step 4.
- A user with a team still sees step 3.

Out of scope:
Redesigning step 3.
```

"Done when" is the section that saves the most time. "Out of scope" is the one that keeps a one-day task from becoming a one-week task.

### Template 3: investigation

```
Question:
Does Mercado Pago support subscriptions with automatic charges in Argentina and Mexico?

To decide:
Whether we add subscriptions to checkout this quarter.

Deliverable:
A comment on this issue with yes/no per country, a link to the docs and a rough estimate of the work.

Time box: 1 day.
```

Investigations are legitimate issues as long as they have a question, a deliverable and a time box. Without the time box, they become the oldest issue on the board.

## Who writes the issue

The person who'll do the work describes it best, and writing it forces them to think it through. On a small team, the practical rule is:

- **If it's yours, you write it.**
- **If you found someone else's bug**, describe the symptom and assign it to them. Let whoever does the fix write the solution.
- **If a customer asked for it**, the issue comes in with their words (through triage or by hand) and the assignee turns it into a task.

## Size: estimates and sub-issues

Track takes estimates as whole numbers, with no scale imposed. Pick one and stick to it. We use 1, 2, 3 and 5, where 5 is the ceiling: anything bigger gets split.

To split, use **sub-issues**. From any issue you can create a child, which is a full issue with its own status, assignee and estimate. The parent stays as an umbrella and lists its children. A useful rule: don't estimate the parent, estimate the children.

Example, `APP-40` "Subscriptions in checkout" (not estimated):

- `APP-41` Save the Mercado Pago subscription on the order (3)
- `APP-42` Show the charge status on the order detail (2)
- `APP-43` Send the failed-charge email (2)

## Dependencies: relations, not paragraphs

"This depends on the payments thing" written in a description gets lost. Track has three relations: **blocks**, **related to** and **duplicates**. You add them from the issue detail by typing the other issue's identifier, and they show on both sides: if `APP-41` blocks `APP-42`, the second one shows "blocked by". In the **Gantt** view you can spot a blocked issue scheduled before the one blocking it.

## From issue to code

If you use the GitHub integration, the issue detail has **Copy branch name**, which builds `app-41-save-the-mercado-pago-subscription-on-the-order` from the identifier and the title. The title is cut at 50 characters, another reason to keep it short: it ends up being the branch name. With `fixes APP-41` in the PR description, the merge can move the issue to Done, if you set it up that way.

## A checklist for your wiki

- [ ] The title starts with a verb or describes a symptom, in under ten words.
- [ ] The description says when it's done.
- [ ] It fits in two or three days; if not, it has sub-issues.
- [ ] The customer's words are quoted verbatim.
- [ ] Dependencies are relations.
- [ ] It has a priority, an assignee and, if there's a real date, a due date.

If your team already uses Docs, this list fits on the same page as the templates. Track and Docs run on your own server for $0 or on zerosoft Cloud. When Track gets its own issue templates, the Docs page won't be needed anymore, and we'll say so in the changelog.
