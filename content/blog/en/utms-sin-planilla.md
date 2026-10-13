---
title: "UTMs without the spreadsheet: a naming convention for small teams"
description: "A short UTM naming convention, and how to run it in Link with the UTM builder, tags, bulk create, per-link CSV export and 7/30/90-day comparisons."
date: "2026-09-03"
author: "zerosoft"
tags: ["link", "utm", "marketing"]
---

Every small team has the same spreadsheet. It's called something like `UTMs FINAL v3`, it has a tab per quarter, half the rows say `Facebook` and the other half `facebook`, and the only person who understands it is on vacation.

The spreadsheet exists because UTMs need two things nobody enforces: a naming convention and a single place where links get made. This post gives you a convention short enough to remember and shows how to run it inside Link, so the "single place" is the tool you already use to shorten links.

## First, what UTMs are for (and what they aren't)

UTM parameters are for **your website's analytics**: GA, Plausible, Matomo, whatever reads `utm_source`, `utm_medium` and `utm_campaign` off the landing URL and groups visits.

Link's own analytics don't need UTMs. Every short link already counts its clicks by day, referrer, country, device, browser and OS, [without cookies](/blog/analytics-sin-cookies). So you get two complementary views: Link tells you how many people clicked each link; your site analytics tell you what those people did after landing. The UTMs are the glue between them.

## The convention: three fields, lowercase, no exceptions

Here's a convention that fits on a sticky note. Adapt the vocabulary, but keep the rules.

**`utm_source`: who sent the traffic.** The specific platform or property: `newsletter`, `linkedin`, `instagram`, `youtube`, `partner-acme`.

**`utm_medium`: what kind of channel.** A short, closed list: `email`, `social`, `paid-social`, `cpc`, `referral`, `print`. If you're about to invent a new medium, you probably meant a new source.

**`utm_campaign`: what you're pushing, with a date.** `2026-09-launch`, `2026-10-webinar-pricing`. The date prefix sorts them and ends the "which launch?" question.

And the rules:

1. **Lowercase everything.** Most analytics tools treat `LinkedIn` and `linkedin` as two different sources. Link stores exactly what you type, so the discipline is on you.
2. **Hyphens, not spaces.** Spaces turn into `%20` or `+` and nobody wants to read that in a report.
3. **No free text.** If a value isn't in the list, add it to the list first. The list lives in the doc your team already reads, not in a spreadsheet of links.

Need `utm_content` or `utm_term` for A/B variants? Link's builder only has fields for source, medium and campaign, but nothing stops you from writing `?utm_content=variant-b` into the destination URL yourself. The builder adds its three parameters on top without touching the ones already there.

## Making a link with the builder

In **New link**, paste the destination and open the **UTM builder**. Fill source, medium and campaign; the **Final URL** preview shows exactly what the destination will be. Then:

- **Title:** something a human can read in a list. "Sept launch: LinkedIn post".
- **Tags:** the campaign name, e.g. `2026-09-launch`. Up to five tags per link, so you can add the channel or the owner too.
- **Custom slug** if the link is going somewhere people will type it, like a slide or a podcast.

The UTMs are baked into the destination when the link is created. If you later need to change them, edit the destination URL: the short link stays the same, which matters if it's already in the wild.

## Bulk: one campaign, many links

Launches rarely need one link. A newsletter has eight, a partner kit has twenty. **Bulk create** takes up to 200 URLs, one per line, and applies a **common tag** and a **common UTM** to all of them.

So for the September newsletter: paste the eight destinations, tag `2026-09-launch`, source `newsletter`, medium `email`, campaign `2026-09-launch`. One click, eight links with identical, correctly spelled UTMs. Hit **Download CSV** to get `original_url,short_url,status` for each line, and paste the short URLs into your email tool.

Two things to know about bulk: links get random slugs and no title (add titles afterwards for the ones you care about), and they're created on the default domain. If you want them on your [custom domain](/blog/dominios-propios-dns-paso-a-paso), create those individually or through the API, which accepts a `domain` field.

## Finding things: tags are your campaign folders

In the links list, click a tag chip to filter: every link of `2026-09-launch`, newest first, or sorted by **Most clicked**. The search box matches slug, destination and title, so searching `utm_source=linkedin` finds every LinkedIn link, because the UTMs are part of the destination.

That's the payoff of the convention: you never ask "where's the link for X?" again. You filter.

## Reading results: 7, 30, 90 days and versus the previous period

Open any link and pick a range: 7 days, 30 days or 90 days (or all time). Next to the total for the range you'll see the comparison against the **previous period of the same length**, with an up or down percentage. "30 days, ↑ 40% vs previous" answers "is this evergreen link still working?" without any math.

A routine that takes ten minutes a week:

- Filter by the current campaign tag, sort by **Most clicked**.
- Open the top three and the bottom three; check the 7-day comparison.
- Cross-check in your site analytics using the same campaign value. Clicks in Link versus sessions on your site tell you where people bounce between click and landing.

## When you do need the raw data

Sometimes someone wants numbers in a report. Two exports cover it:

- **Per-link CSV:** in the click log of a link, **Export CSV** downloads every click in the selected range (optionally filtered by country) with `timestamp,country,referrer,device,browser,os`. Good for "show me exactly when this got shared".
- **Everything:** the data export in settings downloads every link as CSV (including tags, pipe-separated, and total clicks) or JSON with every click. That's your campaign rollup if your boss insists on a pivot table.

Honest gap: there's no campaign-level dashboard that adds up all links in a tag for you. Analytics are per link, plus the overview's totals and top links. If you need the tag rollup, the export (or `GET /api/v1/links/:id/stats` from a script) gets you there in a few lines.

## The whole thing on one card

- Source = platform, medium = closed list, campaign = `yyyy-mm-name`. Lowercase, hyphens.
- One tag per campaign, same as the campaign value.
- Many links? Bulk create with common tag and UTM.
- Review weekly: filter by tag, sort by clicks, check the vs-previous arrow.
- Export only when a human asks for a spreadsheet.

The spreadsheet can retire. It earned it.
