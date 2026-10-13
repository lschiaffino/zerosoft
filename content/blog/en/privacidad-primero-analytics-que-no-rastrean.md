---
title: "What zerosoft collects, and what it doesn't"
description: "Link stores the country, referrer and device of a click, never the IP address or a cookie. What we record, what we leave out, and why."
date: "2026-06-01"
author: "zerosoft"
tags: ["privacy", "manifesto", "analytics", "open source"]
---

The modern web runs on a silent trade: the software is "free", and in exchange it watches you. Every click, every scroll, every second on a page ends up in a database you've never heard of, merged with your history from a thousand other sites, sold to third parties you've also never heard of. That's the business model of most of the web.

zerosoft works the other way. This post lists what we don't collect, what we do, and why.

## What we do NOT collect

The list of things we don't do matters more than the list of things we do:

- **We don't store IP addresses.** Not whole, not hashed. An IP is a personal identifier; if you never store it, you can't leak it or sell it.
- **No tracking cookies.** Not ours, not anyone's. That's why Link needs no consent banner: there's nothing to consent to.
- **No fingerprinting.** No canvas tricks, no installed-font probing, no exotic attribute combinations to recognize you across sessions.
- **No cross-site tracking.** Our analytics see a click, not a user. "User profiles" don't exist in our database because we never created that table.
- **We don't sell or share data.** With anyone, ever. No "trusted partners", no asterisks.

## What we do measure (and why it's enough)

Link's analytics answer the questions a link owner actually has: how many people clicked, where did they come from, on what device. For that, each click records:

- The date and time.
- The referrer (the site they came from, if the browser sends one).
- The country, resolved with a local geo database: no calls to external services.
- Device, browser and OS, parsed from the `User-Agent` header and discarded immediately: we store "iPhone / Safari / iOS", not the raw header.

Aggregated counts. You cannot identify a person from that data, which is precisely the point. We designed the schema so that not even we could track you if we wanted to. Privacy that rests on promises is fragile; privacy that rests on architecture isn't.

## Software that works for you, not on you

A hammer doesn't report back to the factory every nail you drive. A spreadsheet shouldn't report the numbers you type into it. For twenty years we accepted that our tools spy on us because "that's how they pay for themselves". False: they're funded that way because it's more profitable, not because it's necessary.

Our model doesn't need your data. The code is open source: you can audit exactly what gets stored and what doesn't. You don't have to trust us, you can read it. You can self-host on a $5 VPS and your data never leaves your machine. Or use our hosted cloud and pay the real cost of the infrastructure. None of those three paths involves monetizing your behavior.

## The principles

1. **Collect the minimum.** If a data point isn't essential for the tool to work, it isn't stored.
2. **Impossible by design.** What isn't stored can't be leaked, sold, or subpoenaed.
3. **Verifiable, not trustworthy.** Open code, always. Privacy you can't audit is marketing.
4. **Your data is yours.** Export is part of every product, not an add-on.

We made privacy an architecture decision on day zero, not a feature added later to satisfy a regulation.
