---
title: "When an AI agent should hand the conversation to a person"
description: "Five situations where a support or sales agent has to hand off, how to set up each one in Agents, and what to review every week to tune the rules."
date: "2026-10-18"
author: "zerosoft"
tags: ["agents", "ai", "support"]
---

An AI agent that never hands off ends up making things up. One that hands off everything is a contact form with extra steps. The real work is in between: deciding when a conversation has to go to a person, and making sure that person gets it with context.

Zapier has a good guide on [human-in-the-loop](https://zapier.com/blog/human-in-the-loop/) for AI workflows in general: approvals, confidence-based routing, escalations and audit logs. This post takes those ideas down to one concrete case, an agent that talks to your customers, and shows how each rule is set up in Agents, including what it does and what it doesn't do yet.

## Five situations that always hand off

**1. The visitor asks for it.** "I want to talk to someone" is not up for debate. Pushing the bot at that moment is the fastest way to lose a customer.

**2. The answer isn't in your knowledge.** If the agent found nothing in your docs, anything it says is a well-worded guess.

**3. Money or contracts are involved.** Refunds, cancellations, discounts, wrong invoices, contract terms. The agent can collect the details, but the decision belongs to a person.

**4. The customer is upset or has tried twice.** If someone repeats the same question or types in all caps, the next message should come from a human.

**5. A lead worth chasing.** This is the one people forget. Handoffs are for good news too: a lead who just said they have budget and need it this quarter shouldn't wait for Monday's follow-up.

## How to set up each one in Agents

In Agents, handoff is a tool: "Hand off to a human". It has to be on in the Tools tab for the rules below to apply. Then, under Instructions, in the advanced section:

**When the visitor asks for a person.** A toggle, on by default. Covers situation 1.

**When the agent can't answer or is unsure.** Another toggle, also on by default. Covers situation 2. To be precise: there's no confidence score behind it. It's a rule the agent receives in its instructions, along with a fixed one: never invent prices, policies, dates, links or features. If "Search knowledge" is also on, the agent has to search before answering anything about the business, and an empty search gets logged.

**Always hand off on these words.** A comma-separated list, up to 30. Covers situation 3, and it's the most reliable of all: if the visitor's message contains one of those words, the conversation is handed off without going through the model. Not a single token is spent. A starting point:

```
refund, chargeback, cancel, invoice, lawyer, complaint, contract
```

Matching ignores case and accents. Be careful with very short or very common words: "plan" would hand off half your conversations.

**Situations 4 and 5 go in the brief.** You write the agent's instructions the way you'd explain the job to a new hire. For example:

```
If the customer repeats the same question or seems frustrated, don't push:
hand off to a person and tell them a teammate will reply here.

When a lead tells you they need this within the quarter and have budget,
log a note in the CRM with a summary and hand off to a person.
```

The "Lead qualifier" template already includes this logic: it scores each lead as HOT, WARM or COLD and hands off the hot ones.

## What happens on handoff

It depends on the channel:

- **In the Chat widget**, the conversation is marked as handed off, a system message is added, its priority goes up to high and your team gets notified. From then on, the agent stops replying. It also goes quiet as soon as a teammate replies, even if nobody handed off.
- **On the public page and through the API**, the team gets a notification with a direct link to the conversation.

Either way, the visitor sees a handoff message. You can write your own (up to 500 characters) or use the default, which comes out in English, Spanish or Portuguese depending on how the visitor wrote.

A good handoff message says two things: that a person will reply, and where. "I'm bringing in a teammate, they'll reply here" beats "Your inquiry is very important to us".

## Actions that don't rely on the model's good judgment alone

Zapier's guide puts approvals first, and it's right: some actions shouldn't happen without a confirmation. Agents doesn't yet have a queue where a person approves an action before it runs. What it does have are checks in each tool's code that the model can't skip:

- **Booking a meeting** requires a slot the agent itself offered in an earlier message, the visitor's explicit confirmation, their name and their email. The slot is checked again right before booking.
- **Saving or looking up a CRM contact** only accepts an email the visitor typed in the conversation. Nobody can use the agent to find out whether some random email is in your database.
- **HTTP request** only reaches the domains you allow, up to 20.
- **Run flow** only runs the flows you picked.

For everything else the rule is simple: if an action can't be undone, don't give the agent that tool.

## The weekly review

Handoff rules get tuned by reading real conversations. Thirty minutes a week is enough:

1. **Open the Conversations tab** and filter by channel. Handed-off conversations are marked.
2. **Read the handed-off ones.** How many could the agent have solved if the answer were in your docs? Each one is a page to write.
3. **Read the ones that didn't hand off.** Look for long answers to money questions or complaints. If you find one, add the word to the list.
4. **Rate.** Every reply has a thumbs up and down, with an optional note ("should have handed off"). The agent list shows the counts.
5. **Read the tool log.** Every conversation stores which tools the agent used, with what input and what came back. If "Search knowledge" came back empty and the agent answered anyway, you've found a concrete problem.

## What a handoff costs

Intercom charges [$0.99 per Fin outcome](https://www.intercom.com/pricing), on top of seats. That model pushes you to judge the agent by what it resolves on its own. Agents has no per-resolution price: you pay for the tokens of whichever model you choose, with your own key if you self-host or by usage on zerosoft Cloud. A keyword handoff doesn't touch the model at all.

That changes the math. Handing off too much costs your team time. Handing off too little costs you customers. The rules above aim for the point between the two.
