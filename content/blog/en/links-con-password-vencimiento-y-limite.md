---
title: "Links with a password, an expiration date or a click limit: when to use each"
description: "Practical use cases for password-protected, expiring and max-click links in Link, exactly what visitors see when one of them closes, and how QR codes in SVG and PNG fit in."
date: "2026-09-18"
author: "Zerosoftware"
tags: ["link", "qr", "use cases"]
---

Most short links live forever and let anyone through. That's the right default. But every so often you want a link that knows how to say no: only to people with a password, only until Friday, only for the first hundred.

Link has three switches for that, under **Advanced options** when you create or edit a link: **Password protection**, **Expires at** and **Max clicks**. They're free, they combine, and they're simple enough that it's worth knowing exactly how they behave before you print one on a poster.

## Password-protected links

**What happens:** instead of being redirected, the visitor lands on a small "Protected link" page with a password field. Right password, and they go through to the destination. Wrong password, they can try again.

Details worth knowing:

- **The browser remembers for 7 days.** After unlocking, a cookie scoped to that link lets the same browser through without asking again for a week. If you change the password, every existing unlock stops working immediately.
- **Brute force is throttled.** Attempts are rate limited per IP and per link (five a minute on a single link), so guessing a decent password isn't practical.
- **Clicks count after unlocking.** Someone who opens the link and never types the password doesn't show up in your analytics as a click.
- **We store a hash, not the password.** So we can't tell you what it was. If you forget it, set a new one in the edit form, or tick **Remove password protection**.
- **They never show up on your [bio page](/blog/pagina-link-in-bio).** A public page full of locked doors makes no sense.

**When to use it:** slides or recordings for people who attended a workshop; a press kit before the embargo lifts; a client preview you'd rather not have forwarded around casually.

**When not to:** anything actually secret. The password protects the short link, not the destination. Once someone is through, they see the real URL and can share that. If the destination is a public page, it was always reachable. Use real access control for real secrets.

## Expiring links

**What happens:** until the date and time you set, it's a normal link. After it, visitors get a page that says "This link expired". The link shows as **expired** in your list, and it disappears from your bio page on its own.

The link isn't deleted. Its analytics stay, and you can bring it back: edit it and move the date forward, or clear the field (empty means never).

**When to use it:**

- **Promos with a deadline.** The Black Friday link stops at midnight, and nobody gets to the checkout to find the discount code no longer works.
- **Event registration.** Registration closes when the link does.
- **Temporary shares.** A download link for a contractor that should only work this week.

## Links with a click limit

**What happens:** each redirect increments the link's click counter. Once it reaches the limit, the next visitor gets "Click limit reached" instead of the destination.

Two honest caveats about what "a click" means:

- **It counts redirects, not people.** Link analytics are cookie-free, so we don't know whether ten clicks are ten people or one person tapping ten times. A limit of 100 is 100 redirects.
- **Automated requests count too.** There's no bot filtering. Some chat apps and social networks fetch a link to build a preview card, and if that request follows the redirect, it's a click like any other.

So a click limit is a good **soft cap**, not a ticketing system. Use it for "the first hundred or so get the free template", and set it a bit above the number you actually care about. If you need to reopen, edit the link and raise the limit or clear it (empty means unlimited).

One more detail: a link that hit its limit stays on your bio page (unlike expired ones), leading to the limit page. Uncheck it there when it fills up.

## Combining them

The switches stack. The order in which Link checks them is:

1. Does the link exist and isn't archived? If not: "This link is gone".
2. Has it expired? If so: "This link expired".
3. Has it reached its click limit? If so: "Click limit reached".
4. Does it have a password? Then the password page.
5. Otherwise: record the click and redirect.

So an expired link never even asks for the password, and a locked link with a limit only counts the people who got through. A classic combo: password plus expiration for a "this week only, attendees only" link.

All of those pages work on your custom domain too, so the visitor never sees a generic error.

## QR codes: the same rules, on paper

Every link has a QR code, downloadable as **SVG** (vector, for print) or **PNG** (512 px, for slides and docs). The QR contains the short URL, not the destination, on your [custom domain](/blog/dominios-propios-dns-paso-a-paso) if the link uses one. That has two consequences that are easy to miss:

**Everything above applies to the QR.** Print a QR for an expiring link and, after the date, people scanning the poster land on "This link expired". That's a feature for a flyer that shouldn't outlive its event; it's a trap for packaging that will sit on shelves for years.

**You can change where the QR goes without reprinting.** Edit the link's destination and every printed copy now points to the new place. That's what other tools sell as "dynamic QR codes". Here it's just how short links work.

A practical tip if you plan to change destinations: keep the redirect type on **302 Temporary**, the default. A **301 Permanent** tells browsers they may cache the redirect, so someone who scanned before your change might keep landing on the old destination. Use 301 only when the destination will truly never change.

What the QR doesn't do yet: colors, logos or frames. They're plain black-on-white codes with a small margin. For most print jobs, that's what scans best anyway. If you need a branded one, the SVG is easy to style in any design tool, as long as you keep enough contrast.

## A quick decision guide

- **Only some people should get through:** password. Remember it guards the short link, not the destination.
- **It should stop working at a specific moment:** expiration date.
- **It should stop after roughly N uses:** click limit, with some margin.
- **It's going on paper:** QR, redirect type 302, and think twice before adding an expiration.

And when a link closes, the visitor gets a clear page that says why, instead of a broken redirect. Small courtesy, big difference.
