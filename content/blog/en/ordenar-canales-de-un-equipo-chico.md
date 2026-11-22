---
title: "How to organize channels for a small team: names, sections and archiving"
description: "A one-page naming convention, which channels to create first, when to archive, and how to build your own sidebar sections in Talk, the open source chat from zerosoft."
date: "2026-11-22"
author: "zerosoft"
tags: ["talk", "slack", "guide"]
---

A ten-person chat workspace starts with three channels and has forty six months later. Nobody knows which one is right for asking about an invoice, three channels have nearly the same name, and the "ideas" channel hasn't had a message since March. What's usually missing is the same thing every time: someone writing down how a channel gets named, when it gets created and when it gets closed.

Slack has [a guide to organizing channels](https://slack.com/blog/collaboration/how-to-use-slack-channels-to-organize-your-work) that, among other things, recommends prefixes so a channel's purpose reads from its name. It's a good starting point. This is our version for teams of five to twenty people, with what Talk does at each step. Talk is the zerosoft chat: public and private channels, threads, huddles, canvases and lists, AGPL licensed, and you can run it on your own server.

## Before creating anything: three questions

Whenever someone wants a new channel, they answer:

1. **Who has to read it?** If the answer is "everyone", it probably exists already (`general`).
2. **When does it end?** A project with an end date is a channel with an archive date. A permanent topic (sales, support) isn't.
3. **Can you say what it's for in one sentence?** If not, it isn't a channel yet. It's a conversation.

That alone cuts the number of channels roughly in half.

## A one-page naming convention

Talk normalizes names on creation: lowercase, spaces turned into hyphens, symbols removed, up to 80 characters. It also refuses a duplicate name in the workspace, across public and private channels. That helps, but the prefix is your call. We suggest four:

| Prefix | Use | Example |
|---|---|---|
| `team-` | A team or function | `team-sales`, `team-support` |
| `proj-` | A project with an end date | `proj-web-redesign`, `proj-q1-launch` |
| `cust-` | A customer or account | `cust-lopez-bakery` |
| `help-` | Asking for help on a topic | `help-billing`, `help-infra` |

Plus two channels without a prefix: `general` (Talk creates it by itself in every workspace) and `announcements` for what everyone must read. If you want a social one, use `social-`.

Two rules that save arguments: the separator is always the hyphen, and names are singular and carry no dates. `proj-launch` ages better than `proj-launch-nov-2026`.

Write the convention in a short document and keep it handy. If you use zerosoft Docs, one page in the workspace is enough. Also add it as a bookmark in `general` (more on that below).

## What to put in the topic and description

When you create a channel in Talk you can fill in a **topic** (up to 250 characters) and a **description** (up to 1000). Use them differently:

- **Topic:** one line saying what the channel is for and what doesn't belong there. Example: `Customer support requests. Bugs are reported in Track.`
- **Description:** who watches it, when it gets answered, links to the important things.

You can change the topic at any time with the `/topic` command from the channel itself. The channel directory search looks at the name, topic and description, so a good topic also helps people find the channel without asking.

## Bookmarks and pinned messages

Each channel has a bookmark bar under the header. Any member can add, edit or delete links (up to 50 per channel, http and https only). Uses that work:

- In `team-sales`: the CRM pipeline, the proposal template, the price list.
- In `proj-*`: the brief, the Board canvas, the deliverables folder.
- In `general`: the naming convention and the team calendar.

**Pinned messages** are for decisions, not chatter: "We picked vendor X, reasoning in this thread." Talk shows up to 100 pinned messages per channel, but a channel with more than five isn't really pinning anything.

## Your own sidebar sections

Even with a good convention, everyone looks at the workspace differently. In Talk each person builds their own **sections**: create them, rename them, reorder them, and move channels and direct messages into them from each item's menu. You get up to 30, and each section can sort A to Z or by recent activity. Nobody else sees your sections.

A setup that suits most people:

1. **Starred:** the three or four channels you open every day.
2. **Customers:** every `cust-*`, sorted by activity.
3. **Projects:** every `proj-*`, A to Z.
4. **Quiet:** `social-*` and whatever you check once a day.

Because sections are personal, one person's mess doesn't spill onto everyone else.

## When to archive

Archiving is the step most teams skip. A simple rule: **a `proj-*` channel gets archived the week the project ends**, and a channel with no messages in 60 days gets a question in `general` asking whether anyone needs it.

In Talk, archiving deletes nothing: the channel stops accepting messages, leaves the sidebar and can be restored. Archived channels show up in the channel directory with the archived filter, so the history is still there to search. The person who created the channel, a channel admin or a workspace admin can archive it, rename it, make it private or delete it.

One thing we don't do yet: converting a group direct message into a private channel. If a four-person chat becomes permanent, today you create the channel and tell people.

## A 15-minute review each quarter

Put this on the calendar every three months:

1. Open the channel directory and sort by name. Find names that break the convention and rename them.
2. List archive candidates. Ask in `general` with a one-week deadline.
3. Check that every live channel has a topic.
4. Delete broken bookmarks.

## What changes when chat is part of a suite

In a standalone chat, a customer's channel and that customer's board are two separate worlds. In zerosoft, channels live next to CRM, Track, Board and Docs in the same workspace, with the same people and permissions. A bookmark in `cust-lopez-bakery` can point straight to the CRM deal, and the Track issue for a request sits one click from the channel where it was discussed.

And since we don't charge per seat, adding your external accountant or a freelancer as a guest in a single channel doesn't change the bill. You can try it on zerosoft Cloud or run Talk on your own server: the core is AGPLv3 with all its features, and your conversations stay in your database.

## Summary to paste in `general`

```
Channels: team-, proj-, cust-, help-, social-
Separator: hyphen. Singular. No dates.
Every channel has a topic (what it is and what it isn't).
Projects are archived the week they end.
We review the directory every quarter.
Unsure? Ask in #general before creating.
```
