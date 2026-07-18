---
title: "Your contacts are yours, not HubSpot's"
description: "HubSpot charges you more the bigger your database gets. But a contact is a row that costs bytes to store. Your contacts are yours — and leaving should take minutes, not a migration project."
date: "2026-06-19"
author: "Zerosoftware"
tags: ["crm", "hubspot", "lock-in", "open source"]
---

Look at your HubSpot invoice. If your company is doing well, it went up. Not because you use more features — because you collected more contacts. You did your job right: more people know you, more people gave you their email. The reward is a bigger monthly bill. It's the only business where having more customers of your own costs you extra.

## The contact tax

A contact is a row in a table: name, email, phone, company, a few dates. A few hundred bytes. A hundred thousand contacts take up about 50MB of disk. A $5 VPS ships with 25GB — room for the databases of five hundred companies.

Now look at the pricing page: Marketing Hub Professional starts at around $890 a month and includes 2,000 marketing contacts. Went over? Extra contacts come in paid bundles. Your invoice is indexed to the size of your own database. You're not paying for technology — you're paying rent on your own data, and the rent goes up every time business goes well.

> When your bill grows with your contacts, you're not buying software. You're paying a toll to talk to your own people.

## The real lock-in isn't the CSV

Yes, HubSpot lets you export a CSV of names and emails. That's not freedom; it's a courtesy. What the CSV doesn't carry is the memory:

- **The history**: which emails each contact opened, which pages they visited, which campaign brought them in. The full timeline of the relationship.
- **The associations**: which contact belongs to which company, which deals they were part of, which tickets they opened.
- **The workflows**: the sequences, the nurtures, the automations you built over years. Those don't export — they get rebuilt, by hand, on the other side.

You can leave, but you leave without your memory. The honest test is this: can I walk out in 10 minutes with everything, not just the list? If the answer is no, your contacts aren't yours. They belong to the CRM, and you're renting them back.

## What we're building

Our CRM ships in Q1 2027, born with the same rules Link already runs on:

- **API-first**: the public API is documented on day one, same as Link's v1 API. Anything the interface does, curl does.
- **Full export, always**: JSON, CSV or API. Everything, history included. No permission needed, no support ticket.
- **Unlimited contacts**: because a contact is a row and rows cost nothing. Your bill doesn't grow when you do.
- **The same contract as always**: open code, self-host for $0 on your VPS, or hosted cloud at the real cost of infrastructure.

Meanwhile, Link is live today — short links, cookie-less analytics, QR codes, an API documented at /docs — and it runs on exactly this principle: your data leaves as easily as it arrives.

Your contacts are yours because the relationships are yours. A CRM should be a tool you use, not a vault that charges you to look at what's yours.
