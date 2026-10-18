---
title: "301 or 302 on a short link: what actually changes"
description: "What 301, 302, 307 and 308 redirects mean, what Google does with each, why browser caching matters more than SEO for a short link, and what Link does when you pick 301."
date: "2026-10-18"
author: "zerosoft"
tags: ["link", "seo", "redirects"]
---

The new link form has a field almost nobody touches, tucked under the advanced options: **Redirect type**, with two values, `301 Permanent` and `302 Temporary`. The usual question is which one is better for SEO. The short answer for a short link: almost no difference in search engines, and a big difference in people's browsers. This post covers both and shows what Link does with each option, read straight from the redirect code.

## Four status codes in one table

A redirect is an HTTP response that says "what you want lives at another URL". The spec ([RFC 9110, section 15.4](https://www.rfc-editor.org/rfc/rfc9110#section-15.4)) defines several. Four matter:

| Code | Meaning | Can it turn POST into GET? |
|---|---|---|
| 301 | Moved permanently | Yes, for historical reasons |
| 302 | Found elsewhere, for now | Yes, for historical reasons |
| 307 | Temporary, keeps the method | No |
| 308 | Permanent, keeps the method | No |

The method column matters for forms and APIs. A short link is always opened with GET (someone clicks it or scans a QR code), so in practice 307 behaves like 302 and 308 like 301. That leaves one question: permanent or temporary.

## What Google does with each

Google's documentation on [redirects and Search](https://developers.google.com/search/docs/crawling-indexing/301-redirects) is plain about it. With a permanent redirect, Google shows the target in results and treats it as a strong signal that the target is the canonical URL. With a temporary one, it may keep showing the source URL.

For a page that moved (your blog went from `/news/` to `/blog/`) that matters a lot. You want the new URL to inherit the old one's place, and that calls for a 301 on your web server.

For a short link it barely matters. Nobody wants `go.yourcompany.com/promo` in Google. What gets indexed is your page, which Google reaches through your site, your sitemap and the links pointing at it. The short link lives in a LinkedIn post, a PDF or printed on a box.

## What does change: the browser cache

A 301 with no caching instructions is cacheable by default ([RFC 9111](https://www.rfc-editor.org/rfc/rfc9111#section-4.2.2)). Browsers take advantage of that. The second time someone opens the same short link, the browser can jump straight to the destination without asking the server.

On a website that saves a round trip. On a shortener it breaks most of what makes the shortener useful:

- **The click isn't counted**, because the request never arrives.
- **Changing the destination doesn't apply** for anyone who has it cached. You fix a typo in the URL and part of your audience keeps landing on the broken page.
- **Expiring or archiving the link doesn't apply** either. The link with an expiry date keeps redirecting in that browser.
- **Click limits and passwords** depend on the server seeing every visit.

That's why the standard advice is "use 302 for short links". The advice is right, but the real reason is caching, and caching is decided by a header, `Cache-Control`, more than by the status code.

## What Link does

We opened the redirect handler (`app/r/[slug]/route.ts`) to describe it exactly:

1. **302 is the default.** Every link's `redirect_type` column starts at 302.
2. **Every redirect response carries `Cache-Control: no-store`, including 301s.** The browser doesn't store the redirect, so every visit goes back through the server: the click is counted, and expiry, click limits, passwords and the current destination all apply. Picking 301 in Link won't leave you with stuck links.
3. **Bots and preview generators always get a 302.** Googlebot, Bingbot, Slack, WhatsApp, LinkedIn and friends are detected by User-Agent. They don't count as clicks and get a 302 no matter what you picked. If the link has its own preview title, description or image, they get a page with those tags.
4. **Links with targeting always use 302.** If a link sends people to different places by country, by device or through an A/B split, a 301 would claim "this is the permanent destination" when the destination depends on who's asking.
5. **The root of a custom domain uses 302.** `go.yourcompany.com/` with no slug goes to the URL you set under Domains, with a temporary redirect.

The practical upshot, stated honestly: in Link, picking 301 only changes the code that human browsers see. Search engines get a 302 either way, and caching is off in both cases. We keep the option because some tools and audits ask for an explicit 301, and because some teams prefer it for links that will never change.

## See it for yourself

`curl` counts as a bot for Link (it's on the list of User-Agents that aren't visits), so this always returns 302 and adds no clicks:

```bash
curl -sI https://go.yourcompany.com/promo
```

To see what a browser gets, send a browser User-Agent. This one does count a click:

```bash
curl -sI -A "Mozilla/5.0" https://go.yourcompany.com/promo
```

The response shows `HTTP/2 301` or `302` depending on your choice, `location:` with the destination, and `cache-control: no-store`.

## A guide to deciding

| Situation | Use |
|---|---|
| Campaign link, newsletter, bio page, printed QR code | 302 (Link's default) |
| A link whose destination may change or that expires | 302 |
| A link with country, device or A/B targeting | 302 (Link enforces it) |
| An internal policy or an audit asks for 301 | 301 in Link: it isn't cached, so you lose nothing |
| You moved a page or a domain and want to keep its ranking | 301 on your web server, with no shortener in between |

The last case is the one people mix up most. If you replaced `yourcompany.com/pricing-2025` with `yourcompany.com/pricing`, the redirect belongs where the page lives. In nginx, for example:

```nginx
location = /pricing-2025 { return 301 /pricing; }
```

A shortener in the middle adds a hop and one more domain to the chain, which is exactly what you want to avoid in an SEO migration.

## Summary

- For search engines, permanent versus temporary decides which URL is shown. For a short link that rarely matters.
- For people, what matters is whether the browser stores the redirect. A cached 301 stops counting clicks and stops honoring changes.
- Link always sends `no-store`, uses 302 by default and for bots, and forces 302 on targeted links. If you pick 301, only the number changes.
- Page moves are handled with a 301 on your own server.

For the rest of the advanced form, the post on [passwords, expiry and click limits](/blog/links-con-password-vencimiento-y-limite) explains when to use each one.
