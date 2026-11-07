---
title: "How to share your booking link so people actually use it"
description: "Where to put your Cal link (email, signature, website, campaigns), how to prefill details, track where each booking came from, and when a secret or single-use link fits better."
date: "2026-11-06"
author: "zerosoft"
tags: ["cal", "scheduling", "guide"]
---

Setting up an event type takes ten minutes. Getting people to use it takes longer, because a badly placed booking link lives alongside the old "does Tuesday work?" email thread. This guide covers where the link belongs, what to write next to it, and which Cal settings help in each case.

## 1. Pick the right link

Cal gives you three kinds of link, all with the same format:

- `https://zerosoft.ai/en/book/your-handle` is your public profile and lists all your active event types.
- `https://zerosoft.ai/en/book/your-handle/demo-30` opens one specific event type.
- A **secret** event type is bookable by anyone with the link but does not appear on your profile. You turn it on in the event type editor.

The practical rule: send the public to the link for a specific event. The profile with the list suits a social bio, where the person does not yet know what they want. If your profile shows six event types, the visitor has to decide before booking, and deciding slows people down.

Secret, single-use and poll event types carry `noindex`, so search engines skip them.

## 2. In an email: one sentence and the link

A bare link as the only content reads like automation. A sentence with context and a way out works better:

> Hi Ana, 30 minutes is enough to walk through the board with your team. Pick a time that suits you here: https://zerosoft.ai/en/book/lau/demo-30
>
> If none of them work, reply with two times and we will sort it out by email.

The second paragraph matters. Some people do not want to use a link on first contact, and giving them another door keeps the message from going unanswered. Email clients do not run widgets, so an email always carries a text link or a button, not an embed. [Calendly says the same in its help center](https://help.calendly.com/hc/en-us/articles/31618986451863-How-to-add-Calendly-to-an-email-or-email-template): the scheduler is linked from the email, not embedded in it.

## 3. Prefill name, email and answers

If you already know who the person is (from a CRM, a list, a form), do not make them type it again. The booking page reads URL parameters:

```
https://zerosoft.ai/en/book/lau/demo-30?name=Ana%20Paz&email=ana%40acme.com
```

Both fields arrive filled in the form. The same goes for custom questions: if your event type has a question with the internal name `company`, the parameter `company=Acme` prefills it. For dropdowns and option lists, the value is only used if it matches one of the options you defined.

Two limits to keep in mind: values are trimmed (200 characters for name and email, 2000 for answers), and the guest can still edit name and email, so prefilling saves typing and does not verify identity.

If you use the zerosoft CRM, the **Book meeting** button on a contact or deal builds this kind of link, and once the guest books, the meeting is logged on the record. More in [CRM workflows](/blog/workflows-crm-tareas-de-seguimiento).

## 4. Tag where each booking comes from

If the same link sits in your signature, your newsletter and an ad, you will not know which one brings bookings. Cal keeps the five parameters `utm_source`, `utm_medium`, `utm_campaign`, `utm_term` and `utm_content` found on the link and attaches them to the booking. They then reach the host and the webhooks.

A simple convention, one per channel:

| Where | Link |
|---|---|
| Email signature | `.../demo-30?utm_source=signature&utm_medium=email` |
| October newsletter | `.../demo-30?utm_source=newsletter&utm_medium=email&utm_campaign=october` |
| LinkedIn bio | `.../demo-30?utm_source=linkedin&utm_medium=bio` |
| Button on the pricing page | `.../demo-30?utm_source=web&utm_content=pricing` |

Cal stores only those five keys, as single-line text up to 200 characters. Any other parameter that is not a form field is ignored, so you cannot use it to pass arbitrary data. If the site is yours, the [Cal embed](/blog/embeber-cal-en-tu-sitio) keeps the visitor on your page.

## 5. When to use a single-use link

For one specific person, a secret link with limited times is tidier than the public profile. Two options help:

- **Single-use link.** It stops working after the first booking. If it gets forwarded, the page shows that it expired. If you would rather spread meetings across a team, see [round-robin with Cal](/blog/round-robin-con-cal).
- **One-off meeting.** You pick the exact times you offer, even outside your weekly hours, and share that link. It fits a one-time review with a client who needs an unusual day.

## 6. A checklist before you send it

Open the link in a private window and go through the flow as a guest:

1. Times show in your zone and in the booker's zone (try another time zone; more in [time zones in scheduling](/blog/zonas-horarias-en-agendas)).
2. The form asks for the minimum you need.
3. The confirmation email arrives with the `.ics` file and the reschedule link.
4. On a phone, the page fits without horizontal scroll.
5. You made a test booking and cancelled it, so the slot is free again.

## What is still missing

So you can compare with what you use today: Cal does not generate a QR code for the booking link, and reminders go out by email only. For a QR, use the [QR code generator](/en/tools/qr-code-generator) in the site tools and point it at your booking URL.

## Summary

- Link to a specific event for the public, profile for bios.
- In an email: one sentence, the link and a second way out.
- `?name=` and `?email=` prefill, and so do custom questions by internal name.
- Five `utm_*` keys travel with the booking: use one convention per channel.
- Secret, single-use or one-off meeting when it is for one person.
