---
title: "Charging for a booking with Stripe in Cal: a step-by-step guide"
description: "How to charge for consultations and sessions from your booking page with your own Stripe account: setup, what happens when the guest doesn't pay, and how refunds work."
date: "2026-10-26"
author: "zerosoft"
tags: ["cal", "scheduling", "payments"]
---

If you sell consulting, lessons or advisory sessions, you know the scene: someone books an hour of your time, doesn't show up, and nothing happens. The usual fix is to charge at booking time. A slot that has been paid for rarely gets cancelled the same day.

Calendly has its [guide to payments at booking](https://calendly.com/blog/pay-at-booking) and a [payments page](https://calendly.com/learn/calendly-payments): you connect Stripe or PayPal, turn on payment for each event type, and the money goes to your account. According to its help center, payment collection is not on every plan, so check yours before you build anything.

This is the Cal version: how to set it up, what happens in the awkward cases, and what it still doesn't do. Everything below comes from the code, which is open.

## How charging works in Cal

Cal doesn't collect money for you or sit in the middle. You use your own Stripe account and give Cal a secret key. Cal stores it encrypted and uses it to create one Stripe Checkout session per booking. Money goes from Stripe to your account. Whatever fees Stripe charges are the ones in your own contract with Stripe.

The sequence, from the guest's side:

1. They pick a slot on your booking page and fill in the form.
2. Cal saves the booking as pending and **holds the slot for 35 minutes**. Nobody else can take it in that window.
3. The guest pays in Stripe Checkout.
4. Stripe notifies Cal by webhook and the booking becomes confirmed. Only then do the confirmation email and the calendar event go out.

If the guest comes back without paying or the session expires, the slot is released on its own.

## Step 1: connect Stripe

Go to **Cal → Settings → Stripe payments**. There are three pieces:

- **Secret key** (starts with `sk_` or `rk_`). A restricted key (`rk_`) works and is the tidier choice: give it permission for Checkout Sessions and Refunds only. Cal shows only the last four characters and whether it is test or live mode.
- **Webhook URL.** Cal gives you one per workspace. Copy it.
- **Webhook signing secret** (`whsec_`). You create it in Stripe, under Developers → Webhooks, by pasting that URL.

On the Stripe webhook, select these four events: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`.

Cal requires both the key and the signing secret before it accepts paid bookings. If the secret is missing, guests can't book that event and the editor tells you so. That is deliberate: without a webhook, a payment the guest completes without returning to your page could end up charged with the booking already expired.

Only the workspace owner or an admin can change this setting.

## Step 2: put a price on an event type

In the event type editor, **Payments** tab, you choose a price and a currency. Available currencies are USD, EUR, ARS, BRL, MXN, CLP, COP and GBP. With price 0 the event is not charged.

Cal validates a few rules on save:

- The amount accepts `15000`, `15.000` or `15.000,50`. A single separator followed by three digits is read as thousands.
- CLP has no cents: enter a whole number.
- Stripe sets a minimum per charge. Cal knows it for USD, EUR, GBP, BRL and MXN and rejects a lower price before Checkout fails in production.

Try it first with a test-mode key and Stripe's test card. Make a full booking, check that the confirmation arrives, then cancel it to see the refund.

## What happens in the awkward cases

A payment flow is tested by what goes wrong, not by the happy path. This is what Cal does:

- **The guest doesn't pay.** After 35 minutes the hold expires, the slot is free again and the pending booking is discarded.
- **They pay after the hold expired.** If the slot is still free, the booking is confirmed anyway. If someone else took it, the full payment is refunded automatically.
- **Delayed payment methods** (cash vouchers, boleto). The hold stretches up to 72 hours, never past the start of the meeting. If the payment lands after the meeting has started, it is refunded.
- **You cancel a paid booking.** Whether it's the host, the guest or the API, Cal refunds the full payment and marks it "refunded". If Stripe fails at that moment, the booking stays cancelled with the payment still marked as paid, so you can refund it by hand from Stripe.
- **You delete an event type with upcoming bookings.** Cal asks you to cancel them first, and cancelling notifies the guests and refunds the payments.
- **Events from elsewhere.** Cal ignores webhooks that don't carry its metadata or whose amount and currency don't match the booking. A Payment Link in the same Stripe account can't confirm or cancel bookings.

## A charging policy that works

Cal always refunds the full amount. If you want a finer policy, build it into how you design the event:

- **A short, paid first session.** A 20 or 30 minute call at a low price filters out the merely curious without scaring anyone off. The long session gets booked afterwards.
- **Long minimum notice.** With 24 hours of minimum notice, people booking know it isn't for today. See [buffers, minimum notice and booking window](/blog/buffers-aviso-minimo-y-ventana).
- **A question up front.** A required form question ("what do you want to solve in the session?") lets you arrive prepared.
- **A reminder workflow.** An email 24 hours before with the meeting link and the reschedule link cuts complaints. More in [fewer no-shows with Cal](/blog/menos-ausencias-en-reuniones-con-cal).

## What it still doesn't do

Cal is upfront about its gaps. Today:

- Only Stripe is supported. **PayPal is not.**
- There are no coupons or discounts, and no partial payments or deposits.
- Partial refunds are done from Stripe, not from Cal.
- It doesn't calculate taxes: that stays in your Stripe account settings.

If any of these is essential for you, Calendly or your own Payment Link can cover it today.

## What it costs

Self-hosted: $0, payments included, because the core is AGPL with all its features. On zerosoft Cloud there is no per-user price: you pay per booking and for storage, and Stripe's fee is separate and goes straight to your Stripe account. For the full reasoning on why a booking shouldn't be priced per seat, read [Cal vs Calendly](/blog/zerosoft-cal-vs-calendly).

## Final checklist

1. A restricted Stripe key in test mode loaded in Cal.
2. Webhook created with the four events and the signing secret pasted.
3. Price and currency on the event type, minimum respected.
4. One full test booking, confirmed and cancelled with a refund.
5. Only then, live keys and the real price.
