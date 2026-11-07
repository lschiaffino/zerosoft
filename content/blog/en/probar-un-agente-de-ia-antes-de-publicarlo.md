---
title: "How to test an AI agent before it talks to your customers"
description: "A four-step method to test a support agent: saved tests graded by an AI judge, simulated conversations, replays of real chats, and versions with a draft."
date: "2026-10-31"
author: "zerosoft"
tags: ["agents", "ai", "support", "quality"]
---

You change one line in your support agent's instructions, and that afternoon someone tells you the bot promised them a refund. Nobody tested it, because testing an agent by hand is slow and you always end up trying the same happy-path question.

Intercom documents how to test Fin before launch: a [Messenger preview](https://www.intercom.com/help/en/articles/7837527-test-fin-ai-agent-before-rolling-it-out-to-customers) for your team or customer segments, and a [Batch Test](https://www.intercom.com/help/en/articles/10521711-batch-test-fin-ai-agent) that runs real questions before the answers reach a customer. The idea is sound. This post takes the same problem and solves it with the tools in Agents, including what each one does and what it still does not do.

## The problem: an agent changes with every edit

An agent depends on three things you edit often: the instructions, the knowledge and the tools. Touching any of them can break an answer that used to work. Testing well means keeping a fixed list of situations and running it again whenever you change something, like any test suite.

The method has four pieces. You can use them separately, but together they cover most cases.

## Step 1: save questions with the expected behavior

The Playground tab of an agent has a Tests section. Each test is a visitor question plus a description of what a good answer does, in your own words. One agent holds up to 50.

What matters is what you write under "Expected behavior". Describe actions, not wording:

```
Question: Do you ship to Brazil?
Expected: Searches the knowledge and says shipping to Brazil takes
5 business days. Does not book meetings.
```

Each test runs in the playground in simulation mode: the agent really answers, but tools that write (saving a contact, booking, running a flow) do not execute. Then an AI judge compares the reply and the tools used with what you expected, and marks Passed or Failed with a reason of one or two sentences. The wording does not have to match; the judge grades substance.

A starting set of ten tests for a support agent:

1. Three questions whose answer is in your knowledge (price, lead time, policy).
2. Two questions whose answer is not there. Expected: it does not invent anything and hands off.
3. A refund request. Expected: hands off, promises nothing.
4. Someone asking for a person. Expected: hands off on the first message.
5. An off-topic question. Expected: politely declines.
6. An attempt to make it ignore its instructions. Expected: behavior does not change.
7. A question in Portuguese or Spanish. Expected: answers in the visitor's language.

If you already have a good exchange in the playground, the "Save as test" button turns it into a case without retyping the question.

## Step 2: simulate whole conversations

Many problems show up in the third message, not the first: the agent asks for an email, the customer complains, the agent loses the thread. For that, a test can be of type "Simulated conversation".

You define a persona and a goal, for example: "Ana, owner of a small bakery. She wants a demo next week and gives her email when asked". An AI-played customer talks to the agent's draft until the goal is met, it is handed to a person, or the turn limit is reached (between 2 and 8, default 4). Then the judge grades the whole conversation against your success criteria, and you can read the transcript turn by turn.

Two simulations worth always having:

- **The cooperative customer.** Gives the details they are asked for. Checks that the agent completes the task (for example, booking).
- **The customer who gets angry.** Repeats the question and writes curtly. Checks that the agent hands off instead of insisting.

A simulation spends the tokens of two conversations, the customer's and the agent's, so there is no need to run all of them after every small edit. Run simulations before publishing and single-question tests whenever you change knowledge.

## Step 3: replay real conversations against the draft

Your invented tests reflect what you imagine customers ask. Real conversations show what they actually ask. The Playground also has "Repeat the last 10": it takes the first messages of the last ten real conversations, sends them to the saved draft (also in simulation) and shows side by side what the agent answered before and what it answers now, with a verdict of Better, Same or Worse.

This is the test that surprises people most. If you changed the tone of the instructions, you immediately see whether all ten answers still say what they had to say. When a "Worse" appears, you already have your next test to save.

## Step 4: publish with a draft and keep a way back

Tests only help if the live agent does not change while you run them. That is why Agents has versions. Once you publish the first one, whatever you save from then on stays a draft: the playground and the tests use the draft, and live channels stay on the published version until you press Publish. The full flow:

1. Edit and save. "Unpublished changes" shows up next to the live version status.
2. Run the tests, the simulations and the replay.
3. If everything passes, Publish, with an optional note saying what changed ("added the returns policy").
4. If something went wrong, "Discard draft" returns the editor to the live version, and "Go back to this version" puts any earlier version live as a new version.

The change log records who changed what and when: instructions, knowledge files, tools, connections. When the agent behaves differently on a Tuesday, you can see what was touched on Monday.

For big changes there is a more cautious option: the A/B test, in the Versions tab. A saved version handles between 5% and 95% of new conversations while the rest stay on the published one. The table compares conversations, resolved, handoffs and thumbs up and down for each variant, and you can put B live or end the test. With low traffic the numbers take a long time to say anything, so use it when you have volume and not as a replacement for the tests.

## What it still does not do

Know the limits before you trust the tests:

- **The judge is a model.** It can be wrong. Read the reason on every Failed and on a few random Passed, especially at the start.
- **Simulation does not run the tools.** It checks that the agent decided to call "Book meeting" with the right data, not that the booking was created. Test that part once, by hand, with a real case.
- **Tests use the saved version.** If the editor has unsaved changes, the notice asks you to save first.
- **Tests do not block publishing.** The Channels tab shows how many tests the agent has and how many passed, with a shortcut to run them, but publishing does not depend on it. The decision is yours.

## What testing costs

In Intercom, testing with real customers in the live environment is [billed per resolution](https://www.intercom.com/help/en/articles/7837527-test-fin-ai-agent-before-rolling-it-out-to-customers). Agents has no per-resolution price: tests use tokens from the model you picked, with your own key if you self-host or by usage in zerosoft Cloud, where AI is billed at the provider's cost ×1.2. A set of ten single-question tests is ten short answers and ten short verdicts. Testing before you publish costs far less than fixing a wrong promise afterwards.

## A routine that holds up

- **Every time you change something:** save, then run the single-question tests.
- **Before publishing:** run the simulations and "Repeat the last 10".
- **Every week:** look at conversations rated thumbs down and turn two of them into new tests.

After a month you have 20 to 30 cases that came from real situations, and changing the instructions stops being scary.
