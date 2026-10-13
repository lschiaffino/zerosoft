---
title: "Round-robin scheduling in Cal: one link for the whole team"
description: "Share one booking link across a sales or support team, and see exactly how Cal picks the host for each meeting: cursor, pool order and conflicts."
date: "2026-07-18"
author: "zerosoft"
tags: ["cal", "scheduling", "teams"]
---

You have three people who can take a demo call. You don't want three booking links on your website, and you definitely don't want a human deciding who gets each lead. You want one link, and the meetings spread across the team.

That's round-robin. Cal does it, and since the code is open, we can do something most scheduling tools won't: show you exactly how the host gets picked. No black box, no "intelligent distribution" marketing copy. A cursor and a loop.

## Setting it up

Round-robin lives on the event type. You need a team first, because the host pool is made of team members.

1. Go to **Cal → Event types** and create (or open) the event type you want to share: say, "Product demo", 30 minutes.
2. In the **Hosts (round-robin)** section, tick the team members who should take these meetings. The form says it plainly: bookings rotate through the selected team members.
3. Set the weekly availability for the event type (more on why this matters below).
4. Ask every host to connect their own Google Calendar from **Cal → Settings**. This is per person, not per workspace, and it matters a lot.
5. Share the public link: `/book/<your-handle>/<slug>`.

That's it. If you leave the pool empty, the event type works like a normal one-person link: the owner hosts every meeting.

A pool can hold up to 50 hosts. That's a validation limit in the API, not a pricing tier.

## How a host gets picked

Here's what actually happens, in order, straight from `lib/calendar.ts`.

**1. Showing slots.** When a guest opens the booking page, Cal builds the candidate slots from the event type's weekly availability. For each slot, it checks every host in the pool. A slot is shown if **at least one** host is free for it. Free means the slot (plus any buffers) doesn't overlap that host's:

- confirmed bookings in **any** event type (not just this one),
- blocked slots,
- busy times from their connected Google Calendar.

So the page shows the union of everyone's free time. With three hosts, the guest sees a lot more options than with one.

**2. Booking.** When the guest confirms, Cal looks at a persistent counter on the event type, `rr_cursor`. It walks the pool starting at the cursor position, wrapping around, and assigns the meeting to the **first host who is free** for that exact slot.

**3. Advancing.** After the booking is saved, the cursor moves forward by one.

The pool order is the order of your team members list, filtered to the ones you ticked. It's not alphabetical by accident and it's not random.

## What that means in practice

Say your pool is Ana, Bruno and Carla, the cursor is at Ana, and everybody is free all week. Bookings go Ana, Bruno, Carla, Ana, Bruno… Textbook rotation.

Now the real world. A guest picks Tuesday at 10:00, and Ana has a dentist appointment in her Google Calendar. Cal starts at Ana, sees she's busy, moves to Bruno, he's free, Bruno gets it. Cursor moves one step, to Bruno. Next booking, if Bruno is free, he gets that one too.

Read that again, because it's the honest part: **the cursor advances one position per booking, not to whoever was picked.** It's strict rotation of the starting point, not a fairness balancer. There are no weights, no "least recently booked", no "fewest meetings this week". Over many bookings with hosts who are mostly available, it evens out. If one person is constantly busy, the people after them in the list will absorb more meetings.

If you need weighted distribution or priority hosts, Cal doesn't do that today. Calendly and others offer more knobs here.

## Conflicts and race conditions

Two guests click the same 10:00 slot at the same second. What happens?

Before saving, Cal re-checks that the requested time is still an offered slot. The bookings table also has a unique index on `(host_user_id, starts_at)` for confirmed bookings. If two requests race to give the same host the same start time, the database rejects the second one and the guest gets `slot_unavailable` (HTTP 409) and picks another time. No double-booked host.

The code comment is upfront about one simplification: picking the host and advancing the cursor isn't atomic, so two simultaneous bookings for *different* times can occasionally start from the same cursor position and land on the same host. Nobody gets double-booked; the rotation just skips a beat.

## Reschedules, emails and calendars

When a guest reschedules from their manage link, Cal runs the same pick again for the new time, starting from the current cursor. The meeting may move to a different host if the original one is busy at the new time. Reschedules don't advance the cursor.

If the host changes, Cal deletes the event from the old host's Google Calendar and creates it in the new host's. Otherwise it just moves the existing event.

Everything downstream follows the **assigned** host, not the event type owner:

- the host notification email goes to the assigned host,
- the Google Calendar event (with a Meet link, if the event type has no other location) is created in the assigned host's calendar,
- the `booking.created` webhook payload includes `hostUserId`.

## Gotchas worth knowing

**Availability is per event type, not per host.** The weekly hours you set on the event type (in the owner's timezone) apply to the whole pool. Cal doesn't read each host's personal working hours. If Bruno only works mornings, he needs to block his afternoons (via blocked slots or his Google Calendar), or he'll get afternoon meetings.

**Connect every calendar.** A host without Google Calendar connected looks free to Cal whenever they don't have a Cal booking or a blocked slot. That's the most common way round-robin goes wrong: not the algorithm, the missing data.

**Changing the pool resets an out-of-range cursor.** If you remove hosts and the cursor points past the end of the new list, it goes back to zero. Not dramatic, but don't expect perfect continuity after editing the pool.

**There's no collective mode.** Round-robin assigns *one* host per meeting. Meetings that need several people from the team at once aren't supported yet.

## Pair it with routing

Round-robin answers "who takes this meeting". It doesn't answer "which meeting should this lead book". If enterprise leads should go to one pool and small accounts to another, put a routing form in front of both event types. We cover that in [routing forms in Cal](/blog/formularios-de-ruteo-en-cal).

And if you want to wire bookings into your own systems, `GET /api/v1/calendar/bookings` returns them with the assigned host, and `booking.*` webhooks fire on every change. The details are in the [API docs](/docs).

Round-robin isn't magic. It's a loop over a list with a pointer. The difference is that here you can read the loop.
