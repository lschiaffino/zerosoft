---
title: "Customer questions in WhatsApp groups: how to turn them into tickets with an SLA"
description: "A four-rule system so no question gets lost in a customer WhatsApp group: tickets by emoji or keyword, response deadlines, an unanswered flag and an email alert. With the values Lines uses, the open source WhatsApp inbox from zerosoft."
date: "2026-11-28"
author: "zerosoft"
tags: ["lines", "periskope", "whatsapp", "support"]
---

Many small teams serve customers in WhatsApp groups: one group per account, with the customer inside and two or three of your people. It works until the group gets forty messages a day and a question from Tuesday at eleven sits under a voice note, three photos and a "thanks". Nobody ignored it on purpose. Nobody owned it.

Periskope, which sells a WhatsApp inbox, has [a post on managing customer queries in WhatsApp groups](https://periskope.app/blog/manage-customer-queries-on-whatsapp-groups) that suggests flagging the important queries and turning them into tickets and tasks. Good idea. Here is our version: four rules you can set up in an afternoon, with the concrete values Lines ships with. Lines is the WhatsApp inbox from zerosoft (AGPL license, self-host for $0 or zerosoft Cloud).

## Rule 1: every question gets a ticket and an owner

The unit of work is the ticket. A ticket has a status (open, in progress, resolved, closed), a priority (low, medium, high, urgent), an assignee and a due time. If a query has no ticket, it depends on somebody's memory.

Lines gives you three ways to create one:

- **From a message.** In the menu of any message in the chat.
- **With a reaction.** Reacting with 🎫 to a message creates a ticket, one ticket per message. It works from Lines and from the phone, so whoever answers from their mobile does not need to open anything else. You can change the emoji in settings, or leave it empty to turn the feature off.
- **By keyword.** If you add words like "invoice", "error" or "not working", an incoming message that contains one opens a ticket by itself.

Start with the emoji and no keywords. Keywords create extra tickets until you tune them, and a team whose ticket list is full of noise stops reading it.

## Rule 2: a deadline for each priority

A ticket without a deadline is a note. Lines starts with these values, all editable in Lines settings:

| What | Default deadline |
|---|---|
| First response | 60 minutes |
| Resolution, urgent | 4 hours (240 min) |
| Resolution, high | 8 hours (480 min) |
| Resolution, medium | 24 hours (1440 min) |
| Resolution, low | 3 days (4320 min) |

A new ticket gets medium priority by default. Before accepting these numbers, ask yourself something uncomfortable: can your team actually meet them? A 15-minute first-response SLA that breaks every day teaches everyone to ignore the alerts. Start at 60 minutes, hit it for a month, then lower it.

## Rule 3: what has no ticket still cannot go unanswered

Not every question gets the emoji. That is what the **unanswered** flag is for: if the customer's last message has waited longer than a set time (30 minutes by default), the chat is flagged in the inbox and you can filter by "unanswered".

There are two modes:

1. **By time.** Every customer message expects a reply. Simple, but an "ok, thanks" triggers the flag too.
2. **With AI.** It tells questions and requests apart from loose comments. You can give it rules in plain text, for example: "thank-yous are not questions, anything about billing is".

Two details that matter in practice. First, a reply you send from the phone counts as an answer: if someone responds from WhatsApp on their mobile, the flag clears. Second, creating a ticket from the message takes the chat off the unanswered list (you can turn that off), because from then on the question has an owner and a deadline.

An example AI rule for an accounting firm: "Messages with a photo of a receipt are requests. One-word replies (ok, done, sure) are not. Any mention of a due date is urgent". The AI only flags, it does not answer for you, and it pays to review the list during the first week and adjust the text.

## Rule 4: alert when a deadline breaks

A deadline nobody sees expire is useless. Lines can send an email when a ticket passes its first-response or resolution time. You turn it on in settings and choose who gets it: the assignee, the workspace admins and up to 10 extra addresses, comma separated. Each breach alerts once, even if the process that detects it runs twice. Besides email, a breach fires webhooks and can be a trigger in Flow, for example to post in a Talk channel.

A reasonable setup for five people: alert the assignee and one shared on-call address. Admins get the alert only if you turn it on, so you do not fill inboxes.

## What it looks like in a real week

Monday: you connect the line by QR and set the 🎫 emoji, first response at 60 minutes and the unanswered flag at 30. During the week, whoever reads a group reacts with 🎫 to each real request. Friday: you open the ticket list, filter the overdue ones and look at the ticket and resolution metrics. That tells you which groups concentrate the requests and who is overloaded, and you can adjust automatic assignment (round-robin among people who are online) before adding someone.

## What is not there yet

Worth saying plainly. The QR connection uses Evolution API (on our server, or on your own WAHA or Evolution API gateway), and several inbox features are tested against a simulated provider and not yet against real WhatsApp. The status of every feature is on the app's [public parity list](/en/products/lines). Official API (Cloud API) lines are in the same category. And like any tool that uses WhatsApp over QR, it depends on how WhatsApp treats that connection. Weigh that risk before putting a number you cannot replace at the center of your support.

## What the suite adds

Lines tickets do not live alone. Tasks created from a chat are CRM tasks, with a link back to the conversation, and a ticket's custom fields work for filters and CSV export. If you already use CRM, the customer in the group and their deals are one click away. And if you host zerosoft yourself, your customers' messages sit in your database, not a vendor's.

## Start today

1. Pick one pilot group, the noisiest.
2. Keep 🎫 as the emoji and first response at 60 minutes.
3. Turn on the unanswered flag, in time mode.
4. Turn on the SLA email for the assignee only.
5. After seven days, look at how many tickets breached and why. Only then touch the deadlines or turn on AI.
