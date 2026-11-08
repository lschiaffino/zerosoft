---
title: "What to do with a feature request that arrives in chat"
description: "A four-step method for answering feature requests without overpromising: tag in Chat, link to a Track issue, count distinct customers, and tell them when it ships."
date: "2026-11-08"
author: "zerosoft"
tags: ["chat", "track", "support", "playbook"]
---

A customer writes: "Could you add Excel export?" There are three bad answers. "Noted," and then forgetting it. "Coming this month," without knowing. Or a manual paste into a Slack channel nobody rereads. All three leave the customer uninformed and the team without data.

Intercom has a [post on responding to feature requests](https://www.intercom.com/blog/the-right-way-to-respond-to-feature-requests) that is worth reading for the tone of the reply. Here we cover the other half: what happens to the request after you answer it, on a team of two to eight people using Chat for support and Track for the product.

## Step 1: answer with what you know, not what you hope

The reply has to do three things: confirm you understood the underlying problem, say what exists today, and say what will happen to the request. If there is no date, say there is no date.

A template to load as a canned response in **Chat → your widget → Canned responses** (shortcut `/request`):

> Thanks for writing in. To make sure I understand: you want to [problem in the customer's words]. Today that is handled like this: [current workaround, or "it has no solution inside the product yet"]. I logged your request alongside others who ask for it. I don't have a date, and as soon as there is one I'll write to you here.

Two notes on that template. First, "as soon as there is one I'll write to you" is a promise you have to keep later, which is why step 4 exists. Second, the underlying question matters more than the feature: "Excel export" may mean someone needs to hand data to an accountant, and a CSV may already cover that.

A canned response can also run actions when inserted: set the status, assign, snooze or add tags. Configure `/request` to add the tag `feature-request` and leave the conversation pending. That way classification doesn't depend on whoever happens to be replying remembering to do it.

## Step 2: an internal note with context, not a quote

The Chat composer has a Reply / Note toggle. Notes are team-only messages the visitor never sees, and you can `@` mention someone to send them a notification.

Use it to leave what the issue will need and the customer didn't say:

- What they were trying to do when they hit the limit.
- Whether they are a paying customer or a prospect (in the visitor panel, Chat can create the CRM contact if there is an email, and log the conversation to their timeline).
- What they do today as a workaround.

With those three facts, whoever prioritizes doesn't have to go back and ask the customer.

## Step 3: link the conversation to a Track issue

The conversation details panel has a **Track** section with two buttons: **Create issue** and **Link issue**.

- **Create issue**: pick the team, write a title, and the issue is created with an excerpt of the last messages and a link to the conversation.
- **Link issue**: type the identifier of an existing one, like `WEB-12`.

Always search first. If the request already exists, link instead of creating a duplicate. Each link is stored as a customer request on the issue, with the visitor's name and email, the last message they wrote and a link back to the conversation. Several conversations can hang from the same issue, and the thread gets a system note with the identifier (the visitor doesn't see it). If the Track team is private, you only see and link issues from teams you can access.

To remove a link there is an unlink button next to the identifier. It deletes the request and leaves the issue alone.

## Step 4: count customers, not messages

This is the advantage of having Chat and Track in the same product. In Track, the issue shows the customer requests it has, and the **Customers** section in the sidebar groups requests by customer. When listing issues you can sort by customer count. The count uses distinct customers (company, otherwise contact, otherwise email or name), so one customer who insists five times counts once, and ten different people count ten. Each request can be marked as important.

Three rules for deciding with that data:

1. **One distinct customer, one vote.** Five messages from the same account are one urgent request from that account and one vote in the count.
2. **Look at who asks, not just how many.** If the requester is a paying customer and the rest are curious visitors, a list sorted by count lies a little. That is what the important flag is for.
3. **A request with no problem behind it gets archived.** If after two conversations you don't know what each customer was trying to do, the issue isn't ready to enter a cycle.

## Step 5: close the loop

When the issue moves to done, you have the list of conversations that asked for it. Today you send the notice yourself: open each linked conversation and write. There is no automatic message to customers when the issue closes, and we'd rather say so than let you assume otherwise.

A ten-minute weekly routine is enough to keep it from slipping:

1. In Track, look at the issues that moved to done that week and open the ones with customer requests.
2. Open each source conversation from the request's link.
3. Reply with one concrete sentence: what changed and where to find it. Then resolve the conversation.

The closing reply is what turns a request into trust. A customer who hears that the thing they asked for now exists is a customer who asks again.

## What is not there yet

To be precise: there is no automatic notice to customers when the issue is resolved, and links are created by hand from each conversation. For a small team, the flow in this post fits in an afternoon of setup, and it costs $0 if you run it on your own server, or you can use the free plan on zerosoft Cloud if you'd rather not maintain it.
