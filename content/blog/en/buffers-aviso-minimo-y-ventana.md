---
title: "Buffers, minimum notice and booking windows in Cal"
description: "How weekly availability, buffers, minimum notice, booking windows and blocked slots work in Cal, and the defaults we suggest for each."
date: "2026-08-17"
author: "zerosoft"
tags: ["cal", "scheduling", "productivity"]
---

Most scheduling pain isn't caused by the tool. It's caused by a booking link that says "yes" to things you'd never agree to in person: a call that starts the minute the previous one ends, a meeting booked 20 minutes from now, a demo four months out that nobody will remember.

Every one of those has a setting. Here's what each rule does in Cal, how it actually works under the hood, and the defaults we'd suggest. Ten minutes of setup saves a lot of awkward rescheduling.

## Step zero: set your timezone

Before anything else: **Cal → Settings → Timezone.** A new Cal account starts in **UTC**. Cal doesn't guess your timezone from the browser for this setting, because your availability shouldn't silently change when you open your laptop in another country.

Why it matters: your weekly hours are interpreted in this timezone. If you set "9:00 to 17:00" and leave the timezone at UTC while you live in São Paulo, you'll be offering slots from 6:00 to 14:00 your time. Guests always see slots in *their* own timezone, so nobody will notice until someone books you at 6:30 in the morning.

Set it once. Then check your public page in a private window to confirm the hours look right.

## Weekly availability

Availability is set **per event type**, as rules of "day of week + start time + end time". You can add several rules for the same day, which is how you carve out lunch: Monday 9:00–12:30 and Monday 14:00–18:00.

Per event type is deliberate. Your 15-minute "quick question" slot can be open all day, while the 60-minute workshop only runs on Tuesday and Thursday afternoons. One person, different doors.

A detail people miss: **slots are cut by the event's duration, starting from the beginning of each window.** A 30-minute event in a 9:00–12:00 window offers 9:00, 9:30, 10:00… A 45-minute event offers 9:00, 9:45, 10:30, 11:15, and stops there, because 12:00 isn't enough room for another one. If you want 45-minute meetings on round hours, shape the windows accordingly, or add a buffer.

## Buffers

Buffers are padding before and after a meeting: **Buffer before (min)** and **Buffer after (min)**.

Here's how Cal uses them. For every candidate slot, it stretches the slot by the buffers (10:00–10:30 with a 10-minute after buffer becomes 10:00–10:40), and checks that stretched range against everything you're busy with: other Cal bookings (in any event type), blocked slots, and your Google Calendar if it's connected. If anything overlaps, the slot disappears.

Why you want them:

- **Calls run long.** A 30-minute call that runs 35 minutes shouldn't make you late for the next one.
- **You need to write things down.** Notes, a CRM update, a follow-up email. That's the actual work.
- **Context switching is expensive.** A 5–10 minute buffer is the cheapest productivity hack there is.

One subtlety, straight from the code: **Cal pads the meeting being booked, not the things already on your calendar.** Existing bookings and Google events are checked as they are. So if you only set an *after* buffer, a 10:00–10:30 call protects the time after itself only if the next meeting already exists when it's booked. If someone books 10:00 first and someone else comes along for 10:30 later, the 10:30 slot's own after buffer doesn't look backwards, and you're back-to-back.

The fix is simple: **if you want a guaranteed gap between any two meetings, set the same value before and after.** Then whichever meeting is booked second carries the gap on the side that touches the first one. Keep in mind this also thins out your slots: with 30-minute slots and 10 minutes on both sides, booking 10:00 hides 10:30, and the next free option is 11:00.

Suggested: 10 minutes before and after for sales and support calls; more on the before side for meetings that need prep, like interviews (read the CV again) or demos (load the right data).

## Minimum notice

**Min. notice (hours)** stops people from booking a meeting that starts too soon. With 4 hours of notice, at 10:00 the earliest bookable slot is 14:00.

It's a straight "now plus N hours" calculation, so it doesn't care about nights or weekends. If you set 12 hours, at 20:00 on Friday someone can still book Saturday 8:00, if Saturday is in your availability. If you don't work weekends, make sure your weekly rules say so.

Why it matters: a meeting that appears on your calendar 15 minutes before it starts is a meeting you'll probably miss or show up to unprepared. Suggested: 2–4 hours for internal-ish calls, 12–24 hours for demos and interviews.

## Booking window

**Max. future (days)** caps how far ahead people can book. Default: 30 days. It's counted from today in the guest's timezone.

Why limit it? Because meetings booked far in the future have higher no-show rates and collide with plans you haven't made yet: a vacation, a conference, a product launch. Keeping the window at 2–4 weeks means your calendar reflects reality. Recruiting and sales demos usually do fine at 14–21 days. Office hours or onboarding sessions might want 60.

## Blocked slots

Blocked slots are one-off chunks of time you're unavailable: a doctor's appointment, a half-day offsite, a week of vacation. You add them from the Cal overview page, with a start, an end and an optional reason.

Unlike weekly availability, blocked slots belong to **you**, not to an event type. They remove those hours from every booking page you have, including round-robin pools you're part of.

If your Google Calendar is connected, you often don't need them: events in your primary Google Calendar already block slots, Cal checks your free/busy before showing times. Blocked slots are for the stuff you don't put in your calendar, or for when you'd rather not connect one at all.

## Event type rules vs account defaults

You'll find buffers, minimum notice and the booking window in two places:

- **Cal → Settings → Defaults for all event types**,
- each event type's **Booking rules**.

When an event type has its own value, that value wins. When it doesn't, Cal falls back to the account default. In practice, event types created from the editor save their own booking rules, so **treat the event type's rules as the source of truth** and check them on each one. The account defaults matter most for event types created through the API without booking rules.

## Two more tools worth knowing

**Single-use links.** Mark an event type as single-use and the link works for exactly one booking. After that, the page says it's already been used. Great for "here's a link for *you*" situations, like a candidate interview or a VIP.

**Your calendar is part of your availability.** Every rule above only works as well as the data behind it. If you're on a team using [round-robin](/blog/round-robin-con-cal), a host without a connected calendar looks free whenever Cal doesn't know otherwise.

## A starting configuration

If you want something to copy, here's a sensible default for a hypothetical solo consultant:

- Timezone: your real one (not UTC).
- Weekly availability: Monday to Thursday, 9:30–12:30 and 14:00–17:30. Fridays off.
- Buffers: 10 minutes before and 10 after.
- Minimum notice: 12 hours.
- Booking window: 21 days.
- Google Calendar connected, blocked slots for anything off-calendar.

None of this is advanced. It's hygiene. The kind you only notice when it's missing, usually at 6:30 in the morning, on a call you didn't know you had.
