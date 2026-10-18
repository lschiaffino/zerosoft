---
title: "A retro on a whiteboard: format, a 45-minute script and what to do with the actions"
description: "How to prepare and run a team retrospective in Board: three formats, a minute-by-minute script, dot voting and action items that land in Track. Including how to work with a board that doesn't do live co-editing yet."
date: "2026-10-18"
author: "zerosoft"
tags: ["board", "miro", "retros"]
---

Miro has a long [guide to retrospectives](https://miro.com/agile/guide-to-retrospectives/) with formats, questions and facilitation tips, plus a template gallery for each one. It's useful. It also assumes the whole team is on the same board at the same time, with cursors flying around and a timer on screen.

This post is for a small team that wants a retro every two weeks with the bare minimum: a whiteboard, forty-five minutes and a list of actions someone will actually do. We use Board, the zerosoft infinite whiteboard, and we'll tell you its biggest limitation for retros up front, because it changes how you should run one.

## What to know about Board before you start

Board is built on Excalidraw. Everyone in your workspace can open and edit every board, it saves itself while you draw, and it has read-only links for showing it to outsiders.

What it doesn't do yet: **live editing between several people**. You don't see other people's cursors. If two people change the same board in the same stretch of time, whoever saves second sees "This board changed somewhere else", with the name of the person who changed it, and two buttons: **Reload** or **Keep my version**. Keeping yours overwrites what the other person did.

Board also has no timer, built-in voting or anonymous mode. None of that gets in the way of a good retro. It just means splitting it into two moments: everyone writes on their own beforehand, and during the meeting a single person drives the board.

## Pick a format (and change it now and then)

Running the same format for months is one of the fastest ways to turn a retro into a chore. Three that work well for small teams:

**Start, stop, continue.** Three columns: what we should start doing, what we should stop doing, what works and is worth keeping. The most direct one, and the best place to begin.

**4Ls.** Liked, learned, lacked, longed for. Good for closing a project or a quarter, because it pulls out lessons as well as complaints.

**Sailboat.** A boat drawn in the middle: the wind is what pushes us forward, the anchor is what holds us back, the rocks are risks ahead and the island is the goal. It works when the team is tired of columns, and on a freehand board it takes two minutes to draw.

## Build the template once

Board doesn't ship retro templates. You build one in ten minutes and never build it again:

1. Create a board called "Retro: template".
2. Draw one large rectangle per column, with the title on top in big text.
3. Off to the side, one narrow column per team member with their name, in whichever format you chose. That's where each person writes before the meeting.
4. At the bottom, an "Actions" rectangle with three lines: what, who, by when.

For each retro, open the template's menu and hit **Duplicate**. The copy carries everything over, and the thumbnail in the list lets you recognize each retro at a glance. Rename it with the date: "Retro 2026-10-17".

## Before the meeting: everyone writes in their own zone

Two days ahead, post the board link in the team channel with a prompt: "By Thursday at noon, add your cards to your column. One idea per card, starting with a verb."

Writing ahead has benefits that have nothing to do with the tool. People who speak less in meetings write as much as everyone else. Nobody anchors on the first opinion said out loud. And the meeting starts with the material already on the table.

Since each person writes in their own zone and at different times, collisions are rare. If someone gets the conflict notice, the rule is simple: **Reload** and add the last card again. Never "Keep my version" on a shared board unless you know exactly what the other person changed.

## The meeting: a 45-minute script

One person facilitates and shares their screen. They're the only one editing during the meeting, so there are no conflicts.

**Minutes 0 to 5: the check-in.** A quick round: from 1 to 5, how did you finish the sprint? Said out loud, not discussed. If several people say 2, you already know where the conversation is heading.

**Minutes 5 to 10: last time's actions.** Open the previous retro and read its actions. Did they happen? If an action shows up three retros in a row, nobody has time to tackle it, and that's the first thing to talk about.

**Minutes 10 to 20: grouping.** The facilitator drags cards from the personal columns into the format's columns and clusters the ones that say the same thing. Each cluster gets a short title. Authors clarify when needed.

**Minutes 20 to 25: voting.** Everyone has three votes and says them out loud; the facilitator draws a small dot next to the cluster for each vote. With a team of six that's eighteen dots, easy to count at a glance.

**Minutes 25 to 40: discuss the top two or three.** For each one: what happened, why, what do we try differently? Keep asking "why" until you reach something the team can change.

**Minutes 40 to 45: actions.** Three at most. Each with an owner and a date. "Improve communication" stays vague. "Lucía builds a task handoff template before Friday" can be done and checked.

## Keep the actions from dying on the board

The board is for thinking. For getting things done, actions need to live where the team already looks every day. If you use [Track](/blog/ciclos-en-track), add each action as an issue in the cycle that's starting, with its owner and date. At the next retro, the "last time's actions" step is answered by checking whether those issues got closed.

If you also want a written record, Docs has a weekly retro template. Paste the top clusters and the actions there, and link the board.

## Sharing the result outside the team

Sometimes someone outside the team needs to see the retro: a partner, a client on a long project. In the editor, turn on the read-only link and send it. Whoever opens it sees the whole board without being able to edit, and the page isn't indexed by search engines. When it's no longer needed, turn it off and the link stops working.

If you'd rather send an image, the Excalidraw menu exports the board as PNG or SVG, or as an `.excalidraw` file.

## What it costs

Miro Starter costs [$8 per member per month billed annually](https://miro.com/pricing/), and the Free plan gives you [three editable boards](https://miro.com/pricing/). For a team running a retro every two weeks, plus its planning boards, that limit arrives quickly. In exchange, Miro has live editing, a timer, voting and thousands of templates, none of which Board has.

Board costs $0 on your own server, and zerosoft Cloud doesn't charge per seat. Each board holds up to 4 MB of content, which is plenty for lots of cards and a few screenshots.

## The summary on one card

- One format per retro, and rotate them: start/stop/continue, 4Ls, sailboat.
- A template with per-person zones, duplicated for each retro.
- Everyone writes beforehand, in their own zone. On a conflict: Reload.
- In the meeting only one person edits. 45 minutes, three votes each.
- Three actions at most, with an owner and a date, added to Track.
