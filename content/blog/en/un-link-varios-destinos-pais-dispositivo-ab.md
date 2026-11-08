---
title: "One link, several destinations: country, device and A/B tests"
description: "How to send each visitor to the right place with a single short link: country and device rules, weighted A/B tests and app deep links, plus the exact order Link resolves them in."
date: "2026-10-24"
author: "zerosoft"
tags: ["link", "routing", "ab-testing"]
---

You paste a link in your Instagram bio and people open it from Montevideo, Madrid and Mexico City, on an iPhone, an Android phone and a laptop. They all land on the same page. The right app store, the local currency price or the page in their language comes later, if it comes at all.

The fix is a short link that decides the destination at click time. Dub has two help articles on this, one on [geo targeting](https://dub.co/help/article/geo-targeting) and one on [device targeting](https://dub.co/help/article/device-targeting), and its docs say the latter is available from the Pro plan. This post covers the same problem from another angle: how to design rules that do not step on each other, how to measure whether they work, and how to set it up in Link.

## What a link can decide

In Link, routing lives in each link's detail page, in the **Routing** section. It has three parts:

- **Country and device rules.** Up to 20 rules. Each has a list of countries (two-letter codes such as `AR`, `UY`, `CL`), a list of devices (iOS, Android, desktop) and a destination URL. An empty list means "any".
- **A/B test.** From 2 to 5 destinations, each with a weight from 0 to 100. A given visitor always sees the same variant.
- **Deep links.** One app URL for iOS and one for Android, each with a fallback for when the app is not installed.

With no rules, the link goes to its usual URL and the redirect does no extra work.

## Resolution order matters

When someone clicks, Link resolves the destination in this order:

1. **The device's deep link**, if you configured one for their system (iOS or Android).
2. **The first rule that matches**, reading the list top to bottom.
3. **The A/B test**, if no rule matched.
4. **The link's own URL**, if none of the above applies.

Three design tips follow from that:

**Order rules from specific to general.** If you have an "Argentina, iOS" rule and an "Argentina" rule, the first one goes on top. The first match wins, and the second would hide it entirely if it came first.

**The A/B test only sees traffic the rules let through.** If a rule sends all of Brazil to a Portuguese page, those visitors never enter the test. To test inside one country, run the test on the link that country receives, not on a general one.

**A deep link beats everything on its platform.** If you set an iOS app, no iPhone visitor reaches the web rules. Use it only when you want the app to always come first.

## Recipe 1: one campaign, three markets

A launch campaign for Argentina, Uruguay and the rest of the region.

1. Create the link with the global page as destination. It is the last resort.
2. In **Routing**, add rule 1: country `AR`, destination `/ar/launch`.
3. Rule 2: country `UY`, destination `/uy/launch`.
4. Save with **Save routing**.

Everyone else lands on the link's URL. Each click records which rule served it, and the link analytics show the rule that handled each visit (Rule 1, Rule 2) next to the country, so you can check the split with data.

One detail: the country comes from a header the hosting platform sends. If a click arrives without a country, it matches no rule that asks for countries and moves on to the next step.

## Recipe 2: app or web by device

You want people opening the link on a phone to enter the app and everyone else to go to the web.

1. Under **Deep links**, enter the iOS app URL, for example `myapp://product/42`, or an `https` universal link.
2. Enter the fallback: the app store listing or the equivalent web page.
3. Repeat for Android.

With a custom scheme (`myapp://`), Link serves a minimal page that tries to open the app and, if nothing happens within a second and a half, redirects to the fallback. With an `https` universal link the redirect is direct and the operating system decides whether to open the app.

What it does not do yet: deferred deep linking. If the person lacks the app, they go to the store, but after installing they do not return on their own to the product they tapped. That needs an SDK inside the app and we do not have one.

Another caveat the panel states: iPads running Safari identify as Mac, so they get the desktop destination.

## Recipe 3: a real landing page A/B test

Two versions of a pricing page, 50 and 50.

1. In **A/B test**, add variant A with the current URL and weight 50.
2. Add variant B with the new URL and weight 50.
3. Save.

Two things make the test useful:

- **Visitors do not switch variants.** Link stores a visitor cookie (`zs_vid`) and computes the variant with a stable hash. Someone returning tomorrow sees the same page, so the result stays clean.
- **Clicks know which variant they came from.** Each click stores the variant (A, B) and the link's CSV export includes a `variant` column. You can join it with the conversions in your analytics.

What Link does not do is tell you which variant won. It measures clicks per variant, not conversions. Conversion happens on the destination site, so to compare you need the UTMs from [a short convention](/blog/utms-sin-planilla) and your analytics tool.

And a hygiene rule: do not call the test until each variant has a reasonable number of visits. With 30 clicks per side any difference is noise.

## How not to break it

- **Test from the outside.** Open the link on a phone over mobile data and through a VPN in another country. It is the fastest way to see each branch.
- **A destination cannot point back to the link itself.** Link checks every destination in rules, A/B and deep links to avoid loops.
- **Each rule needs countries or devices.** An empty rule is rejected on save; for "everyone", use the link's URL.
- **An A/B needs at least two variants**, and at least one with a weight above zero.

## Self-host and cost

Routing is part of the AGPL core. No plan unlocks it: if you run Link on your server, you have it. In zerosoft Cloud there is no charge per rule or per seat, only for clicks, bookings, emails and storage.

And because the configuration lives in a JSON column on the same row the redirect reads, broken JSON never breaks the redirect: the link just goes back to its URL.

## Takeaways

- Order: deep link, first matching rule, A/B, link URL.
- Rules from specific to general.
- Test each branch from a real device and country.
- Measure clicks in Link and conversions in your analytics, joined by UTM.

If you are coming from another shortener, the [Link importer](/blog/migrar-de-bitly-a-link) brings in your links with their destinations, and you set up routing afterwards on the ones that need it.
