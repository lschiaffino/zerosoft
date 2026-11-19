---
title: "Abandoned carts: how to win them back from Shop without another email tool"
description: "What Shop saves when someone leaves checkout, how to see and recover those carts, when to turn on the reminder, and what it can't do yet."
date: "2026-11-19"
author: "zerosoft"
tags: ["shop", "ecommerce", "abandoned carts"]
---

Someone lands on your store, picks two products, types their email at checkout and leaves. It happens in nearly every small store, and each of those people already did the hard part: they found you and decided what they wanted. Winning back even a fraction of those orders pays better than chasing new traffic.

Shopify has a [guide to abandoned cart emails](https://www.shopify.com/ca/blog/abandoned-cart-emails) that covers how to write them and when to send them. It is a solid base if you already run on Shopify. Here is the Shop version, zerosoft's online store app: what it saves, how to recover a cart by hand, how to turn on the automatic reminder, and what it doesn't do yet. Everything below comes from the code, which is open.

## What Shop saves when someone leaves

As soon as a person types their email at checkout, Shop stores a row with the cart: products, quantities, subtotal and currency. It stores no address and no payment data, because at that point none has been entered.

There is one row per store and per email. If the same person comes back and changes the cart, the row is overwritten with the newest version instead of piling up duplicates. If the cart ends in an order, the row flips to "recovered" and stops showing as abandoned.

A checkout counts as abandoned only after an hour without changes. Before that, the person may just be looking for their card. Rows are deleted after 30 days.

## Step 1: look at the list

Open **Abandoned carts** in Shop. Each row shows the customer, the item count, the subtotal, the last activity and the status: not recovered, reminder sent, asked not to receive, or recovered (with a shortcut to the order).

While the automatic reminder is off, the list still works. Each cart has a button to copy its recovery link so you can send it yourself through whatever channel you already use with customers: a WhatsApp message, an email from your own inbox, a reply in Chat. There is also a button to send the reminder by hand, with the same text and the same caps as the automatic one, once per checkout.

The link opens the store with the cart rebuilt the way the person left it. It carries a long random token and only works while the cart is still open. Once the order is completed, it stops working.

## Step 2: decide whether to turn on the reminder

Store settings have two options:

- **Send a reminder to people who leave checkout.** Off by default.
- **Hours to wait.** Between 1 and 72, default 4.

The reminder goes out from a cron job, not from your inbox, and only if the store is published. These are the rules the code enforces, all fixed:

1. **One email per checkout.** Even if the person changes the cart five times, they get one.
2. **An unsubscribe link** in the body plus the `List-Unsubscribe` header with one-click opt-out. Anyone who opts out is excluded from that store's reminders.
3. **A cap per recipient:** two reminders per week from the same store and three per day across all zerosoft stores.
4. **A cap for new stores:** during the first 7 days there is a lower daily limit (10 reminders per day).
5. **No retry loops.** If sending fails or a cap blocks it, it is not retried: a reminder that arrives late no longer helps.

The caps exist because anyone can type any address into a checkout, and the email goes out under the app's sender. Without limits, a freshly created store could be used to send mail to strangers.

## How long to wait

We have no data of our own to give you an ideal number, and we won't make one up. What you can reason from your own case:

- **Quick-buy products** (accessories, food, gifts): one to four hours. Intent is still fresh.
- **Considered purchases** (furniture, equipment, courses): 12 to 24 hours. The person may be comparing or checking with someone.
- **If you sell over WhatsApp or handle orders yourself:** leave the automatic reminder off and write by hand to the highest-value carts.

Start with the default 4 hours and look at the recovered carts after a week or two. If almost nobody comes back, try 24.

## A workflow you can run today

A five-minute daily routine for a small store:

1. Open the abandoned carts list.
2. Write to the three or four highest-value carts yourself (the subtotal is on each row) with the recovery link. A short message is enough: "We saw you left your order half done. We saved your cart here: [link]. If anything went wrong with payment or shipping, tell us."
3. Leave the automatic reminder for everyone else.
4. Each week, note how many carts moved to recovered and which of those you had written to yourself.

Each paid order creates or updates the contact in the CRM and logs the order on its record, so you can see what the people who came back ended up buying.

## What it doesn't do yet

So you don't build a strategy on something that doesn't exist:

- **The email text is fixed.** There is no editable template, and you can't add a discount or code to the reminder.
- **It is a single reminder.** No sequences of two or three emails.
- **No automatic SMS or WhatsApp** for carts. You copy the link and send it by hand.
- **No segmentation** by cart value or by new versus returning customer.

If you want a discount in a second message, today you do it by hand: create a discount code in Shop and send it with the recovery link from your own inbox.

The parity table against Shopify on the Shop page marks these points as partial, with a review date.

## Why we built it this way

A separate email tool for abandoned carts usually means another account, another invoice and your customers' data sitting with a third party. In Shop the cart, the customer and the order live in the same database. If you self-host, that database is on your server and the software costs $0.

And the per-recipient caps, which can look like a restriction, are the part we think is right: a useful reminder is one email, not five.
