---
title: "Sales follow-up: a five-touch sequence that stops on its own"
description: "A two-week follow-up cadence with emails, a task and business-day waits, the copy to paste, and how to set it up with sequences in zerosoft CRM."
date: "2026-10-18"
author: "zerosoft"
tags: ["crm", "sales", "email", "templates"]
---

Follow-ups fail in two ways. First: nobody sends them, because the reminder lived in someone's head. Second, and more expensive: they go out anyway after the contact already replied or booked, and the third "did you get a chance to look?" lands on someone who said yes yesterday.

HubSpot has a popular page with [16 sales follow-up email templates](https://www.hubspot.com/sales/sales-follow-up-email), sorted by situation: after a meeting, after an event, after several attempts. They work as inspiration for a single email. What they don't give you is the full cadence: how many touches, how long to wait and, above all, when to stop. This post builds that: a two-week sequence with copy and the setup in zerosoft CRM.

## What a sequence does in the CRM

Just enough for the choices below to make sense:

- **Three step types:** email (from a template or written in place), task, and a wait of N days.
- **Same thread by default.** Each email goes out as a reply in the first email's thread, with "Re:" and the right headers. You can mark a step to start a new thread.
- **Business days and a send window.** A sequence has a time zone, a window (say, 9 to 5) and an option to skip weekends. An email due at 10 p.m. goes out at 9 a.m. on the next business day.
- **Automatic exits.** The enrollment stops if the contact replies (detected by the Gmail sync), books a meeting in Cal or unsubscribes with the footer link. That's what prevents the second failure above.
- **Variables with fallbacks.** `{{contact.first_name | there}}` inserts the first name or, if it's missing, "there". Company, job title, deal name, owner details and custom fields are available too.

Two operational details. Steps run from a cron that ticks every hour, so an email goes out within the hour it's due. And emails are sent from the Gmail account of whoever enrolls the contact: you need to connect Gmail, and until Google finishes verifying the app only test users can connect it.

## The cadence: five touches in two weeks

| Business day | Step | Goal |
|---|---|---|
| 0 | Email 1 | Context and one question |
| 2 | Email 2, same thread | Something useful, no new ask |
| 5 | Task: call or LinkedIn message | Switch channels |
| 7 | Email 3, same thread | Another angle on the problem |
| 12 | Email 4, same thread | Close: should I keep going? |

In the editor it reads: email, wait 2, email, wait 3, task, wait 2, email, wait 5, email. One detail: the task step creates the task for the owner and the sequence moves straight on to the next step. That's why a wait follows the task; otherwise email 3 would go out the same minute.

Why five touches? No universal reason. HubSpot's page repeats that most sales need at least five follow-ups, but it doesn't link the study, so we won't use that number as an argument. Start with five and let your own stats decide (see below).

## The copy

Written for B2B; adapt it to your product. One rule for all of them: at most one ask per email.

**Email 1. Subject: `{{contact.company}} and [topic]`**

> Hi {{contact.first_name | there}}, I saw that [specific fact: you filled in the pricing form, you're hiring for sales, you use X]. Teams like yours tend to get stuck on [specific problem]. Is that happening to you? If so, I can show you in ten minutes how we handle it.
> {{owner.first_name}}

**Email 2 (same thread)**

> Here's [specific resource: a template, a cost comparison, a case with numbers]. It's useful even if we never talk. If it helps, the question above still stands.

**Task: "Call or message {{contact.full_name}} on LinkedIn"**

In the task notes, leave a two-line script: who you are and the same question from email 1. A different channel doesn't call for a different message.

**Email 3 (same thread)**

> Another way to look at it: [the cost of the problem, with a number the contact can check]. If it's not a priority this quarter, tell me and I'll write again later.

**Email 4 (same thread)**

> I don't want to clutter your inbox. If now isn't the time, reply "not now" and I'll close this out. If someone else at {{contact.company}} handles this, could you point me to them?

Three things that go in none of them: "just following up", a fake "Re:" on an email that isn't a reply, and a heavy attachment on the first touch.

## Who to enroll, and from where

A sequence is for people who showed some intent or fit very well. The ways in:

- **From the contact page, or in bulk** from the list with the action bar. Contacts already enrolled, unsubscribed or without an email are skipped, and the CRM tells you how many.
- **From a form:** each submission can enroll the contact in a sequence.
- **From a workflow:** for example, when the lead score rises past 30. We build those rules in [rule-based lead scoring](/blog/lead-scoring-con-reglas).
- **From Flow or the API**, when the signal comes from another system.

## Read the per-step stats

The sequence shows sent, opened, clicked and replied for each step. After 30 or 40 enrollments, ask three questions:

1. **Which step gets the most replies?** If it's email 4, the earlier ones ask too much or say too little. Rewrite email 2 before adding a sixth touch.
2. **How many leave before the end?** The enrollments list shows the reason for each exit: replied, booked a meeting, unsubscribed. Lots of unsubscribes at email 3 usually point to a badly chosen list. Check who you enrolled before touching the copy.
3. **Do clicks turn into replies?** If people click the resource in email 2 and nobody replies, the closing question doesn't connect with what they read.

Take opens with a grain of salt: Apple Mail preloads images and records opens that never happened.

## What it doesn't do yet

- Gmail only. No Outlook.
- No A/B tests of subject or body inside a sequence. To compare, duplicate the sequence and split enrollments by hand.
- Steps run at one-hour granularity.
- The LinkedIn task is a task: we don't automate messages on other platforms.

Sequences run in zerosoft CRM for $0 on your own server, or on zerosoft Cloud, where you pay for emails sent and not per seat.
