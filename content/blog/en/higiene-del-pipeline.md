---
title: "Pipeline hygiene for small teams: eight rules that keep your CRM honest"
description: "A practical playbook for keeping a sales pipeline clean in a small team: how to design stages, when to use multiple pipelines, what to do with stale deals and how tasks keep everything moving."
date: "2026-08-22"
author: "Zerosoftware"
tags: ["crm", "sales", "playbook"]
---

Every CRM starts clean. Six months later the board has 140 open deals, half of them with a close date from last spring, and the "weighted forecast" is a number nobody would bet lunch on. Nobody decided to make a mess. It just accumulated, one skipped update at a time.

Pipeline hygiene is not a tool problem. It's a handful of rules the team agrees on, plus a CRM that makes breaking them visible. Here are the eight we'd adopt if we were a five-person sales team starting Monday, with how each one maps to what Zerosoft CRM actually does.

## 1. One pipeline per sales motion, not per person

Zerosoft supports multiple pipelines, each with its own stages, and switching between them on the deals board is one dropdown. The temptation is to make one per salesperson, per product or per region. Don't.

A pipeline should represent a **different buying process**: new business vs. renewals, or self-serve upgrades vs. enterprise deals. If two pipelines would have the same stages, they should be one pipeline, filtered by owner or source.

A useful test: if you can't explain in one sentence why a deal goes in pipeline A and not B, you have one pipeline too many.

## 2. Stages are things the buyer did, not things you hope

"Interested" is a feeling. "Demo held" is an event. Name stages after something verifiable that happened:

- Qualified
- Demo held
- Proposal sent
- Negotiation
- Closed won
- Closed lost

Five to seven stages is plenty for a small team. Each stage in Zerosoft has a **probability %**, and the board uses it to show open deals, open amount and a weighted forecast at the top. Set those probabilities from your own history if you have it, and revise them once a quarter. One stage gets flagged as **Closed won** and one as **Closed lost**; that's what feeds the won/lost reports and the win rate.

Stages can be reordered by drag and drop in settings. Deleting a stage or a pipeline that still has deals is blocked, and deleting them at all is admin-only, so nobody "cleans up" by accident.

## 3. Every open deal has a next task

This is the rule that does most of the work. If a deal has no next step with a date, it isn't a deal; it's a hope with an amount on it.

Zerosoft shows the next open task at the top of each deal's page, with a button to complete it right there. The tasks page (`/app/crm/tasks`) groups everything into Overdue, Today and Upcoming, filterable by owner. Make it a team habit: when you complete a task on a deal, you create the next one before closing the tab.

If you'd rather not rely on habit, [workflows](/blog/workflows-crm-tareas-de-seguimiento) can create the follow-up automatically when a deal reaches a stage.

## 4. Every open deal has an amount and a close date

A forecast is only as good as the deals that feed it. A deal without an amount is invisible in the weighted forecast; a deal without a close date is invisible in time.

Honest caveat: Zerosoft doesn't have required fields yet. You can't force a value at creation. So make it a rule and make violations easy to find:

- In the deals **table** view, sort by close date. Deals without a date sink to the bottom, where you can see them in bulk.
- Sort by amount ascending to see the zeros first.
- Filters and sort live in the page URL, so **bookmark** each one and checking it next week takes one click.

## 5. A past close date on an open deal is a lie

If the close date was last month and the deal is still open, either it closed and nobody updated it, or the date was fiction. Both need fixing.

In the deals table, set the advanced filters: **Close date before** (today's date), **Stage is not** Closed won, **Stage is not** Closed lost. Filters combine with AND; bookmark the result. One limitation: dates in filters are absolute, not relative, so update the date when you run the check. For every deal that shows up, do one of three things: move the date with a reason in a note, move the stage, or close it.

## 6. Fourteen days without activity means you decide today

On the kanban board, every open deal with no activity logged in more than 14 days (or, if it has no activities at all, no edits) gets a visible "No activity in N days" badge. Hover a card to see how old the deal is; the table view has an Age column. Those badges are not decoration. They're the list of things to decide this week.

For each flagged deal, pick one:

- **Log what happened**: a call, an email, a meeting, a note. If something happened and nobody wrote it down, write it down.
- **Advance it**: if the buyer moved, move the stage.
- **Close it lost**: if the buyer went quiet and two follow-ups got nothing, stop pretending.

"Leave it and see" is not on the list. That's how you get 140 open deals.

## 7. Close lost fast, and always say why

Teams avoid closing deals as lost because it feels like admitting defeat. The result is a pipeline inflated with zombies that make the forecast useless.

In Zerosoft, closing a deal as lost asks for a reason: Price, Timing, Competitor, No budget, Went silent, Other, or your own text. That reason is stored on the deal and shows up in the **Lost reasons** chart in reports. After a quarter, that chart tells you more about your product and pricing than most surveys. "Went silent" at the top? Your qualification is too loose. "Price"? Either your pricing or your targeting is off.

A lost deal isn't gone, either. It stays in the record, with its history, and a 90-day follow-up task can bring it back.

## 8. Custom fields: few, and only if someone uses them

Custom fields on deals are useful: deal type, contract length, competitor in play. They're also the fastest way to clutter the deal form until nobody fills anything in.

Rule of thumb: don't add a field unless a report, a filter or a decision depends on it. If nobody has filtered by it in two months, it's furniture.

## Making it stick

Rules don't survive without a ritual. Put 30 minutes on the calendar every week, same day, whole team, and walk the board: badges first, past close dates second, deals without a next task third. When a deal's stage or amount changes, Zerosoft keeps a property history on the record, so you can see what moved since last week and who moved it.

The goal isn't a pretty board. It's a board where every open card means "someone is working this, and here's when we'll know". When that's true, the forecast stops being a guess and starts being a tool.
