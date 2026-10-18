---
title: "Calendly at $12 per user: what a booking costs to serve"
description: "A scheduling tool is a public availability page and a form that writes to your calendar. What Calendly charges for it, what a booking costs to run, and what Cal does instead."
date: "2026-06-18"
author: "zerosoft"
tags: ["cal", "scheduling", "saas"]
---

Technically, Calendly is two things: a public page with your availability and a form that writes an event into your calendar. The Standard plan costs $12 per user per month, or $10 billed annually.

The product is well made. The question is the price. A booking is a database row, two Google Calendar API calls and a confirmation email. That costs a fraction of a cent.

## What a team pays

- A 10-person sales team: $120 a month.
- $1,440 a year.
- $7,200 over five years.

The free plan has one event type, one calendar connection and no automated reminders. Most teams outgrow it around the time they start depending on it.

## How the price was set

The price comes from perceived value ("one extra meeting a month pays for it"), not from cost. That's how most SaaS is priced: by what the buyer can afford.

## What Cal does

**Cal** is the scheduling app in zerosoft. Today it has:

- **Booking pages** with weekly availability per event type, shown in the guest's timezone.
- **Google Calendar sync:** busy times block slots, and bookings land in your calendar with a Meet link.
- **Buffers, minimum notice and a booking window,** plus blocked slots.
- **Round-robin** across a team and **routing forms** that send each visitor to the right event type.
- **Emails with .ics invites,** a 24-hour reminder, and guest cancel and reschedule links.
- **Embeds** (inline or popup), a REST API and signed webhooks.

What it doesn't have yet: Outlook or iCloud calendars and group events. Stripe payments and reusable schedules are already there. The full list is in [Cal vs Calendly](/blog/zerosoft-cal-vs-calendly).

Self-hosting Cal costs $0. On zerosoft Cloud you get a free tier, then pay per booking and email beyond it. Seats are free.
