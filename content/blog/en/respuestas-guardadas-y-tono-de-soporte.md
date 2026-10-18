---
title: "Saved replies: five tone rules and twelve support templates"
description: "How to turn a support tone guide into rules you can check line by line, plus twelve saved replies ready for Chat, with the automatic actions worth attaching to each one."
date: "2026-10-18"
author: "zerosoft"
tags: ["chat", "support", "templates", "playbook"]
---

Saved replies have a bad reputation because so many of them sound robotic. They sound that way when nobody checked them against a clear idea of how the team wants to sound.

Intercom published [PREACH](https://www.intercom.com/blog/preach-framework-for-customer-support-tone/), the tone framework its support team uses to review conversations: six traits (proud, responsible, empathetic, articulate, concise, human). It's a good list for peer review. At 6 p.m., with thirty open conversations, an adjective doesn't help much. This post turns tone into five rules you can check sentence by sentence, and gives you twelve saved replies written with those rules, ready to load into Chat.

## Five rules you can check

1. **Name the next step and when.** "I'll look into it and write back before 5 p.m." can be kept or broken. "We're looking into it" can't be measured.
2. **Say what you did.** "I tried it on your account and reproduced the error" informs. "We understand your frustration" adds nothing for anyone.
3. **One question per message.** If you need three details, ask in a numbered list and say what each one is for.
4. **One apology, a specific one.** "Sorry, the double charge was our mistake" once. Three "sorry for the inconvenience" in a row sound scripted.
5. **Promise only what you control.** If the fix depends on another team, promise the next update. That team owns the date of the fix.

Before saving a reply, run it through all five. If it fails one, rewrite it.

## How they work in Chat

- Each widget has its own list of **saved replies**: name, shortcut (derived from the name) and text.
- In a conversation, type `/` and part of the shortcut or name, pick from the list and the text drops into the reply box. You can edit it before sending.
- Under **Automatic actions (Advanced)**, each reply can change the conversation's status (open, pending or resolved), assign it to someone or to whoever uses it, add tags or snooze it for some hours. The actions run when you send, not when you pick the reply: if you change your mind and send nothing, the conversation stays as it was.
- A saved reply sent by a person counts as the first response for the SLA. The bot's doesn't (we explain it in [support SLAs in Chat](/blog/slas-de-soporte-con-chat)).

Two cautions. Saved replies don't have variables yet: there's no `{{name}}`, so in the templates below the blanks go in brackets and the person fills them in before sending. And the bot reads your saved replies too. In "Saved replies" mode (and in AI mode when the model fails) the bot picks the closest one to the question and sends it as is, brackets included. If your bot reads saved replies, review each one assuming it may go out on its own: either write it without blanks, or switch the bot to "Docs pages" mode.

## Twelve templates

Each with its shortcut and the actions we'd attach.

**1. `/received`** (no actions)
> Thanks for writing in. I'm on it and will reply here before [time].

**2. `/need-details`** (status: pending)
> To look into this I need two things:
> 1. The email on the account.
> 2. A screenshot of what you see.
> With that I can find your case directly.

**3. `/reproduced`** (tag: bug)
> I followed the same steps and saw the same error, so the problem is on our side. I've passed it to the team that fixes it. I'll write here when there's news, even if it's just to say it's still open.

**4. `/fixed`** (status: resolved)
> It's fixed: [what changed]. If it happens again, reply in this conversation and I'll pick it back up.

**5. `/refund`** (assign to: [billing person], tag: billing)
> I'm handing you over to [name], who handles payments and can sort out the refund. They already have this conversation with the full context, so you don't need to repeat anything.

**6. `/double-charge`** (tag: billing)
> Sorry, the double charge was our mistake. I've requested a refund of [amount]; it usually shows on your statement within [the window your payment processor gives].

**7. `/not-possible`** (status: resolved)
> That isn't possible today: [specific limit]. The closest option is [alternative]. If that helps, I can send you the steps.

**8. `/request`** (tag: feedback, status: resolved)
> I've logged this as a request for the product team, with your use case. I can't give you a date. If it ships, I'll let you know here.

**9. `/waiting`** (snooze 24 h)
> I'll wait for your reply. If I haven't heard back by tomorrow, I'll write again.

The conversation is hidden for 24 hours and comes back to the inbox on its own. That way the tool owns the "I'll write again".

**10. `/escalated`** (assign to: [support lead], status: open)
> I've passed this to [name], who knows this area better. They'll write here; in the meantime the conversation stays open.

**11. `/outage`** (tag: incident)
> We have a problem affecting [which part]. We're working on it and I'll let you know here as soon as it's back. Sorry for the disruption.

**12. `/wrap-up`** (status: resolved)
> All set. If anything is unclear, reply here and we'll keep going. You'll see a one-question survey; it tells us what to improve.

The last one sets up CSAT: when a conversation is resolved, the widget asks the visitor for a 1 to 5 rating with an optional comment.

## Keeping them sharp

Half an hour a month is enough:

1. **Read ten random resolved conversations.** Check the five rules against what was actually sent: a template edited in a hurry tells you more than the original.
2. **Read the low CSAT comments.** If two mention the same reply, rewrite it.
3. **Delete the ones the team stopped using.** A list of 80 replies means nobody finds the right one with `/`.
4. **Check the tags.** If `/reproduced` adds `bug`, filtering by that tag tells you how many errors people reported this month.

## What it doesn't do yet

- Saved replies have no variables or auto-filled fields.
- They're per widget. With two widgets, each one has its own list.
- No suggested replies or AI rewriting inside the inbox.

Chat runs for $0 on your own server, or on zerosoft Cloud with no per-seat charge.
