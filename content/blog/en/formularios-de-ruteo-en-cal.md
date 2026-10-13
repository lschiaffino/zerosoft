---
title: "Routing forms in Cal: send each lead to the right meeting"
description: "A few questions before the calendar, and each visitor lands on the right event type. How to build routing forms in Cal, how rules are evaluated and where the limits are."
date: "2026-08-03"
author: "zerosoft"
tags: ["cal", "scheduling", "sales"]
---

A single booking link for everyone sounds simple until your best senior rep spends Tuesday afternoon on a call with a student who wanted a discount. Or your enterprise prospect lands on a 15-minute "quick chat" slot with a junior.

The fix is old and boring: ask a couple of questions *before* showing the calendar, then send people to the right place. Cal calls these **routing forms**. Here's how to build one, and exactly how Cal decides where each visitor goes.

## The building blocks

A routing form has three parts:

- **Questions.** The fields the visitor fills in. Three types: **Text**, **Select** (a dropdown with up to 50 options) and **Yes / No**. Each question has a label (what people see), a key (what rules refer to, lowercase like `company_size`) and can be marked required.
- **Rules.** Each rule says: *if question X*. **is**, **is not**, **contains**, or **is answered**: *value Y, route to event type Z*.
- **A default event type.** Where people go if no rule matches.

The form gets its own public URL, `/r/<your-handle>/<slug>`, which you share instead of a booking link. When the visitor submits, Cal evaluates the rules and redirects them to `/book/<your-handle>/<event-slug>` for the matching event type.

## Building one, step by step

Let's do a hypothetical: a 6-person B2B agency that sells website projects and also gets a steady stream of people asking for support on existing sites.

**1. Create the destination event types first.** Routing forms point to event types, so you need them in place. Say:

- `discovery-call`: 45 min, with the two founders in a round-robin pool,
- `intro-call`: 20 min, with a junior account manager,
- `support-triage`: 15 min, with whoever handles support.

**2. Create the form.** Go to **Cal → Routing forms → New routing form**. Give it a title and a slug, like `talk-to-us`.

**3. Add questions.**

- `name`: Text, required
- `email`: Text, required
- `need`: Select: *New website*, *Redesign*, *Support for an existing site*
- `budget`: Select: *Under 5k*, *5k–20k*, *Over 20k*

**4. Add rules, in order.**

1. `need` **is** *Support for an existing site* → `support-triage`
2. `budget` **is** *Over 20k* → `discovery-call`
3. `budget` **is** *5k–20k* → `discovery-call`

**5. Set the default** to `intro-call`.

Now someone with an existing site always goes to support, no matter the budget. Bigger projects go to the founders. Everyone else gets the 20-minute intro.

## How rules are actually evaluated

This is the part most docs hand-wave. Here's what `lib/calendar-routing.ts` does:

- **Rules run in order, top to bottom. The first match wins.** Later rules aren't even looked at. That's why the support rule goes first in the example: order is your priority system.
- **Comparisons are case-insensitive and trimmed.** "Over 20K " matches "over 20k". Useful for text fields where people type whatever they want.
- **`contains`** is a substring check, also case-insensitive. Handy for text questions: `company` contains `university`.
- **`is answered`** matches when the answer is non-empty and isn't something that means no: `false`, `0`, `no` or blank don't count. On a Yes / No question, it's effectively "is yes".
- **Missing answers never match `is not`.** If someone skipped an optional question, `budget is not Under 5k` will *not* fire. A rule can't compare against nothing, so it's skipped. This catches people by surprise, so design around it: make the question required, or route on positive conditions.
- **Inactive destinations are skipped.** If a rule points to an event type you've deactivated or deleted, Cal moves on to the next rule instead of sending the visitor to a dead page. The default gets the same treatment.
- **No route, no redirect.** If nothing matches and there's no active default, the visitor sees "No booking page matches your answers." Always set a default.

Required questions are validated on the server too, not just in the browser.

## Things that make it work better

**Name your keys `name` and `email`.** If your form has questions with exactly those keys, Cal passes the answers along as `?name=…&email=…` to the booking page, so the visitor doesn't type them twice. Other answers aren't carried over to the booking today. If you need them on the booking itself, add them as custom questions on the event type too.

**Combine with round-robin.** A rule picks the *event type*; the event type's host pool picks the *person*. Routing plus [round-robin](/blog/round-robin-con-cal) is how you get "enterprise leads rotate between the two senior reps, everyone else rotates among the rest".

**Keep rule lists short.** Three to six rules covers most real cases. If you have twenty, you probably need two forms.

**Test it as a visitor.** Open the public URL in a private window and walk each branch. There's no rule simulator in the UI, so this is your test suite.

## The API side

The public form is backed by a small API you can call from your own frontend if you'd rather build a custom form:

```bash
# Form definition (questions, types, options — no routing targets exposed)
curl https://zerosoft.ai/api/calendar/routing/<form-id>/route

# Evaluate answers
curl -X POST https://zerosoft.ai/api/calendar/routing/<form-id>/route \
  -H "Content-Type: application/json" \
  -d '{"answers": {"name": "Ana", "email": "ana@example.com", "need": "Redesign", "budget": "Over 20k"}}'
# → {"eventTypeSlug": "discovery-call", "bookPath": "/book/your-handle/discovery-call"}
```

The `GET` deliberately doesn't reveal where each rule sends people. Both endpoints are rate-limited per IP.

## What routing forms don't do (yet)

Being straight about the limits:

- **Rules have one condition each.** No AND/OR groups. You can approximate AND by ordering rules carefully, but complex logic gets awkward.
- **Destinations are your own event types only.** You can't route to an external URL or to another person's event type.
- **No CRM lookup.** Calendly's paid tiers can route based on data in your CRM, like "existing customer goes to their account owner". Cal routes only on what the visitor typed.
- **No analytics on the form itself.** You'll see the bookings, not how many people filled the form and bounced.

For a small team that just wants the right people on the right calls, that's usually enough. For a revenue team with complex territory rules, be honest with yourself about whether one-condition rules will hold up.
