---
title: "Link analytics without cookies: what one HTTP request tells us"
description: "Link counts clicks with no cookies, no JavaScript and no fingerprinting. Everything comes from the request the browser already sends."
date: "2026-06-24"
author: "zerosoft"
tags: ["analytics", "privacy", "link", "open source"]
---

A click on a short link is a conversation between a browser and our server. Before any analytics exist, that conversation already happens: the browser asks for the redirect, the server answers with a 302. Cookie-less analytics is just listening carefully to that conversation, instead of bugging the room.

## The request tells the story

When someone clicks one of your short links, the browser sends an HTTP request. Three pieces of that request carry everything we report:

- **The Referer header.** Tells us where the click came from: `x.com`, `news.ycombinator.com`, your newsletter's domain. Modern browsers trim it to the origin by default, so we see the site, not the exact page. That's fine: the site is the useful answer.
- **The User-Agent header.** The string the browser uses to introduce itself. We parse it locally into three fields: device type (mobile, tablet, desktop), browser family and OS family. The raw string never touches the database.
- **The connection's IP address.** Used for exactly one thing: a country lookup against a GeoIP database bundled with the app. The lookup happens in memory, on our server, with zero external calls: the IP never leaves the machine because it never goes anywhere. Then it's discarded. We store the country code, not the address.

No JavaScript on the destination page. No pixel. No localStorage. The click is measured at the redirect, which is the one moment the browser must talk to us anyway.

## What we store, what we don't

Each click becomes one row, about 200 bytes:

- Timestamp
- Link ID
- Referrer host
- Country code
- Device type, browser family, OS family

And here's the list that matters more. What we don't store:

- **No IP addresses.** Used in memory, discarded, never written to disk.
- **No cookies.** We never set one, on any domain.
- **No fingerprinting.** No canvas tricks, no font enumeration, no screen-size math.
- **No user IDs, sessions or cross-click identity.** We cannot tell whether one person clicked ten times or ten people clicked once. We don't want to.

The dashboard and `GET /api/v1/links/:id/stats` show clicks per day, referrer, country, device, browser and OS. That's the entire dataset. It is aggregate by construction, not by policy.

## Why there's no consent banner

Cookie banners exist because of two rules. The ePrivacy rules require consent before storing or reading information on someone's device. That's cookies and their cousins. GDPR kicks in when you process personal data, and an IP address tied to a browsing history qualifies.

We do neither. Nothing is stored on the visitor's device, and nothing we keep can identify a person. There's nothing to consent to, so there's no banner, and no chunk of your audience lost to "reject all". If your legal team wants to verify, the schema is open source: they can read it faster than they can schedule a meeting.

## Compared to traditional analytics

Classic web analytics load a third-party script, set cookies, follow users across sessions and often across sites, then ship everything to someone else's servers. They answer questions like "who is this person and what else do they like": questions a link shortener has no business asking.

For a redirect, the server-side approach is also simply more accurate: an ad blocker can kill a tracking script, but it can't stop a 302. Every click is counted, because counting happens where the redirect happens.

Your links' stats are yours: visible in the dashboard, exportable through the API, and identical if you self-host. Same code, same schema, your SQLite. Analytics that measure your traffic without surveilling your audience.
