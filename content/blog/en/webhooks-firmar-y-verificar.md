---
title: "zerosoft webhooks: what's signed, how to verify it, what happens on failure"
description: "Events, an HMAC-SHA256 signature in a Stripe-style header, retries with backoff for about 15 hours, and an SSRF guard. Plus a Node verifier you can paste."
date: "2026-08-27"
author: "zerosoft"
tags: ["webhooks", "developers", "security"]
---

Polling an API to find out whether something happened is like refreshing your inbox every ten seconds. Webhooks flip it: zerosoft calls you. This post covers exactly what we send, how to prove it was us, and what happens when your endpoint is down: all straight from `lib/webhooks.ts` and `lib/safe-fetch.ts`.

## The events

There are five, and only five:

- `booking.created`: someone booked through Cal.
- `booking.rescheduled`: a booking moved.
- `booking.cancelled`: a booking was cancelled.
- `link.created`: a short link was created (from the dashboard, the API or an import).
- `link.clicked`: someone clicked a short link.

There's also `ping`, which is what the "Send test" button in the panel delivers. Your handler should accept it and do nothing.

What's not here: CRM events. Contacts, deals and tasks don't emit these webhooks yet. The closest thing today is a CRM workflow with an HTTP request action: it fires on triggers like `deal_won` or `contact_created` and goes through the same SSRF guard described below, but it isn't signed and isn't retried. Or poll the [API v1](/blog/api-rest-v1-con-claves-personales).

A heads-up on `link.clicked`: it fires on every click. A link that goes viral will send you a lot of POSTs. The redirect itself never waits for your endpoint (the webhook is sent after the response), but your server will feel it. The click payload contains referrer, country, device, browser and OS. No IP address.

## Setting one up

Webhooks live in Dashboard → Settings → Webhooks, and only workspace admins can manage them. Pick a URL and the events you care about. On creation you get a secret that looks like `whsec_…`, shown exactly once. We store it encrypted (AES-256-GCM with the instance's `ENCRYPTION_KEY`), so we can sign with it but nobody can read it back from the dashboard.

## What a delivery looks like

Every delivery is a `POST` with a JSON body:

```json
{
  "id": "4d1c…",
  "type": "booking.created",
  "createdAt": "2026-11-01T18:00:00.000Z",
  "data": { "id": "…", "status": "confirmed", "startsAt": "…", "invitee": { "name": "Ana", "email": "ana@example.com" }, "eventType": { "slug": "intro", "title": "Intro call" } }
}
```

And these headers:

```
Content-Type: application/json
User-Agent: Zerosoft-Webhooks/1
Zerosoft-Event: booking.created
Zerosoft-Delivery: <delivery id>
Zerosoft-Signature: t=1793556000,v1=5f2a…
```

`Zerosoft-Delivery` is unique per endpoint and stays the same across retries. Use it as your idempotency key.

## How the signature works

It's the Stripe pattern, on purpose: lots of people already know it:

```
v1 = hex( HMAC-SHA256( secret, "<t>.<raw body>" ) )
```

`t` is a Unix timestamp in seconds, taken at the moment of each attempt. Including it in the signed string means an attacker who captures one request can't replay it later without the signature going stale.

Two gotchas that bite everyone:

1. **Sign the raw body.** If your framework parses JSON and you re-serialize it, key order or whitespace can change and the HMAC won't match. Get the bytes as they arrived.
2. **The key is the whole secret,** `whsec_` prefix included. Don't strip it, don't base64-decode it.

## A Node verifier

Here's a complete Express handler. No dependencies beyond Express:

```js
import crypto from 'node:crypto';
import express from 'express';

const SECRET = process.env.ZEROSOFT_WEBHOOK_SECRET; // whsec_…
const TOLERANCE_SEC = 300;

function verify(rawBody, header, secret) {
  const parts = Object.fromEntries((header ?? '').split(',').map((p) => p.split('=', 2)));
  const t = Number(parts.t);
  if (!t || !parts.v1) return false;
  // Reject old (or future) timestamps: blocks replays.
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_SEC) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const received = Buffer.from(parts.v1, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

const app = express();
const seen = new Set(); // use your database in real life

app.post('/webhooks/zerosoft', express.raw({ type: 'application/json' }), (req, res) => {
  const raw = req.body.toString('utf8');
  if (!verify(raw, req.get('zerosoft-signature'), SECRET)) return res.sendStatus(400);

  const delivery = req.get('zerosoft-delivery');
  if (seen.has(delivery)) return res.sendStatus(200); // retry of something we already handled
  seen.add(delivery);

  const event = JSON.parse(raw);
  res.sendStatus(200); // answer fast, work later
  handle(event).catch(console.error);
});

async function handle(event) {
  if (event.type === 'ping') return;
  // booking.created, link.clicked, …
}

app.listen(8080);
```

`timingSafeEqual` matters: a plain `===` on strings can leak, through response timing, how many leading characters matched.

## Timeouts, failures and retries

Each attempt has an **8-second timeout**. Anything that isn't a 2xx counts as a failure, including redirects, because we don't follow them. If your endpoint moved, update the URL instead of redirecting.

The first attempt happens immediately when the event occurs. If it fails, the delivery is rescheduled with backoff: **1 minute, 5 minutes, 30 minutes, 2 hours, 12 hours**. After that sixth attempt it's marked `failed` and we stop. That's roughly 15 hours of grace for your server to come back.

Retries are run by the periodic `/api/cron/tick` job, which picks up to 50 due deliveries per run. So the real schedule is "that delay, or the next tick, whichever is later". On zerosoft Cloud that's handled for you. If you self-host, you need to call the tick yourself: the [Docker guide](/blog/self-hosting-con-docker-paso-a-paso) shows the one-line crontab.

The panel shows each webhook's last delivery: status, response code and when.

## SSRF: why we won't call your localhost

A webhook URL is a URL a user typed that our server will fetch. Without guardrails, that's a textbook server-side request forgery: point it at `http://169.254.169.254/` and you're asking the cloud provider's metadata service for credentials.

So `safe-fetch.ts` checks every URL, both when the webhook is created and again on every attempt:

- Only `https://` in production (plain `http` is allowed only outside production, for development).
- `localhost`, `*.localhost` and `*.internal` hostnames are rejected.
- The hostname is resolved, and if **any** of the addresses falls in a private or reserved range, it's rejected: `10.0.0.0/8`, `127.0.0.0/8`, `0.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, multicast and above, plus IPv6 loopback, unique-local (`fc00::/7`), link-local and IPv4-mapped addresses.
- Redirects aren't followed, so a public URL can't bounce us inside.

Being precise about the limits: the check resolves DNS and then `fetch` resolves it again, so a hostile DNS server flipping answers between those two lookups (DNS rebinding) isn't fully closed. It narrows the window a lot; it isn't a network-level firewall.

## Self-hosting on a private network

If you run zerosoft inside your company network and want it to call internal services (`http://n8n.lan:5678/webhook/…`, say), set:

```bash
ALLOW_PRIVATE_WEBHOOKS=true
```

That turns off the HTTPS requirement and the private-address checks entirely. It's the right call on a box where every user is a colleague. It's the wrong call on anything multi-tenant or public: anyone who can create a webhook can then make your server send requests to anything it can reach.

## Checklist

- Verify the signature over the raw body, with the full `whsec_` secret.
- Reject timestamps older than a few minutes.
- Deduplicate on `Zerosoft-Delivery`.
- Answer 2xx within 8 seconds; queue the slow work.
- Don't redirect. Don't expect CRM events (yet).
