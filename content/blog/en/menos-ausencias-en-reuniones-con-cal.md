---
title: "Fewer no-shows: reminders and booking rules in Cal"
description: "Why people miss meetings they booked themselves, and how to cut it with Cal: a confirmation with an .ics file, a reschedule link, a reminder sequence with templates, booking rules and the No-show mark."
date: "2026-10-18"
author: "zerosoft"
tags: ["cal", "meetings", "reminders"]
---

Someone picks a time on your booking page, fills in the form, gets the confirmation. The time comes and they don't show. Most of the time there's no bad faith. Four causes keep coming back:

1. **They forgot.** They booked two weeks ago and the meeting never made it onto their calendar.
2. **Something came up and they didn't know how to tell you.** Cancelling felt more awkward than not showing.
3. **They booked with little commitment.** Two clicks, no effort, no cost to skipping.
4. **They booked at the wrong distance.** Too far out to remember, or so soon they couldn't get organized.

Each cause has a different fix. This post goes through them in order, with what Cal does for each, templates to copy, and what we don't do yet.

## 1. Get the meeting onto their calendar

A confirmation email sitting in the inbox gets forgotten. A calendar event rings on its own.

Cal sends the confirmation in the language the person booked in, with an `.ics` file attached: one tap and it's in Google Calendar, Outlook or the phone's calendar. If you've connected Google Calendar in settings, Cal also creates the event on your calendar with the person as a guest (plus the Meet link, if the location is Google Meet), so it reaches them through Google as well.

When a meeting is rescheduled, the `.ics` updates the same event instead of creating a new one. Nobody ends up with two events for the same call.

## 2. Make cancelling easier than not showing

A cancellation with notice is good news: the slot is free again for someone else. A no-show is an hour lost for both of you.

Every confirmation includes a **Reschedule or cancel** link. It opens a page where the person picks another time or cancels, with no account and no password. On your side, under **Bookings**, you can reschedule too: pick the new time and Cal sends the person the updated invitation.

That link is the most underrated piece. Put it in every reminder as well with the `{{manage}}` variable, shown below.

## 3. A reminder sequence

With nothing configured, every event type sends the guest a reminder 24 hours before. For many meetings that's enough. For the ones that matter, build a sequence in the event type's **Reminders** section:

- Up to 10 steps per event type.
- Each step goes to the **guest** or the **host**, a number of minutes, hours or days **before** or **after** the start (up to 30 days).
- Its own subject and message, with variables: `{{guest.name}}`, `{{guest.email}}`, `{{host.name}}`, `{{event.title}}`, `{{start}}`, `{{link}}` and `{{manage}}`.
- `{{start}}` is rendered in the recipient's time zone. `{{link}}` is the video call link or the location.

Adding steps replaces the 24-hour reminder. A practical detail: reminders go out from a job that runs every hour, so they can arrive up to an hour late. A "15 minutes before" step makes no sense; use 2 or 3 hours.

### Templates to copy

A three-step sequence that works for demos, consultations and interviews:

**Step 1: guest, 2 days before**

> Subject: {{event.title}} on {{start}}
>
> Hi {{guest.name}}, just confirming we're meeting on {{start}}.
>
> If there's anything you'd like us to prepare, reply to this email.
>
> Plans changed? Pick another time here: {{manage}}

**Step 2: guest, 3 hours before**

> Subject: Today: {{event.title}}
>
> Hi {{guest.name}}, see you today at {{start}}.
>
> Link to join: {{link}}
>
> Can't make it? Let me know here and we'll move it: {{manage}}

**Step 3: host, 1 day before**

> Subject: Tomorrow: {{event.title}} with {{guest.name}}
>
> {{guest.name}} ({{guest.email}}) has a meeting on {{start}}. Check their answers under Bookings before the call.

The third one looks minor and isn't: plenty of failed meetings come from a host who shows up late or unprepared.

## 4. Rules that filter out weak bookings

Some no-shows are prevented before the booking exists. The rules live on each event type (with defaults under **Settings**):

- **Minimum notice.** If someone books for 20 minutes from now, they probably won't get organized in time. 2 to 4 hours is a good floor for sales calls. More detail in the post on [buffers, minimum notice and booking window](/blog/buffers-aviso-minimo-y-ventana).
- **Bookable up to.** A booking 60 days out is little more than a vague promise. For a demo, 14 to 21 days is usually enough.
- **Custom questions.** Name and email are always required. A question like "What would you like to see on the call?" makes booking take a minute, and people who write an answer tend to show up.
- **Single-use link.** For sending to one specific person: the link stops working after the first booking, so it doesn't get forwarded to a group.
- **Payment at booking.** If you run paid sessions, connect your Stripe account under **Settings › Payments** and set a price on the event type. The booking sits as **Awaiting payment** and is confirmed once the person pays through Stripe Checkout; if they don't pay within 35 minutes, the slot is released. Paying up front is the strongest commitment filter there is.

## 5. Measure it: the No-show mark

What isn't recorded doesn't improve. Under **Bookings**, every meeting that has already started has a **No-show** option. Cal won't let you mark it before the start, because marking it frees the slot.

The mark has a useful side effect on the sequence: "after" steps only go out for confirmed bookings. If you have a "guest, 1 hour after" step with a "thanks for the chat, here's the summary" message, marking No-show keeps it from reaching someone who never came.

To get your monthly no-show rate, use the API with a key that has the `cal:read` scope:

```bash
curl -s "https://zerosoft.ai/api/v1/calendar/bookings?status=no_show&from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z" \
  -H "Authorization: Bearer $ZEROSOFT_KEY" | jq '.bookings | length'
```

Swap `status=no_show` for `status=confirmed` and you have the denominator. That's enough to see whether last week's change worked.

## What Cal doesn't do yet

So you can compare with what you use today:

- **SMS or WhatsApp.** Reminders are email only.
- **Sending from your Gmail.** On zerosoft Cloud, emails come from a zerosoft address, with the event type's color and logo. When self-hosting you choose the sender with `EMAIL_FROM`.
- **An automatic email asking no-shows to rebook.** Today the No-show mark stops later steps, but it doesn't trigger one of its own. Until then, send your booking link by hand from the booking detail.

For comparison, Calendly's configurable reminders live in Workflows, which [its own guide](https://calendly.com/blog/guide-calendly-reminders) says are available on paid plans. In Cal the sequence doesn't depend on the plan: it's on zerosoft Cloud (where emails are billed by usage) and in the self-hosted version.

## Summary

- Confirmation with `.ics` and a Google Calendar event: the meeting lands on the calendar.
- A reschedule or cancel link in every email, reminders included via `{{manage}}`.
- Three steps: guest 2 days before, guest 3 hours before, host 1 day before.
- Minimum notice, a short window, one custom question and, if you charge, payment at booking.
- Mark No-show and look at the number once a month.
