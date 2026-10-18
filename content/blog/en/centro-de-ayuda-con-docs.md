---
title: "A help center for your customers, built with Docs"
description: "How to set up a public help center with Docs: collections, articles that search can find, the Was this helpful vote, the Help tab in the Chat widget and AI answers. With the limits in plain view."
date: "2026-10-18"
author: "zerosoft"
tags: ["docs", "chat", "playbook"]
---

Notion has a guide on [building a help center in Notion](https://www.notion.com/help/guides/how-to-build-a-help-center-in-notion): start from a template, add articles as subpages, format them with callouts and publish the page to the web. It works, and what you get is a public Notion page.

A help center needs more than public pages, though. Customers have to find the answer before they write to support, the team has to know which articles aren't working, and the same information has to reach the chat. Docs has a help center of its own that covers those three things, and this post walks through setting it up.

## What the Docs help center is

Every workspace gets a help center at `zerosoft.ai/h/<your-handle>`, or on your installation's domain if you self-host. Only the Docs pages you've published show up there. Everything else stays internal.

What it includes:

- **A home page** with a search box ("How can we help?") and your collections with their article counts.
- **Articles** in read-only mode, with the collection breadcrumb, the last-updated date, an "On this page" table of contents built from the article's headings, and previous/next links within the collection.
- **"Was this article helpful?"** at the bottom, with one vote per visitor per article.
- **Metadata** for search engines and social previews: the article title with the workspace name, and the opening text as the description.
- **Your Chat widget's color** as the accent, so the help center and the chat look like the same brand.

## Step 0: the handle

The help center uses the same handle as your Cal booking pages. If you haven't set one, the Share panel tells you: "Set your handle in Calendar to get a help center." Pick something short with the company name in it, because it'll be in every link you send customers.

## Step 1: collections

Docs builds the structure from your page tree with one rule: **a published page whose parent isn't published is a collection**, and the published pages under it are its articles.

In practice, the tree looks like this:

- **Help center** (not published: just an internal folder)
  - **Getting started** (published: collection)
    - Create your account
    - Invite your team
  - **Billing** (published: collection)
    - Change your payment method
    - Download an invoice
  - **Troubleshooting** (published: collection)

Five or six collections are enough to start. The opening line of each collection becomes its description on the home page, so write one sentence that says what's inside: "Paying, changing plans and getting invoices."

Articles appear in tree order, so create them in the order you want them read.

## Step 2: articles people can find

The help center search looks at the title and the full text of every published article, and it tolerates variants of a word: "refund" finds "refunds" and "invoice" finds "invoicing". It still pays to help it along:

- **Title the article with the customer's question.** "Change your payment method" beats "Billing management".
- **Answer before the first heading.** The text before the first heading is the summary that shows up in search, in the collection and on Google (it's cut at 160 characters).
- **Use headings inside the article.** With two or more, the article shows the "On this page" index.
- **One article, one task.** If an article answers three questions, it's three articles.

A template that works for almost everything:

```
[The answer in one or two sentences.]

## Step by step
1. ...
2. ...

## If it doesn't work
- A common cause and how to fix it.

## Related
- Public link to another article
```

What the Docs editor has today: headings, lists, to-dos, quotes, code blocks, tables and dividers. What's missing for a help center: inline images, callouts and embedded video. If a step needs a screenshot, for now describe it with the exact words from the interface ("click **Share**, then **Publish to help center**").

## Step 3: publish

Open the page, click **Share** and turn on **Publish to help center**. That's also where you copy the public link. Each page is published on its own: publishing a collection doesn't publish its children, so you can keep drafts inside a public collection.

Each article's link is built from its title the first time you publish it, and it doesn't change after that, even if you edit the title. Links you've already sent customers keep working.

## Step 4: let the chat use it

This is where it differs from a standalone public page. If you use Chat:

- **The widget's Help tab.** In the widget settings, turn on **Show help tab**. The widget adds a tab with your published articles and suggests them while the visitor types their question. If an article answers it, the conversation isn't needed.
- **Bot answers.** The auto-reply bot and Chat's agents use your published pages to answer. You can also give them internal pages without publishing them: in Share, turn on **AI can use it**. That's useful for answers your team wants in the chat but not on the help center.

With AI configured, the model reads the pages it finds. Without AI, the bot replies with an excerpt from the best-matching page. Either way, the short, well-titled articles from step 2 make for better answers.

We've written separately about [setting up support SLAs with Chat](/blog/slas-de-soporte-con-chat), and the two fit together: every question the help center answers is one less conversation in the queue.

## Step 5: keep it alive

Help centers go stale fast. Three habits:

1. **Watch the votes.** The Share panel of every published article shows how many people found it helpful and how many didn't. An article with more "no" than "yes" gets rewritten that week.
2. **Write from the chat.** When the same question comes in through Chat three times, it becomes an article. Use the customer's words in the title.
3. **Review on every product change.** Docs keeps a version history for every page (an automatic one at most every 5 minutes while you edit, plus the ones you save by hand, up to 50), so you can rewrite freely and roll back if you need to.

## What it doesn't do yet

So you can decide with everything in view:

- **Custom domain.** On zerosoft Cloud the help center lives under `zerosoft.ai/h/`. There's no `help.yourcompany.com` yet.
- **Images, callouts and video** inside articles.
- **Multiple languages** for the same article. You can keep separate collections per language, but there's no language switcher.
- **Search analytics**: you can't see what visitors searched for and didn't find.

If you need a documentation site with your own design, a published Notion site or a dedicated docs tool will give you more control. If what you need is customers finding answers and a chat that replies with the same information, the Docs help center already does that, on your own server for $0 or on zerosoft Cloud.
