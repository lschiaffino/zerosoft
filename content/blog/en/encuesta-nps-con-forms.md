---
title: "NPS survey in Forms: template, logic and how to read it"
description: "How to build an NPS survey in Forms with the built-in template: a 0 to 10 question, follow-ups by score, hidden fields and how the result is calculated."
date: "2026-11-15"
author: "zerosoft"
tags: ["forms", "typeform", "guide"]
---

An NPS survey has one question: how likely are you to recommend the product, from 0 to 10. The number alone says little. The useful part comes next, when you ask why and someone on the team reads the answer.

Typeform has [a guide on NPS](https://www.typeform.com/guides/net-promoter-score) that explains the scale and recommends closing with a "why". This is the Forms version, zerosoft's forms app: what the template includes, how to adjust it and how to read the result without a separate spreadsheet.

## The math, with numbers

Answers of 9 and 10 are promoters, 7 and 8 are passives, 0 to 6 are detractors. NPS is the percentage of promoters minus the percentage of detractors, from -100 to 100.

A made-up example to see the mechanics: 50 responses, 25 promoters, 15 passives and 10 detractors. Promoters 50%, detractors 20%, NPS 30. Passives add nothing and subtract nothing, but they count in the total.

Forms uses those same cutoffs and shows the result in the **Summary** tab: the score plus how many promoters, passives and detractors there are. It is calculated over completed responses.

## Step 1: start from the template

In Forms choose **New form** and, under **Start from**, the **NPS survey** template. Turn on **With logic** if you want the rules prebuilt. Name it, pick the form language and click **Create form**.

The template has four questions:

1. The score question, required, on a 0 to 10 scale with "Not likely" and "Very likely" at the ends.
2. A long text for anyone who answered 6 or less: "Sorry to hear that. What should we fix first?"
3. Another for 7 or 8: "What would make it a 10?"
4. Another for 9 or 10: "Great! What do you like most?"

At the end there is an optional email field so you can follow up. The template logic sends each person to their follow-up question, then everyone converges on the email.

## Step 2: understand the logic so you can change it

Open the **Logic** tab in the editor. You will see rules on the score question, evaluated in order:

- If the score **is at most** 6, jump to the detractor question.
- Otherwise, if the score **is at most** 8, jump to the passive question.
- Otherwise, always: jump to the promoter question.

Jumps only go forward, so question order in the **Questions** tab matters: the three follow-ups must come after the score.

A variant that suits small teams: if you only care about understanding detractors, send passives and promoters straight to a thank-you ending and spare them a question. With **Add rule** and the **jump to** action pointing at an ending, you do it without code.

If you want an NPS scale in a question of your own, in **Questions** pick an opinion scale and check **Net Promoter Score (0 to 10)**. That fixes the range at 0 to 10 and makes the Summary compute the score.

## Step 3: know where each response comes from

A single global NPS hides a lot. To split by plan, channel or campaign, use **Hidden fields**: comma-separated names that Forms reads from the link. If you add `plan` and `source`, you send the link as `/f/your-form?plan=pro&source=email` and every response stores those values next to the answers. They also travel in the webhook.

A concrete use: in the post-purchase follow-up email, build the link with each customer's plan. Then filter the responses and compare.

## Step 4: notifications and automation

In the form's **Settings**, **Notifications** lets you alert people in the workspace inside zerosoft and send an email to up to 10 addresses. That is enough for support to see every new response right away.

To go further, each response fires the `forms.response.submitted` event in Flow, and the form can have a webhook signed with the `Zerosoft-Signature` header. A typical use: a flow that, on a score of 6 or less, creates a follow-up task so someone writes to the customer this week.

## Step 5: share it

The **Share** tab has the public link, an iframe, an inline embed that grows with the form and a popup button. There is also a QR code you can print. You can close the form by date or by number of responses, handy for a time-boxed survey.

## How to read the result

- Read the comments before the number. Three detractors saying the same thing are worth more than a point of NPS.
- Compare against yourself, month over month. An isolated NPS means little without a reference.
- With few responses the score jumps. With 20 responses, a single detractor moves the result 5 points.
- Check drop-off per question in the Summary: if many people leave at the long text, shorten it or make it optional.

## What it still lacks

Forms does not yet have A/B tests, tags on responses or payments inside the form. There is no native Google Sheets integration: the webhook and Flow cover that. The public Forms API is read only. There is no custom domain for forms either.

## Cost

Self-host at $0 under AGPLv3, with every Forms feature. On zerosoft Cloud there is a free plan to start and then you pay for usage; seats are not charged, so adding a support person to read responses does not change the bill. More in [Forms](/products/forms) and the [Typeform alternative](/compare/typeform-alternative).
