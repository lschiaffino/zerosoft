---
title: "How Cal handles time zones: wall clocks, UTC and DST"
description: "What Cal stores in UTC, what it keeps as wall-clock time, how slots survive DST changes, and how emails and .ics invites reach the guest in their own time zone."
date: "2026-09-01"
author: "zerosoft"
tags: ["cal", "architecture", "timezones"]
---

Timezones are the part of a scheduling tool that looks trivial and isn't. "Is your 3pm my 3pm?" has a dozen wrong answers, and most of them only show up twice a year, when daylight saving time kicks in somewhere.

This post walks through how Cal handles it, based strictly on what the code does: `lib/calendar.ts`, `lib/ics.ts`, `lib/user-tz.ts` and friends. No timezone library, just `Intl` and two rules.

## The two rules

**1. Instants are stored in UTC.** A booking's `starts_at` and `ends_at` are written with `toISOString()`. Blocked slots, reminders' `send_at`, everything that is a *moment in time* is UTC.

**2. Intentions are stored as wall-clock time.** Your weekly availability is not stored in UTC. It's stored as "day of week + `09:00` + `17:00`", plus your account timezone as an IANA name like `America/New_York`. That's what you actually mean: "I work from 9 to 5 where I live", not "I work from 13:00 to 21:00 UTC".

Rule 2 is the one that makes DST a non-event. If we converted your availability to UTC when you saved it, every March and every November your working hours would silently shift by an hour. Instead, we convert at query time, for the specific date being asked about. On a summer Monday, 9:00 in New York is 13:00 UTC; on a winter Monday it's 14:00 UTC. Same rule, correct answer both times.

## Three timezones in play

There are three different timezones in Cal, and keeping them apart is half the job:

- **The host's timezone.** Set in Cal settings and validated as a real IANA zone (if `Intl.DateTimeFormat` rejects it, so does the API). New accounts start at UTC. We don't silently infer it, so your availability never moves because you travelled.
- **The guest's timezone.** The booking page reads it from the browser with `Intl.DateTimeFormat().resolvedOptions().timeZone`, and the guest can change it from a dropdown. It's saved on the booking.
- **The viewer's timezone.** Inside the app, a small client component writes your browser's zone to a `tz` cookie, so dashboards like "bookings this week" render in your time. Outside a request (cron jobs, tests), it falls back to UTC.

## Building slots across two calendars

Here's the interesting bit. A guest in Tokyo asks for slots on September 10. A host in Buenos Aires has availability Monday to Friday, 9:00–18:00. Tokyo is 12 hours ahead, so the guest's September 10 spans two of the host's days.

`getAvailableSlots` handles that like this:

1. Compute the guest's day as a UTC range: midnight on the 10th in Tokyo, plus 24 hours.
2. Walk the **host's** local days from one day before to one day after that range. Each step jumps to the next local midnight in the host's zone, computed fresh, so a 23- or 25-hour day doesn't throw it off.
3. For each host day, find the day of week *in the host's zone*, apply the matching availability rules, and convert each rule's start and end to UTC for that date.
4. Cut slots by the event's duration, drop those outside the guest's day, those inside the minimum notice, and those that collide (with buffers) with a busy range.
5. Sort and de-duplicate.

The guest's browser then formats each UTC instant in the guest's zone with `Intl`. The server never formats a slot for display; it hands out instants.

## Converting wall-clock to UTC without a library

The core helper is `localToUtc(date, time, tz)`: "what UTC instant is 09:00 on 2026-09-10 in `America/Argentina/Buenos_Aires`?" JavaScript has no built-in for that direction. `Intl` only goes the other way: given an instant, tell me the local time.

So we iterate. Start by pretending the wall-clock time *is* UTC. Ask `Intl` what local time that instant is in the target zone. The difference between what we wanted and what we got is the offset; shift by it and check again. It usually settles in one or two rounds; the loop is capped at five. Because the offset is measured at the actual instant, DST transitions are picked up automatically.

It's about fifteen lines, and it means zero dependencies and nothing to update when a country changes its DST rules: the runtime's timezone database handles that.

## A DST week, concretely

Hypothetical: a host in New York with 9:00–17:00 availability, a guest in Buenos Aires (no DST).

- Before the US switches to summer time, 9:00 in New York is 11:00 in Buenos Aires.
- After the switch, 9:00 in New York is 10:00 in Buenos Aires.

The guest sees the host's slots move one hour earlier. That's correct: the host still starts at 9 in their own life. A guest in Madrid would see the gap change twice, because the US and Europe switch on different weekends. Again, correct, and nothing in the database changed.

## Validating the booking

The client sends the chosen instant plus the guest's timezone. The server doesn't trust either blindly: `findOfferedSlot` re-runs the same slot computation for that guest's local day and only accepts a start that matches an offered slot (within a minute). Then the booking is saved with the UTC instant, the guest's IANA zone and the guest's locale (`en`, `es` or `pt`).

## Emails, reminders and .ics

Everything the guest receives is rendered in **their** timezone and **their** language. Confirmation, reschedule and cancellation emails format the time with `Intl.DateTimeFormat` using `en-US`, `es-AR` or `pt-BR`, in the booking's timezone, with the zone name printed next to it ("(America/Sao_Paulo)") so there's no ambiguity. The manage link points to the guest's locale too.

The 24-hour reminder is scheduled as a UTC instant (`start - 24h`) and sent by the cron at `/api/cron/tick`, which runs hourly, so it goes out somewhere between 24 and 23 hours before the meeting. Meetings booked less than 24 hours ahead don't get one; the confirmation just arrived.

The `.ics` attachment sidesteps the problem entirely: `DTSTART` and `DTEND` are written in UTC with a trailing `Z`, like `20260910T120000Z`. No `VTIMEZONE` block to get wrong. Gmail, Outlook and Apple Calendar each convert to whatever zone their user is in. The `UID` is stable per booking and `SEQUENCE` increases on every change, so a reschedule updates the existing event instead of creating a second one, and `METHOD:CANCEL` removes it.

Google Calendar sync follows the same idea: events are created with UTC times, and Google shows them in each person's zone.

## The honest list of edges

Things we know about and haven't fully solved:

- **The host email shows the guest's timezone.** It's labelled, so it's unambiguous, but the host has to do the conversion. If your Google Calendar is connected, the event in your calendar is in your time anyway.
- **The .ics description line is English.** The email around it is localized; the event title is whatever the host wrote; but the "Reschedule or cancel" line inside the `.ics` itself isn't translated yet.
- **A guest's DST-change day is treated as 24 hours.** On the one day a year that's 23 or 25 hours long in the guest's zone, a slot right at midnight can show up under the neighbouring date.
- **Availability rules inside a DST gap.** A rule that starts at a local time that doesn't exist (02:30 on spring-forward night) resolves to a nearby instant. Business hours rarely live there, but we haven't special-cased it.

None of these is hypothetical hand-waving; they fall straight out of the code above, which is the point. If you find another one, the code is open: [here's how to contribute](/blog/como-contribuir-a-zerosoftware).
