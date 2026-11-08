---
title: "A short link that doesn't work: how to diagnose it in five minutes"
description: "A troubleshooting guide for broken short links: the most common causes, how to tell them apart from the outside, and what Link shows in each case, with a checklist to copy."
date: "2026-11-04"
author: "zerosoft"
tags: ["link", "troubleshooting", "guide"]
---

A broken short link rarely announces itself. Someone printed it on a poster, someone else pasted it into an email to 2,000 people, and three days later a customer writes: "it gives me an error". Bitly has [its own guide to troubleshooting short links](https://bitly.com/blog/troubleshoot-short-link-issues/), written for its product. This is the version for any shortener, plus what Link shows in each case, because we know its code and can tell you what it actually does.

The core idea: a broken link has one of a handful of causes, and each leaves a different trace. Check them in order and the diagnosis takes five minutes.

## Step 1: test it from the outside

Before touching anything, open the link in a private window and, if you can, on a phone using mobile data. This separates two worlds:

- **It fails for everyone:** the problem is in the link (expired, archived, destination down).
- **It fails for some people:** the problem is on the path (a firewall, a cache, the domain).

If you see a zerosoft screen, good: its title tells you the exact cause (see the table below). If you see a browser error, the problem is DNS or network, and the link never reached the shortener.

## Step 2: which screen do you see?

When a Link link doesn't redirect, it doesn't leave you with a generic error. It shows one of these screens, each with its own cause:

| Screen | Cause | What to do |
|---|---|---|
| "This link is gone" | It never existed, was deleted, or is archived | Check the slug and the archive |
| "This link expired" | The **Expires on** date passed | Edit the date or create a new link |
| "Click limit reached" | **Max clicks** was hit | Raise the maximum |
| "Protected link" | It has a password | Share the password or remove the protection |
| "This link was blocked" | The destination was flagged as phishing or malware | Review the destination |

Two useful details. First, an expired link, or one with no clicks left, can send people to a fallback URL instead of the screen: each link and each custom domain supports one. If visitors land on a page you didn't expect, look at that setting. Second, the block notice exists because destinations are checked when the link is created and again every week: a clean URL today can be compromised tomorrow.

## Step 3: upper and lower case

This is the silliest cause and the most frequent when someone types the link by hand. In Link, slugs accept upper and lower case letters, and the lookup is exact: `/Promo` and `/promo` are two different links, and one of them may not exist.

What to do:

1. Open the link from the dashboard and copy the URL instead of typing it.
2. If the link goes on a poster or in a QR code, use lowercase slugs. They are easier to dictate and don't depend on anyone's memory.
3. Avoid characters that look alike when read aloud or printed: lowercase `l` against uppercase `I`, `0` against `O`.

## Step 4: the custom domain

If the link uses your own domain (`go.yourcompany.com/offer`) and fails with a browser error or lands on a zerosoft page, look at the domain, not the link. Link verifies ownership with two records: one that points the domain at the server and a TXT record at `_zerosoft-verify.<your-domain>`. While the domain is unverified, the host resolves nothing: any slug shows "This link is gone".

Checks:

- In the domains panel, confirm it shows as verified.
- If you changed DNS provider, recreate both records. Long TTLs make the change slow to show up.
- Links live inside their domain: the same slug on the default domain and on yours are separate links.

## Step 5: the destination

Sometimes the link is fine and the page it points to is not. Test the destination directly. If the site changed its structure, the old URL returns a 404 and the shortener has nothing to do with it. This is the main reason to choose a shortener where you can **edit the destination without changing the short link**: fix it once and every printed poster works again.

A practical consequence: Link answers its redirects with `cache-control: no-store`, even 301s. If you edit the destination, or archive or expire a link, the change applies on the next visit and doesn't depend on the browser cache.

## Step 6: it works for some people and not others

If the link opens at your house but not in a customer's office, suspect the firewall. Some corporate networks block entire shortener domains, and there is no fix on the link's side. What you can do:

- Use your own domain: an IT department approves it more easily than a domain shared by thousands of shorteners.
- Show the destination when you can ("docs.yourcompany.com/guide"), so someone who can't open the short link can copy the long URL.
- Send the link as text too: if it's a QR code, print the short link underneath.

## Step 7: the visits don't match what you expected

"My link has 40 clicks and I emailed 2,000 people" is almost never a broken link. Link doesn't count bots, preview generators from Slack, WhatsApp or iMessage, or HEAD requests as visits, and they don't use up **Max clicks** either. A click is a person who opened the link, and that has little to do with how many emails you sent.

To spot a real problem, look at the trend in the analytics tab. A sudden drop to zero during an active campaign does deserve the full diagnosis.

## Checklist to copy

1. Open the link in a private window and on mobile data.
2. Read the title of the screen it shows.
3. Compare the slug's upper and lower case with the one in the dashboard.
4. If it uses a custom domain, confirm it is verified and both DNS records still exist.
5. Open the destination directly.
6. If it fails only on one network, ask IT to allow the domain, or move to your own.
7. Check the click trend before calling a low-traffic link broken.

## One last habit

Every month, open your ten most used links. It is a two minute check that catches dead destinations before a customer does. Link doesn't run that check on its own yet, so for now it is manual.
