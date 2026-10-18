---
title: "What data a booking leaves behind, and where it goes"
description: "The full map of a booking in Cal: what's stored in the row, which copies go out to email, Google Calendar, the CRM, webhooks and Stripe, and how to answer a deletion request. With the gaps stated."
date: "2026-10-18"
author: "zerosoft"
tags: ["cal", "privacy", "data", "self-host"]
---

Privacy guides for scheduling tools usually start with paperwork: the processing agreement, the subprocessor list, transfer clauses. Those matter, and Cal.com published a [long GDPR guide](https://cal.com/blog/gdpr-compliant-scheduling) that covers them well. But before the paperwork there's a more concrete question, the one anyone asking to see or delete their data will put to you: **where is it?**

This post answers that for Cal, read from the code. It's the map you need to write your privacy notice, answer a deletion request, or decide whether self-hosting suits you.

## The row: what Cal stores for each booking

Each booking is a row in the `calendar_bookings` table. These are its personal and operational fields:

| Field | What it is |
|---|---|
| `invitee_name`, `invitee_email` | Name and email of the person who booked. Always required |
| `starts_at`, `ends_at`, `timezone` | Time slot and the person's time zone |
| `locale` | The language they booked in (so emails go out in that language) |
| `answers` | Answers to your custom questions, as JSON |
| `status`, `cancel_reason` | Confirmed, cancelled, no-show or awaiting payment, plus the reason if they cancelled |
| `host_user_id` | Who on your team takes it (with round-robin) |
| `meeting_url`, `google_event_id` | Video call link and a reference to the Google event |
| `manage_token` | The token behind the reschedule or cancel link |
| `payment_status`, `amount_cents`, `currency`, `stripe_session_id` | Only if the event type charges |

What is **not** in the row: the IP address, the browser, the device. The booking endpoint uses the IP to stop abuse (up to 10 attempts per 10 minutes per IP) in a rate-limit table that clears itself when the window ends. Our [privacy policy](/privacy) has the details, along with the hosting provider's short-lived logs.

The column that needs the most care is `answers`. A free-text question like "Anything we should know?" invites answers you don't want to keep: a medical diagnosis, a legal problem, someone else's details.

## The copies: where each booking travels

When someone confirms, Cal does five things besides saving the row. Each leaves a copy somewhere else:

1. **Emails.** The guest's confirmation (with `.ics`), the host's notice and every reminder. On zerosoft Cloud they go out through Resend. They carry the name, time, location and the manage link.
2. **Google Calendar**, if you connected it. An event is created on your calendar with the event type's title, the person's name, their email as a guest and a description with name and email. Answers don't travel to Google.
3. **CRM.** Every booking creates the contact if it doesn't exist (name and email) and a meeting activity on their record. That activity's body includes the answers. If they cancel later, the activity gets the reason.
4. **Webhooks and Flow.** The `booking.created`, `booking.rescheduled` and `booking.cancelled` events send your URLs the name, email, time slot, answers and, if any, the payment. What the receiver does with it is on you.
5. **Stripe**, if you charge. The Checkout session stays in your Stripe account, with whatever Stripe requires to take the payment.

This map is what you'll need the day someone writes to you. Keep it next to your privacy notice.

## Who is responsible for what

For the bookings you receive, you're the controller: you decide what to ask, why and for how long. On zerosoft Cloud, zerosoft processes that data on your behalf, and the providers that run the cloud (Vercel for hosting, Turso for the database, Resend for email) are listed in the [privacy policy](/privacy). Google, Stripe and your webhook receivers only come in if you connect them.

Self-hosting shortens the chain: you pick the server, the database and the email provider, and the AGPLv3 code is there for anyone on your team to verify this map. For a team that needs data to stay inside one country, it's the most direct route. For reference, Cal.com says in that same guide that its EU hosting is for companies with 50 or more users and was in early access.

## Collect less, starting with the form

The cheapest data to protect is data you never store. In each event type's **Questions**:

- **Prefer yes/no or number over free text.** Custom questions can be text, number or yes/no. "Do you already use a CRM?" tells you the same as "Tell us about your situation" and leaves less loose text behind.
- **Mark as optional anything you don't strictly need.** Each question has its own required checkbox.
- **Say what not to send.** In the event type's welcome message, a line like "Please don't include health information or details about other people in this form" saves trouble.
- **Review the questions every quarter.** The question you added for one campaign is still there collecting data.

## How to answer a deletion request

Someone writes: "Delete everything you have on me." With the map above, the route is:

1. **Cal.** Cancelling a booking doesn't delete it: it stays as cancelled, with its history. Today Cal has no button to delete a single booking; deleting an event type deletes all of its bookings, which is rarely what you want. On zerosoft Cloud, the channel for a one-off request is privacy@zerosoft.ai, listed in the privacy policy. When self-hosting you do it in the database yourself (SQL below).
2. **CRM.** Delete the contact from their record. Check they aren't still on a list or a deal.
3. **Google Calendar.** Delete the event by hand. If the person was a guest, the copy on their own calendar is theirs.
4. **Webhooks.** Whatever reached your spreadsheet, database or automation has to be deleted there.
5. **Stripe.** Payments have their own retention rules for tax reasons; check Stripe's and your country's before deleting.
6. **Reply with a date.** Tell the person what you deleted and where.

For self-hosting, this SQL deletes the bookings for one email and their pending reminders. Take a backup first:

```sql
DELETE FROM calendar_workflow_runs
  WHERE booking_id IN (SELECT id FROM calendar_bookings WHERE invitee_email = 'person@example.com');
DELETE FROM calendar_reminders
  WHERE booking_id IN (SELECT id FROM calendar_bookings WHERE invitee_email = 'person@example.com');
DELETE FROM calendar_bookings WHERE invitee_email = 'person@example.com';
```

## The gaps, stated

- **Deleting a booking from the interface.** It's the biggest gap in this post.
- **Automatic retention.** There's no rule like "delete bookings older than 24 months". Bookings are kept for as long as you keep them.
- **Exporting one person's bookings.** The API lists bookings with search (`GET /api/v1/calendar/bookings?q=`), which works for putting together an access request, but there's no "export everything for this email" button.

If one of these blocks you, say so on the [feedback board](/feedback). In the meantime, the map of copies is what will save you the most time: a deletion request without a map takes an afternoon, and with one it takes fifteen minutes.
