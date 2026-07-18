---
title: "Bitly charges $35. Bits are free."
description: "We break down Bitly's paid plan item by item and set it next to the real cost of serving redirects. The gap isn't engineering — it's margin."
date: "2026-06-26"
author: "Zerosoftware"
tags: ["bitly", "link", "pricing"]
---

Open Bitly's pricing page. The Core plan: $35 a month, billed annually. What exactly are you buying with that? We went through the list item by item, calculator in hand. Spoiler: the technology on that list costs less than the coffee you're drinking.

## What the $35 buys, item by item

- **Around 1,500 branded links per month.** A link is a row in a table: slug, destination URL, date, flags. ~100 bytes. The month's 1,500 rows are 150KB — smaller than a photo from your phone. Marginal cost: $0.
- **Unlimited redirects.** Each click is a `SELECT`, an `INSERT`, and a ~300-byte 302 response. It's the lightest workload on the web. A million redirects a month move under 1GB of traffic. Pennies, being generous.
- **QR codes.** An SVG or PNG generated on the fly from the link's string. There's no compute or storage worth mentioning. Cost: $0.
- **Click analytics.** Counts per day, referrer, country, device. Each click is a ~200-byte row. A hundred thousand clicks a month for a year: 240MB of disk. A $5 VPS ships with 25GB.
- **Your own domain.** Note: you register it yourself, with a registrar, for about $10 a year. Bitly doesn't pay a cent of that.
- **UTM builder.** A form that concatenates strings with `?utm_source=...`. That's literally it.

## The math that doesn't add up

Total infrastructure for a heavy user: under $1 a month. We already ran the full numbers, line by line, in another post.

$35 divided by $1 is a 3,400% margin. That's not a technology price; it's the price of having no alternative. The remaining $34 pays for the sales team, the ads that brought you there, and a twenty-year habit that "branded links cost money".

> When something costs 35 times its cost, you're not buying technology. You're buying habit.

## The alternative already exists

**Link** is our shortener: custom aliases, analytics by day, referrer, country, device, browser and OS — no cookies — QR in SVG and PNG, password-protected links, expiration, max clicks, tags, a UTM builder and a public API with API keys. Everything on Bitly's checklist, and more.

The code is open: download it and run it on your VPS. Self-hosted, it costs $0, forever. And if you'd rather we run it for you — login, backups, uptime — you pay what the cloud costs. At cost. No margin.

Bitly charges $35. Bits are free. Now links are too.
