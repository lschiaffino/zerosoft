---
title: "Migrate from Intercom to Chat: bring your conversations"
description: "How to move from Intercom to Chat: pull the JSON from Intercom's API, what imports (people, messages, status), what doesn't, what to check first."
date: "2026-10-31"
author: "zerosoft"
tags: ["chat", "intercom", "migration", "guide"]
---

When a support team leaves Intercom, the history is what weighs the most. Every old conversation is context: what that customer asked last year, what they were promised, how it got solved. Starting from zero in a new inbox means losing that.

This guide explains how to bring that history into [Chat](/products/chat), exactly what the importer brings (we read the code), what stays behind, and the order to do the switch in. One thing up front: the Intercom import in Chat works from a JSON file rather than a direct connection, and we tested it against the examples in Intercom's documentation, not a live account. That's why this guide keeps telling you to run a small test first.

## What you need

- **An Intercom access token.** Per [Intercom's documentation](https://developers.intercom.com/docs/build-an-integration/learn-more/authentication), when you create an app on your workspace in the Developer Hub, the token shows up under that app's Configure › Authentication.
- **A widget in Chat.** Imported conversations are stored in a widget. If you don't have one yet, create it first.
- **Workspace admin rights** in zerosoft.
- **A terminal** with `curl` and `jq`, or any language that can make HTTP requests. This is the only technical part.

## Step 1: get the JSON out of Intercom

Chat reads the format Intercom's API returns when you fetch a conversation: `GET /conversations/{id}`. That request includes the first message and the conversation parts. The list endpoint (`GET /conversations`) gets you the IDs, but Intercom's documentation says it leaves the parts out, so you need to fetch each conversation on its own. Intercom also notes that its API returns at most the 500 most recent parts of a conversation.

A minimal example for one page of the list:

```bash
TOKEN="your_access_token"
curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" \
  "https://api.intercom.io/conversations?per_page=50" | jq -r '.conversations[].id' > ids.txt

while read id; do
  curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" \
    "https://api.intercom.io/conversations/$id"
done < ids.txt | jq -s '.' > intercom.json
```

The list is paginated: to get everything, repeat the first request with the cursor Intercom returns and collect the IDs. Chat accepts an array of conversations, an object with `conversations` or `data` inside, or a single conversation.

Two limits on Chat's side: **up to 4 MB per file** and **2,000 conversations per file**. If your history is bigger, split it into several files and upload them one at a time.

## Step 2: import into Chat

1. In Chat, go to **Reports** and click **Import conversations** in the page header.
2. Under **Into widget**, pick where the conversations go.
3. Under **JSON file**, upload the file and click **Import**.

When it's done you'll see how many conversations came in, how many were already there and how many messages were imported. If any failed, they're cleaned up and you can retry by uploading the same file again. Nothing that already came in gets duplicated.

## What gets imported

For each conversation:

- **The person**: name and email of the contact (or of the first message's author, when that's the customer). Values that don't look like an email are dropped.
- **The subject**, if the conversation had one, or its title.
- **Messages in order**, with their dates. Anything written by a contact, lead or user is marked as the visitor's; everything else counts as a team reply.
- **The status**: open if it was open in Intercom; any other state comes in as resolved.
- **An `import-intercom` tag** on every conversation, so you can find and separate them in the inbox.

Imported conversations don't trigger rules, the bot or webhooks. And imported people don't get campaigns until an admin marks their consent on their profile.

## What doesn't get imported

- **Internal notes.** The importer skips them on purpose.
- **Attachments and images.** Intercom sends messages as HTML; Chat keeps the text.
- **Who replied.** Team replies come in as the team, without the specific teammate. Bot messages land there too.
- **Assignments, status changes and snoozed conversations.** Assignments arrive as parts with no text and are skipped. A snoozed conversation comes in as resolved.
- **Intercom tags, attributes, companies and ratings.**
- **A single merged person.** Each imported conversation creates its own visitor record, even when the email repeats.
- **Help center articles, bots and rules.** Those get set up again in Chat.

## Before you swap the widget

1. **Test with a small file** of ten or twenty conversations. Open a few in Chat and compare them with Intercom.
2. **Import the rest** in batches.
3. **Load your saved replies** and the help articles the bot can use. [Help articles the bot can read](/blog/articulos-de-ayuda-que-el-bot-puede-leer) covers how.
4. **Paste Chat's widget script** into your site and remove Intercom's.
5. **Run one last export** from Intercom with the last few days of conversations and import it. Repeats are skipped.

## What Chat still lacks compared to Intercom

From the parity table, as is:

- **WhatsApp, Instagram, Messenger and SMS**: not yet.
- **Phone and voice**: not yet.
- **Native iOS and Android apps for the team, and a mobile messenger SDK**: not yet.
- **App store**: none. Intercom has over 450 apps.
- **Multilingual, private or custom-domain help center**: not yet.
- **Inbound email, tickets, visual workflows, multi-brand and SSO**: partly covered. For example, Track issues act as tracker tickets, but there are no ticket types or customer ticket portal.
- **Email campaigns**: plain text only, to people with consent, with a daily cap.
- **Priorities**: four levels; Intercom has five.
- **Messenger languages**: 15, against about 45 in Intercom.
- **The import itself**: no direct connection, attachments or internal notes.

The full table is at [/compare/zerosoft-vs-intercom](/compare/zerosoft-vs-intercom).

## What it costs

Intercom starts at around $29 per seat per month, so a team of ten pays $3,480 a year. Chat on your own server costs $0, with the core under AGPLv3. On zerosoft Cloud you start on a free plan and then pay for usage. Seats aren't charged, so adding someone to support doesn't change the bill.

For the day-to-day comparison before you move, read [Chat vs Intercom](/blog/zerosoft-chat-vs-intercom).
