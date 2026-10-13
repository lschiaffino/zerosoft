---
title: "Embedding Cal on your site: inline, popup, Google Meet and reminders"
description: "How to put your Cal booking page on your own site, connect Google Calendar for Meet links, and check that cancel links and 24-hour reminders go out."
date: "2026-09-15"
author: "zerosoft"
tags: ["cal", "scheduling", "tutorial"]
---

A booking link in your email signature is fine. A booking page *on your own site*, where the visitor already is, converts better and looks like you mean it. This guide covers the full setup: embedding Cal inline or as a popup, connecting Google Calendar so every meeting gets a Meet link, and the two things people forget. The guest's cancel/reschedule link and the 24-hour reminder.

## 1. Embed the booking page

Open any event type in **Cal → Event types**. At the bottom there's an **Embed on your site** panel with two tabs. Copy the snippet you want and paste it into your site. One script tag, no npm package, no framework required.

### Inline

```html
<script src="https://zerosoft.ai/api/calendar/embed.js"
        data-url="https://zerosoft.ai/en/book/ana/intro"
        async></script>
```

The calendar appears right where you put the script, as an iframe. The height adjusts by itself: the booking page reports its height to your page as the visitor moves between steps, so there's no inner scrollbar fighting your layout. Put it on a "Book a demo" or "Contact" page.

### Popup

```html
<script src="https://zerosoft.ai/api/calendar/embed.js"
        data-url="https://zerosoft.ai/en/book/ana/intro"
        data-mode="popup"
        data-label="Book a meeting"
        data-color="#0d0d0d"
        async></script>
```

This adds a floating button in the bottom-right corner. Clicking it opens the booking page in a modal. Escape or a click outside closes it. `data-label` is the button text and `data-color` its background. Good for sitewide placement: pricing page, docs, blog.

### Reacting to a booking

When a booking is confirmed inside the iframe, the script dispatches a `zs-cal:booked` event that bubbles up from the script tag. Use it to fire your own analytics or show a thank-you message:

```html
<script>
  document.addEventListener('zs-cal:booked', function (e) {
    // e.detail.start is the booked time (ISO), e.detail.eventTypeId the event type
    console.log('Booked!', e.detail.start);
  });
</script>
```

The script only listens to messages coming from the booking page's own origin and from its own iframe, so other frames on your page can't fake a booking.

### Small things worth knowing

- **Pick the locale in the URL.** `/en/book/…`, `/es/book/…` or `/pt/book/…`. The page, and the emails the guest receives, follow it.
- **The guest's timezone is detected automatically** from their browser, and they can change it from a dropdown. Your page doesn't need to do anything. (The nerdy details are in [how Cal handles timezones](/blog/zonas-horarias-en-agendas).)
- **Your branding goes with it.** Brand color, logo and welcome message set on the event type show up inside the embed too.
- **Self-hosting?** Replace `zerosoft.ai` with your own domain in both URLs. The script is served with permissive CORS and cached for an hour.

## 2. Connect Google Calendar

Without a connected calendar, Cal only knows about meetings booked through Cal and the blocked slots you add by hand. Connect Google and two things change.

Go to **Cal → Settings** and click **Connect Google Calendar**. Google asks for two permissions (free/busy and events) and Cal needs both. If you uncheck one, it asks you to try again.

**Busy times block slots.** Before showing availability, Cal asks Google for the free/busy of your **primary** calendar. A dentist appointment you added from your phone hides those slots from your booking page. The answer is cached for about a minute, so changes show up quickly.

**Bookings land in your calendar.** Every new booking creates an event in your primary Google Calendar, with the guest as attendee. If the event type's location is empty or set to "Google Meet", the event is created with a **Google Meet link**, which Cal saves and puts into the confirmation emails, the `.ics` invite and your bookings list ("Join meeting"). Reschedules move the event; cancellations delete it.

Cal creates the Google event with notifications turned off, because the guest already gets Cal's own email with an invite attached. No duplicate invitations. And if you have Google connected, your host notification skips the `.ics` attachment so you don't end up with the meeting twice.

It's all best-effort by design: if Google is down or your token expired, the booking still goes through. A calendar outage shouldn't cost you a meeting.

Each person connects their own calendar. On a team using [round-robin](/blog/round-robin-con-cal), every host should do this, or Cal will think they're free when they aren't.

**Self-hosting:** set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and add `<NEXTAUTH_URL>/api/integrations/google-calendar/callback` as an authorized redirect URI in your Google Cloud console. Cal's settings page tells you the exact URI if it's missing.

What's **not** there: Outlook, iCloud and other CalDAV calendars aren't supported yet, and only the primary Google calendar is checked for conflicts, not secondary ones.

## 3. Cancel and reschedule links

Every confirmation email the guest gets includes a **Reschedule or cancel** link. It points to `/book/manage/<token>`, a private page tied to a long random token. No account, no password: the link *is* the credential.

From there the guest can:

- **Reschedule** to any other slot you're offering. Same rules as a new booking: buffers, minimum notice, availability.
- **Cancel**, with an optional reason that gets passed on to you.

Both send emails to guest and host (with an updated or cancelling `.ics`), update Google Calendar, and fire the `booking.rescheduled` or `booking.cancelled` webhook. Once the meeting has started, the link stops accepting changes.

On your side, you can cancel from the bookings list in Cal, or via the API with `POST /api/v1/calendar/bookings/:id/cancel`.

## 4. Reminders that actually go out

Cal sends the guest a reminder **24 hours before** the meeting, in their language, with the reschedule/cancel link. Two pieces have to be in place for that to happen.

**Email delivery.** Cal sends email through Resend. Set `RESEND_API_KEY` and `EMAIL_FROM` (an address on a domain you've verified with Resend). Without the key, emails are printed to the server console instead of being sent: handy in development, a silent failure in production.

**The cron.** Reminders are queued in the database and sent by a periodic job at `/api/cron/tick`, which also handles webhook retries. On Vercel, the included `vercel.json` runs it hourly. Elsewhere, schedule it yourself:

```bash
# crontab: every hour at :17
17 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://cal.example.com/api/cron/tick
```

In production the endpoint refuses to run without `CRON_SECRET`, and requires it as a Bearer token. Because the job runs hourly, a reminder goes out somewhere between 24 and 23 hours before the meeting. If sending fails, it isn't marked as sent, so the next run retries. Cancelled bookings drop their pending reminder; rescheduled ones get a new one. Meetings booked less than 24 hours ahead skip the reminder, since the confirmation just arrived.

That's the only reminder today. There are no SMS reminders and no custom reminder schedules (say, one hour before) yet.

## A five-minute checklist

- Event type created, availability and buffers set ([here's how to think about those](/blog/buffers-aviso-minimo-y-ventana)).
- Snippet pasted, inline or popup.
- Google Calendar connected, location left empty or "Google Meet".
- `RESEND_API_KEY`, `EMAIL_FROM` and `CRON_SECRET` set, cron running.
- Book a test meeting from a private window, then reschedule and cancel it from the email.

If the test booking ends up in your calendar with a Meet link, and the cancel email arrives, you're done.
