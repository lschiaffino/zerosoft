---
title: "What happens to your short links if the shortener shuts down"
description: "What the goo.gl and Firebase Dynamic Links shutdowns left behind, and a four-step plan so your short links outlive any provider: your own domain, export, re-import and self-hosting."
date: "2026-10-18"
author: "zerosoft"
tags: ["link", "domains", "migration", "open source"]
---

In 2024 Google [announced](https://developers.googleblog.com/en/google-url-shortener-links-will-no-longer-be-available/) that `goo.gl` links would stop resolving on August 25, 2025. After the backlash it [partly reversed course](https://ppc.land/google-changes-course-on-goo-gl-shutdown-preserves-actively-used-links/): links with recent activity were kept, and the ones its own criteria flagged as inactive were switched off. Google never published those criteria. On the same day [Firebase Dynamic Links](https://firebase.google.com/support/dynamic-links-faq) also ended, the product Google had pointed people to as the replacement.

Look at what the owners of those links could do about it: nothing. A PDF from 2017, a YouTube description, a printed flyer. The destination still existed and the page was still up, yet the link broke because the domain in the middle belonged to someone else.

This post is a plan to keep that from happening to you, with any shortener. At the end we cover how Link meets it and which part it doesn't yet.

## The real issue: who owns the domain

A short link has two parts: the domain (`goo.gl`, `bit.ly`, `go.yourcompany.com`) and the slug (`/promo`). Whoever controls the domain's DNS decides where each visit goes. If the domain belongs to the provider, so does the link, even though you created it and even though you pay every month.

With your own domain the situation flips. If you switch tools tomorrow, you point the DNS at the new one, load the same slugs, and `go.yourcompany.com/promo` keeps working. Nobody holding the printed link notices.

## The plan in four steps

### 1. Every link meant to last goes on your domain

Use the provider's domain for throwaway links: something you paste in a chat today that nobody opens a year from now. Everything else (print, QR codes, documents, email signatures, video descriptions, your Instagram bio) goes on a subdomain you own, like `go.` or `l.`.

In Link you set it up under **Domains**: add the host, create the DNS record and Link verifies it. Each domain has its own slugs, so `go.yourcompany.com/promo` and `go.otherbrand.com/promo` can point to different places. The DNS walkthrough is in [this post](/blog/dominios-propios-dns-paso-a-paso).

One detail that often gets missed: the root. `go.yourcompany.com/` with no slug gets visits too (people trim the end of a link to "see what's there"). Under Domains you can set where that root redirect goes. If you set nothing, it goes to the zerosoft home page.

### 2. A list you can take with you

If the provider shuts down, you need two columns per link: the short URL and the destination. Without them, rebuilding hundreds of links is archaeology.

The test is simple: can you download that list today, complete, in a file a spreadsheet can open? In Link it lives in **Settings**, in the **Export links** section:

- **Links CSV:** `short_url, slug, domain, url, title, tags, clicks, archived, expires_at, max_clicks, created_at`. One row per link, every link in the workspace.
- **JSON with clicks:** the links plus each click with date, referrer, country, device, browser and OS, up to the 100,000 most recent clicks.

Download it once a month and keep it with the rest of your backups. It's a small file.

### 3. Somewhere to move to

The list only helps if another tool can read it. Link's importer (under **Import**) accepts Bitly's CSV, Bitly's API with a token, or a CSV from any shortener. It looks for a destination column (`long`, `destination`, `original`, `target` or `url`), a short URL column (`short`, `bitlink`, `link`), and optionally title and tags.

What matters is that it keeps the slug. If the short URL was on a domain you've already verified in Link, the link lands on that domain with the same slug, so it keeps working once you move the DNS. If the slug is taken, the report tells you which ones were renamed. The limit is 2,000 links and 5 MB per upload; split the file for more.

The CSV Link exports has `short_url` and `url`, so the same file can be imported into another Link instance.

### 4. A plan B that depends on nobody

The last scenario is the awkward one: what if we are the ones who shut down? That's what the license is for. Link's code is AGPLv3 and lives on [GitHub](https://github.com/lschiaffino/zerosoft). You can run it on a VPS with Docker ([guide](/blog/self-hosting-con-docker-paso-a-paso)), import your CSV and point your domain at it. You end up with the same product on your own database.

## What doesn't travel in a move

Better to know before you need it. The import creates new links with destination, slug, title and tags. This stays behind:

- **Click history.** The JSON has it, but the importer doesn't load it. Keep it as a file if you need it for reports.
- **Passwords, expiry dates and click limits.** You set them again on the links that used them. The exported CSV includes `expires_at` and `max_clicks` so you know which ones; passwords aren't exported.
- **Targeting and redirect type.** Country and device destinations, A/B splits and 301s are configured again.
- **Links on the provider's domain.** A `bit.ly/xyz` is still Bitly's. You can import the destination and create a new link on your domain, but the old link keeps pointing wherever Bitly decides.

## A ten-minute checklist

Run it against whatever tool you use today, ours or not:

1. How many of your printed or embedded links use the provider's domain? Those are your exposure.
2. Do you have your own subdomain set up? If not, that's step one, and it takes an afternoon.
3. Can you export every link with short URL and destination? Try it now and open the file.
4. Is there at least one other tool that can import that file and keep the slugs?
5. Does the QR code you printed point to your domain? In Link, the QR code encodes the link's short URL (with `?qr=1` so scans are counted separately), so if the link is on your domain, so is the QR code.

If all five are yes, a provider shutting down becomes an afternoon's chore. The post on [moving from Bitly to Link](/blog/migrar-de-bitly-a-link) has the importer details if you want to start there.
