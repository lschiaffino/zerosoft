---
title: "Help articles for two readers: your customer and your bot"
description: "How to write help center articles that answer in the first lines, match the words customers actually type and work for the Chat bot, using the help center built from published Docs pages."
date: "2026-10-18"
author: "zerosoft"
tags: ["chat", "docs", "support", "help center"]
---

A help article now has two readers. One is the person who arrived frustrated from Google or from the widget. The other is the bot, which reads the same text to answer in the chat. If the article only works for one of them, you've done half the job.

Intercom has a classic post with [seven steps to better help center content](https://www.intercom.com/blog/creating-better-help-content/): define what each article is for, put yourself in the shoes of someone arriving with a problem, show as well as tell, think about search and make it easy to scan. All of that still holds. What we add here is the mechanical part: how the Chat bot reads an article, which parts of the text weigh more, and how that changes the way you write.

## How the help center is built

In zerosoft the help center comes from Docs. There's no separate editor.

1. You write a page in Docs.
2. In **Share**, you turn on **Publish to help center**. The page goes live at `/h/<your-handle>/<slug>`, readable by anyone without an account. The handle is the same one your Cal booking pages use; if you don't have one, Docs asks you to set it.
3. Published pages whose parent isn't published become collections; their published children are that collection's articles.
4. In the Chat widget, you turn on **Show help tab**. The widget adds a tab with your articles and suggests them while the visitor types a question.

There's a second switch in the same dialog, under Advanced: **AI can use it**. It's for pages you want the bot to know without publishing them, like an internal refund policy. The bot reads published pages and pages with that switch on. The rest of the workspace stays out.

## How the bot reads

This comes from the code (`lib/chat-bot-ai.ts`, `lib/knowledge-search.ts` and `lib/chat-data.ts`). In the widget settings you choose where the bot answers from. The two modes that read Docs work like this.

**AI (Docs + saved replies)**, if you set an AI Gateway key: each page is split into pieces of about 900 characters, along sentence boundaries. For each visitor message, a BM25 search picks the five most relevant pieces across your pages and saved replies, with the page title counted twice. The model is instructed to answer only from that material and, if it isn't enough, to hand off to a person: the conversation goes to high priority and the team gets a notification.

**Docs pages**, or the AI mode when the model fails: the bot compares the visitor's words with each page's title and text (a word in the title scores 2, in the body 1) and replies once with the winning article's title followed by its first 280 characters.

Nearly every rule below comes from those two paragraphs.

## Six writing rules

### 1. The title is the question the customer types

Nobody types "Billing" into a chat. "How do I change my payment card" is what they type. The title weighs double in the bot, in help center search and in the widget's suggestions. Use the verb and the noun your customer would use.

### 2. The answer goes in the first 280 characters

That's what the bot sends in Docs pages mode, and it's what any person in a hurry reads first. Skip "In this article you'll learn". Lead with the answer, then explain.

> Weak: "Billing is an important part of your account. In this article we'll go over..."
> Better: "To change your card, go to Settings, Billing, Payment method and click Replace. The change applies from your next charge."

### 3. One question per article

A 4,000-character article is split into five pieces, and the bot only gets the ones closest to the question. If you mix changing the card, requesting an invoice and closing the account, every piece carries noise from the other topics. Three short articles beat one long one.

### 4. Every section stands on its own

Since the bot may get the third piece without the first, avoid "as mentioned above" or "this" pointing at something three paragraphs back. Repeat the noun: "the payment method", not "it".

### 5. Write down what can't be done, too

The bot doesn't answer what isn't written; it hands off. If a customer asks "can I pay by bank transfer?" and the answer is no, write it: "We currently accept credit and debit cards. We don't accept bank transfers." A line like that settles the question in the chat and avoids a handoff.

### 6. Numbered steps with the exact button names

If the button says "Replace", the article says "Replace", not "change" or "update". It matches what the person sees on screen and what they search for.

## A template

```
Title: How to [verb] [object] (in the customer's words)

[The answer in one or two sentences. Under 280 characters.]

## Steps
1. Go to [exact menu].
2. Click [exact button].
3. [What you'll see when it worked.]

## If you don't see [the option]
[The most common cause and what to do.]

## What you can't do
[Limits, in plain sentences.]

Other ways to say it: [synonyms your customers use: invoice, receipt, bill]
```

The last line is for search. Docs pages mode matches words, and AI mode picks pieces with a lexical search, so a synonym that isn't in the text doesn't exist for either of them.

## Keeping it alive

Every published article ends with "Was this article helpful?". The yes and no counts show up in the page's Share dialog. An article with lots of "no" often fails rule 2: the answer is there, but buried.

The other source is the inbox. Every time the bot hands off, it leaves an internal message in the conversation. Once a week, read the handoffs: if three people asked the same thing and the bot didn't know, that's your next article.

## What it doesn't do yet

- No report of help center searches that returned nothing.
- The help center doesn't handle translations: each article is in the language you wrote it in.
- The bot reads up to the 200 most recently edited pages (100 in Docs pages mode). A workspace with a thousand published pages leaves the oldest ones out.

The help center and the bot come with Docs and Chat, for $0 on your own server or on zerosoft Cloud.
