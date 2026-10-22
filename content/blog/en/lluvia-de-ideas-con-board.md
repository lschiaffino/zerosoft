---
title: "Team brainstorming: a 60-minute script with stickies, a timer and hidden votes"
description: "How to run an ideas session in Board: a well-built question, a silent writing round, grouping, dot voting and stickies that end up as issues in Track."
date: "2026-10-22"
author: "zerosoft"
tags: ["board", "miro", "workshops"]
---

Miro publishes a [guide to running a brainstorming session](https://miro.com/brainstorming/how-to-conduct-a-brainstorming-session/) built around its own canvas. A team of five needs a lot less than that: a clear question, a board, a clock and a way to decide which ideas move forward.

This is a version you can run in Board, the zerosoft whiteboard. Every step uses something Board does today, and the end has a section on what it does not do.

## The question matters more than the board

Idea sessions usually fail at the prompt. "Ideas to improve the product" produces forty cards nobody can compare. A good question has a subject, a verb and a limit:

- Weak: "Marketing ideas".
- Better: "How do we get 20 demo bookings in October without spending on ads?"
- Weak: "Onboarding improvements".
- Better: "What would we remove from a new hire's first day so they reach their first task within an hour?"

Post the question in the team chat before the meeting. If it does not fit on one line, it is two sessions.

## Set up the board

In the Board list, open **Start from a template** and pick **Brainstorm**. It brings a central topic in an ellipse and six sample ideas connected by lines. Replace the topic with your question.

Delete the six sample ideas. For this session a different layout works better: draw four or five empty rectangles with a title each, one per angle you want to cover ("channels", "content", "product", "partnerships"). They become grouping zones later. If the topic has no obvious angles, leave the board free and group afterwards.

Send the link to the participants. By default, any workspace member can open and edit the board. If you are inviting someone from outside, the access panel can create a guest link with edit rights, which you switch off when the session ends.

## Round 1: write in silence (10 minutes)

Open **Workshop**, pick **5 min** on the timer and press **Start**. Everyone sees the countdown on their screen; Board computes it from the server clock, so it does not depend on each machine's clock. Anyone who can edit the board can start the timer, and **+1 min** or **Pause** adjusts it without cutting the round.

For those five minutes nobody talks. Each person creates ideas with the **Stickies** tool:

1. Pick a color. One color per person or per angle works well, announced beforehand.
2. Add a sticky and write one idea with a verb. A sticky takes up to 500 characters, and shorter is better.
3. Add tags with `#` if you already know the angle (up to 8 per sticky).

Writing in silence stops the first idea spoken aloud from anchoring all the others, and gives quieter people the same room.

A useful variant: if someone arrives with a list already written in a note or a spreadsheet, they can use **Paste a list**. One sticky per line, up to 100 per paste, and words with `#` become tags. A line like `Monthly customer webinar #content` becomes a sticky with the tag `content`.

After the round, run a second two-minute one to improve someone else's idea: each person adds a sticky that develops or corrects another's. This is where ideas appear that nobody had alone.

## Round 2: group (10 minutes)

One person shares their screen and drags. They are the only one editing during this stretch, so nobody overwrites anybody.

Rules for grouping:

- Put together what solves the same thing, even if it is worded differently.
- If two stickies are identical, keep one and delete the other. The author should not mind: the idea is still there.
- Each group gets a title of three words at most.
- A sticky that fits nowhere stays apart. You look at those at the end.

The Stickies panel lists the board's tags and can select every sticky sharing one in a single step. If people used tags, grouping takes two minutes.

## Round 3: vote with hidden votes (10 minutes)

In **Workshop**, open a **dot voting**. You choose how many votes each person has, from 1 to 20. A reasonable rule is one third of the ideas left standing, with a minimum of three: with 18 stickies, six votes.

While voting is open, each person sees only their own votes, and the panel shows how many people have voted without saying for what. You vote with the **+** button on each sticky, and you can put more than one vote on the same one. When you **close and show results**, the totals per sticky appear, highest first.

Keeping votes hidden until the close changes the outcome: nobody votes for what is already winning or for what the most senior person picked. If the tie for third place is real, settle it by talking, not with a second vote.

## Close: from stickies to work (15 minutes)

Take the top two or three ideas and answer three questions for each: who owns it, what happens in the first week and how will we know it worked.

Then select those stickies, open the **Track** button in the toolbar and choose the project. Board creates one issue per sticky, with the idea's text and a link back to the board. A sticky that already has an issue is not duplicated, and the issue's status and assignee show under the sticky, so the board stays as a map of what moved. We covered this in the [action flow of the retro post](/blog/retro-en-una-pizarra); it works the same here.

Leave the board as it is. History keeps one version per hour for 30 days and restores it as a copy, in case someone cleans up too much.

## The script in a table

| Minutes | What happens | Tool |
|---|---|---|
| 0 to 5 | Read the question, hand out colors | Brainstorm template |
| 5 to 15 | Silent ideas and an improvement round | Workshop: timer 5 + 2 min, Stickies |
| 15 to 25 | Grouping | Tags, select by tag |
| 25 to 35 | Hidden vote | Workshop: dot vote |
| 35 to 50 | The top 2 or 3: owner, first week, success signal | Canvas comments |
| 50 to 60 | Issues in Track | Track button |

## What Board does not do yet

Board has no live co-editing with cursors: you do not see the other people move. If two people save at once, the changes merge element by element, and if one edited something the other deleted, the notice asks you to choose. The timer and the vote refresh by asking the server every few seconds, not over an open connection, so expect a delay of about 4 seconds. It does not group stickies with AI and has no mode that reveals ideas one at a time. For the silent round, the team rule replaces the tool.

## What it costs

Miro Starter costs [$8 per member per month billed annually](https://miro.com/pricing/), and the Free plan includes [three editable boards](https://miro.com/pricing/). It has what Board lacks: live cursors, AI grouping and thousands of templates.

Board costs $0 if you run it on your own server, and zerosoft Cloud does not charge for seats. For a team that runs one session a month and wants the ideas to end up in a Track project, it is enough.
