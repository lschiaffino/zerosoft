---
title: "How to build a link-in-bio page with Link (and what you can't do yet)"
description: "Your /@handle page in five minutes: title, bio, avatar, ordered buttons and click tracking through your own short links. Plus the honest list of what it doesn't do."
date: "2026-08-06"
author: "Zerosoftware"
tags: ["link", "link in bio", "how-to"]
---

Social platforms give you one link. One. So the whole internet settled on the same workaround: a tiny page with a list of buttons, hosted by a company that would love to charge you monthly for a list of buttons.

Link has one built in. It lives at `zerosoft.ai/@yourhandle`, it's free, and every button goes through one of your short links, so the clicks land in the same analytics you already use. Here's how to set it up in five minutes, and exactly where its edges are.

## What you can customize

Let's set expectations first, because link-in-bio tools love to oversell. The page has:

- **A title.** Up to 80 characters. Leave it empty and it falls back to your account name, then to `@handle`.
- **A bio.** Up to 300 characters of plain text.
- **An avatar.** A URL to an image, and it has to be `https`. If you leave it empty, the page shows the first letter of your title instead.
- **Buttons.** Any of your links, in the order you choose, up to 50.
- **A publish switch.** Unpublished pages return a 404.

That's the whole list. There are no themes, colors, fonts, background images, social icon rows, embedded videos or custom CSS. The page uses the same minimalist style as the rest of Zerosoft. If you need a heavily branded page, a dedicated tool (or a page on your own site) will serve you better — and you can still point its buttons at your short links.

## Step 1: create the links first

The bio page doesn't have its own links; it shows links you already have. So start in Link and create one short link per button.

The important detail: **the button label is the link's title.** If a link has no title, the button shows the destination URL without `https://`, which looks sloppy. Give every link you plan to show a human title: "New episode", "Book a call", "Shop".

Since these are normal links, everything else applies. Add a UTM to the destination so your site's analytics knows the visit came from your bio. Use a [custom domain](/blog/dominios-propios-dns-paso-a-paso) if you have one. Tag them `bio` so you can find them later.

## Step 2: fill in the page

Open the **Bio page** tab in Link. Fill the title, the bio and the avatar URL. The avatar isn't uploaded here: host the image somewhere (your site, a CDN, your existing profile picture URL) and paste the `https` link.

## Step 3: pick and order the buttons

Below the profile fields you'll see your links with a checkbox each. Check the ones you want on the page. Checked links move to the top and get up/down arrows: that order is the order on the page. The editor lists your 50 most recent active links, so if a very old link is missing, create a fresh short link for that destination.

## Step 4: publish

Tick **Published**, hit **Save**, then **View page**. That's it. Paste `zerosoft.ai/@yourhandle` in your Instagram, TikTok, X or wherever.

The page also sets its social preview from your profile: title, bio as the description, and avatar as the image. So it looks decent when someone shares it in a chat.

## Your handle

The handle is generated from your email when you sign up. You can change it from the Cal settings, under **Your handle**: 3–32 lowercase letters, numbers or dashes. It's the same handle your [booking pages](/blog/calendly-y-el-impuesto-a-agendar) use (`/book/<handle>/…`), so changing it moves both, and breaks any link to the old one you already shared. Pick it once, pick it well.

## What hides itself automatically

The page is generated on every request, and it skips links that would be a dead end for a visitor:

- **Password-protected links** never show up. A bio page is public; a password link isn't meant to be.
- **Archived links** disappear.
- **Expired links** disappear the moment their expiration date passes. Handy for limited offers: set an expiration and the button removes itself.

One exception to know about: a link that reached its **click limit** still shows up, but leads to the "Click limit reached" page. If you use limits for a "first 100 people" offer, uncheck it from the page when it fills up.

## Tracking: what you see and what you don't

Each button points at the short link, not the destination, so every tap is a normal click: day, country, device, browser and OS, cookie-free, like any other link ([here's how that works](/blog/analytics-sin-cookies)).

Two honest caveats:

- **Page views aren't counted.** We count clicks on buttons, not visits to the page. You'll know how many people tapped "Shop", not how many opened the page and left.
- **The referrer of those clicks is the bio page itself.** People came from Instagram, but they clicked from `zerosoft.ai`. So the per-button referrer won't tell you which social network sent them.

A simple fix for the second one: create a short link per platform that points at your bio page, like `zerosoft.ai/ig-bio` and `zerosoft.ai/tt-bio`, and use each in its own profile. Those links' analytics tell you how many people arrived from each network; the buttons tell you what they did next.

## A few patterns that work

- **Seasonal top button.** Move the current launch to the top, the evergreen stuff below. Reordering is two clicks.
- **Self-expiring promos.** Create the promo link with an expiration date and check it on the page. It disappears on its own.
- **One link per destination, forever.** If the destination changes (new store, new podcast host), edit the short link's URL. The button, the page and any QR code you printed keep working.

## What's not there yet

To be clear about the edges: no visual customization beyond title, bio and avatar; no avatar upload; no page-view analytics; and the page lives on the main domain only, not on your custom domain. If any of these is a deal-breaker for you, tell us — or, since the code is open, send a pull request.

A list of buttons shouldn't cost a subscription. Now it doesn't.
