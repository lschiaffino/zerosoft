---
title: "Open APIs: why we document everything"
description: "Link's public v1 API is fully documented at /docs, endpoint by endpoint. It's not a nice-to-have: it's our anti-lock-in guarantee."
date: "2026-05-27"
author: "Zerosoftware"
tags: ["api", "open source", "link"]
---

There's an easy way to tell whether a product respects you: look at its API. If the API exists, is documented, and lets you do everything the interface does, the product treats you like an adult. If the API is an afterthought — three hidden endpoints, stale docs, "contact sales for access" — the product treats you like a hostage.

We started from the other end. Link is API-first: the web interface is just another client of the public API. Anything you can do with a mouse, you can do with curl.

## The v1 API, in full

Link's v1 API is available today, documented endpoint by endpoint at /docs, with no disguised "coming soon" sections:

- **Create links**: `POST /api/v1/links` with custom alias, password, expiration date, max clicks, tags and UTM parameters.
- **List and search**: `GET /api/v1/links` filtered by tag and domain.
- **Statistics**: `GET /api/v1/links/:id/stats` with clicks by day, referrer, country, device, browser and OS. No cookies, no fingerprinting — the same data you see in the dashboard.
- **QR codes**: SVG and PNG generation.

Authentication is a single API key in an `Authorization: Bearer` header. You generate and revoke keys from your account — no support ticket required. Rate limits are public and travel in `X-RateLimit-*` headers on every response, so you always know exactly how many requests you have left before hitting the ceiling. Errors are JSON with stable codes, not surprise HTML.

```bash
curl -X POST https://zerosoftware.ai/api/v1/links \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://yourcompany.com/launch", "alias": "launch"}'
```

## The anti-lock-in guarantee that actually works

Everyone promises "no lock-in". Most mean "you can export a CSV if you find the button". An open API is a different promise — and a verifiable one:

1. **You can script your own exit.** A twenty-line script walks your links, pulls your stats and rebuilds them somewhere else. No cooperation from us required.
2. **You can integrate without permission.** Your CRM, your CI, your newsletter. If it speaks HTTP, it speaks Link.
3. **Plan B already exists.** The code is open source. If we vanished tomorrow, your automation points at your own server and keeps running. The API is the same because the software is the same.

A company that hands you a complete API is handing you the exit door, lit and unlocked. We document it because we're convinced you'll stay for how well it works, not for how hard it is to leave.

## What's next

- **Webhooks**: real-time click events pushed to your endpoint, so you react the moment something happens.
- **Per-product endpoints**: Track (Q4 2026), CRM (Q1 2027) and Cal (Q2 2027) each ship with a public API from day one. Same rule: documented first, stable after.

The interface is for people. The API is for your company. Both have to be first-class, or neither is.
