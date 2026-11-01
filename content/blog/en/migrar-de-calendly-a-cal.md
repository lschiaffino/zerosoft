---
title: "Migrate from Calendly to Cal: event types, hours, bookings"
description: "How to move from Calendly to Cal with a personal access token: what imports (event types, questions, availability, upcoming bookings) and what to check."
date: "2026-10-31"
author: "zerosoft"
tags: ["cal", "calendly", "migration", "guide"]
---

Switching scheduling tools has an easy part and an awkward part. The easy part is creating the new account. The awkward part is everything you already set up in Calendly: event types with their questions, schedules with exceptions, bookings for the next few weeks, and the link sitting in your email signature.

This guide explains how the Calendly import in [Cal](/products/cal) works, exactly what it brings (we read it from the importer's code), what you'll redo by hand, and the order that keeps everyone's meetings intact.

## What you need

- **A Calendly personal access token.** In Calendly, open Integrations & apps › API and webhooks, and generate one under Personal access tokens. The import uses Calendly's API v2 and only reads.
- **Workspace admin rights** in zerosoft. What you import becomes available to the whole workspace.

The token is kept encrypted while your data is read and deleted when the import finishes, fails or is cancelled. You can still revoke it in Calendly afterwards.

## Step by step

1. In Cal, go to **Settings › Import**. It's also in the workspace import hub (**Settings › Import**, Calendly source).
2. Paste the token into **Calendly personal access token**.
3. Decide whether to tick **Also import upcoming bookings**. Read the section on order below first.
4. Hit **Preview**. You'll see each event type with its duration and how many locations and questions it carries, plus each schedule with its time zone and number of weekly slots.
5. Confirm with **Import**. When it's done, **Go to event types** takes you to the list.

## What gets imported

**Availability schedules.** Each Calendly schedule comes over with its name, time zone, weekly hours and date overrides (blocked days and days with different hours). Your default in Calendly is your default in Cal.

**Event types.** For each one:

- title, link (slug), duration, description and color;
- whether it's active;
- up to 20 questions, in order. Long text, phone, single choice and multiple choice get their matching type; everything else becomes short text. Questions switched off in Calendly are skipped;
- locations: in person with the address, Zoom, Google Meet, Microsoft Teams, host calls, invitee calls and custom links (Webex or GoToMeeting too, when they carry a URL).

If a location has no match, the preview says so next to the event type ("not supported here") and that event type comes in without it.

**Upcoming bookings (optional).** Active bookings from the moment of the import onward, with the invitee's name, email and time zone, their answers, and the meeting link or address. They land as confirmed, under the person running the import, and invitees **don't get another email**: they already have Calendly's confirmation. The import doesn't create a second event on your calendar either.

Running the import twice doesn't duplicate anything. What already came in is skipped.

## What doesn't get imported

- **Which schedule each event type uses.** Calendly doesn't expose it, so every event type gets the default schedule. Change it per event type if you used several.
- **Buffers, minimum notice and booking window.** Cal has them, but you set them again.
- **The secret flag.** A secret Calendly event type comes in as a regular one. If you don't want it on your public profile, mark it secret in Cal.
- **Workflows, routing forms and payments.** Cal has all three (workflows with steps before and after, routing forms and Stripe), but you build them from scratch.
- **Other people's event types.** The import reads the account that owns the token. If your team has several Calendly accounts, each person runs an import, or an admin runs one per token.
- **Calendly one-off meetings**, which aren't reusable event types.
- **Past and cancelled bookings.** Only upcoming active ones come over.
- **Extra invitees.** Each booking brings its first invitee.
- **Links that are taken.** If a slug already exists in Cal, it gets a number at the end (`demo-2`) and the final report tells you which ones changed.

## Doing the switch in the right order

Imported bookings stay alive in Calendly too. The invitee has Calendly's links to cancel or reschedule, and those changes don't reach Cal. So there are two sensible approaches:

- **Without imported bookings.** Import only event types and schedules, publish your Cal link, and let existing Calendly bookings play out there. This is the cleanest.
- **With imported bookings.** Useful if you want your whole agenda in Cal from day one. Until the last imported booking has happened, check Calendly now and then for cancellations.

Either way:

1. **Connect your calendar** under **Settings › Connections**. Cal works with Google, Outlook and iCloud, and busy time blocks slots.
2. **Review each event type**: schedule, buffers, questions and locations.
3. **Make a test booking** from another email.
4. **Swap the links**: email signature, website and embeds. If you had Calendly's widget on your site, [embedding Cal on your site](/blog/embeber-cal-en-tu-sitio) walks through each option.
5. **Turn off the event types in Calendly** once you don't want new bookings there.

## What Cal still lacks compared to Calendly

From the parity table, as is:

- **Meeting packages, payment links and invoices**: not yet.
- **Managed event types locked by an admin**: not yet.
- **SAML SSO and SCIM**: not yet.
- **iOS and Android apps and a browser extension**: not yet. The web app works at 390 px wide.
- **Notetaker with meeting summaries, and an email scheduling assistant**: not yet.
- **Payments**: Stripe with your own keys and refunds on cancel; PayPal is missing.
- **Zapier and Make**: booking events reach them through a webhook, but there's no app in their directories.
- **Roles**: the workspace roles, with no scheduling-specific roles.
- **Booking page languages**: English, Spanish and Portuguese. Calendly has five.

The full comparison is at [/compare/zerosoft-vs-calendly](/compare/zerosoft-vs-calendly).

## What it costs

Calendly Standard costs about $12 per user per month, so ten people pay $1,440 a year. Cal on your own server costs $0, with the core under AGPLv3. On zerosoft Cloud you start on a free plan and then pay for usage, which in Cal means bookings. Seats aren't charged.

If you're still deciding, read [Cal vs Calendly](/blog/zerosoft-cal-vs-calendly), including the cases where staying put makes more sense.
