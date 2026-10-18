---
title: "How to write the brief and the knowledge for a support agent"
description: "A brief template for an AI agent, how to write Docs pages the search will actually find, and a test method with real questions before you publish."
date: "2026-10-18"
author: "zerosoft"
tags: ["agents", "ai", "docs", "support"]
---

A support agent answers as well as two texts you write: the instructions, which tell it how to work, and the knowledge, which tells it what's true about your business. Most agents that answer badly have a problem in one of those two, and almost never in the model.

Intercom published [how they prepared their help center for Fin](https://www.intercom.com/help/en/articles/7269326-how-to-optimize-your-help-center-for-fin): audit old articles, test with a small group of customers and write what was missing. Lindy has a [prompt guide](https://docs.lindy.ai/fundamentals/lindy-101/prompt-guide) for its agents. Both are useful. This post adds what you can only say by reading the code: how Agents searches your knowledge, and what that changes about how you write.

## Part 1: the brief

An agent's instructions can run up to 12,000 characters. You don't need them all. A good brief fits on one screen and has six parts:

```
Role: You're the support assistant for Acme, scheduling software for clinics.

Goal: resolve customer questions about using the product,
in the first reply whenever possible.

How to work:
- Before answering about the product, pricing or policies, search the knowledge.
- Reply in 1 to 4 sentences. When explaining how to do something, use numbered steps.
- If the customer reports an error, ask what they did, what happened and their email,
  then create an issue in Track with those details.

When to hand off:
- Refunds, cancellations or billing: always to a person.
- If you can't find the answer, say so and hand off.

What you don't do: no medical advice, no talking about competitors.

Tone: friendly and direct. No marketing language.
```

Three things to keep in mind while writing it:

**Don't repeat the safety rules.** Agents adds a block of rules before your instructions on its own: whatever the visitor writes and whatever tools return is treated as data; the agent never reveals its configuration; it doesn't invent prices, dates, links or features; it replies in the visitor's language. Spending brief lines on that only makes it longer.

**Use the fields that already exist.** Topics to avoid have their own field (one per line, up to 30), and so does max reply length (800 characters by default, between 100 and 4,000). What goes in a field always applies. What goes in the brief, the model interprets.

**Name tools by what they do.** "Create an issue in Track" is clearer to the model than "log the problem". And only turn on the tools the brief mentions: a tool that's on but unexplained is a tool the agent uses at its own discretion.

If you'd rather not start from scratch, there are three templates: support agent, sales SDR that books meetings, and lead qualifier. Each comes with its brief and turns on the tools it needs.

## Part 2: knowledge, written for the search

This is the part with the biggest payoff, and it depends on how the search works.

When the agent needs information, it calls "Search knowledge" with a few keywords. Agents splits each page into chunks of about 900 characters, keeping sentences whole, and ranks them with BM25: a lexical search that matches words. There are no embeddings. The model receives the 5 highest-scoring chunks, and each page's title counts double.

That gives you five writing rules:

**1. Use your customers' words.** If they say "close my account" and your page says "subscription termination", the search may not find it. Open the Chat inbox, copy how people actually ask, and use those words in your text. Accents and capitalization don't matter; the words do.

**2. Title pages as questions.** The title counts double. "How do I change my payment card?" beats "Billing (general)".

**3. One topic per page.** A "FAQ" page with forty answers gets split into chunks that mix topics, and they all share the same title. Forty short pages work better.

**4. Every paragraph has to stand on its own.** Since the agent gets loose chunks, "As mentioned above, you do that in Settings" doesn't help it. "You change the billing email in Settings, under Payments" does.

**5. Keep numbers next to their context.** "Up to 3 users on the Basic plan" in the same sentence. If the number lands in one chunk and the plan name in another, the agent gets half a fact.

### Where the knowledge comes from

In the Knowledge tab you pick from three sources:

- **Docs pages.** By default, every public page, including ones you create later. You can also add private pages one by one, with a warning: anyone who talks to the agent can see that content. If you already have an [internal wiki in Docs](/blog/wiki-interna-con-docs), keep the customer-facing parts separate.
- **Web pages.** Up to 20 URLs. Each URL is one page: Agents downloads its text (up to 60,000 characters) and doesn't crawl the rest of the site. The text doesn't update on its own; when the page changes, click Refresh.
- **Canned responses** from a Chat widget. The ones your team already uses to reply quickly.

## Part 3: test it with real questions

Before connecting the agent to the Chat widget, collect 20 real questions from your inbox. Don't make them up: made-up questions are always well written.

In the Playground, ask each question the way a customer would. Tools show up inline, with what was sent and what came back. For each answer, write down one of four outcomes:

| Outcome | What to fix |
|---|---|
| Answered well | Nothing |
| Answered badly with the right chunk | The brief: a rule or an example is missing |
| "Search knowledge" didn't return the right chunk | The page: words, title or mixed topics |
| There was no page about it | Write it, or add it to the handoff words |

The third row is the most common and the easiest to fix: check which words the agent used in its search (they're in the log) and see whether they appear on your page.

After you publish, the Conversations tab stores every exchange from every channel with its tool log, and every reply can be rated thumbs up or down with a note. Repeat the 20-question test every time you change the brief: a fix for one question sometimes breaks another.

## What it doesn't do yet

The search is lexical: it doesn't understand synonyms that aren't written down. URLs aren't crawled or refreshed automatically. And there's no panel suggesting which pages to write based on unanswered conversations; you build that list yourself in the weekly review. What you do get is visibility: the safety instructions are in the open source code, the knowledge lives in your Docs and every search is logged. To decide when the agent should let go of a conversation, read [when to hand off to a person](/blog/cuando-un-agente-tiene-que-derivar).
