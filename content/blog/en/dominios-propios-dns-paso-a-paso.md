---
title: "Custom domains for short links: DNS, step by step"
description: "How to serve your Link short URLs from go.yourcompany.com: which DNS record to create, how verification works on Zerosoft Cloud and on your own server, and the gotchas."
date: "2026-07-21"
author: "Zerosoftware"
tags: ["link", "dns", "custom domains"]
---

A short link on someone else's domain is a small act of trust you ask from every reader. `go.yourcompany.com/launch` says who sent it. A random domain says "click me and hope". Link supports custom domains out of the box, and setting one up is one DNS record and one button. This post walks through exactly what happens, on Zerosoft Cloud and on your own server, including the parts that usually go wrong.

## Before you start

- **Use a subdomain.** `go.`, `l.`, `links.` — whatever you like. You can use an apex domain (`yourco.link`), but subdomains are friendlier with DNS providers, as you'll see below.
- **Have access to your DNS.** Cloudflare, Route 53, your registrar's panel — wherever the zone lives.
- **Be a workspace admin.** Adding a domain is admin-only. Once it's verified, it shows up as an option when anyone in the workspace creates a link.

## Step 1: add the domain

Go to Link settings, open **Custom domains**, type `go.yourcompany.com` and hit **Add domain**. Three things get checked right away:

- It has to be a valid hostname (no path, no port).
- It can't be a host that already serves the app (more on that in the self-host section).
- It can't be in use by another account. One domain, one owner.

The domain now shows as **Waiting for DNS**, with a small table telling you exactly which record to create.

## Step 2: create the DNS record

What the table says depends on where Link runs.

### On Zerosoft Cloud (and any Vercel deployment)

When the server has `VERCEL_TOKEN` and `VERCEL_PROJECT_ID` set (plus `VERCEL_TEAM_ID` if the project lives in a team), adding a domain also registers it on the Vercel project through their API. The record you create is:

```
# subdomain (go.yourcompany.com)
CNAME   go   cname.vercel-dns.com

# apex (yourco.link)
A       @    76.76.21.21
```

Vercel issues the HTTPS certificate on its own once DNS resolves. You don't touch certificates at all.

### On your own server

Leave the `VERCEL_*` variables empty. Then the instruction is a CNAME pointing at your app's own host — the one in `SHORT_DOMAIN`, or `NEXTAUTH_URL` if that's not set:

```
# say your Link instance runs at links.example.org
CNAME   go   links.example.org
```

For an apex domain the table says `CNAME @`, which many DNS providers don't allow. Two ways around it: use your provider's CNAME flattening / ALIAS record, or create plain A (and AAAA) records with the same IPs as your app host. Verification accepts both, as we'll see.

**HTTPS is your job here.** Short URLs on custom domains are always generated as `https://`, so whatever sits in front of the app (Caddy, nginx with certbot, a load balancer) needs a certificate for `go.yourcompany.com`. Link routes the request; it doesn't issue certificates.

## Step 3: verify

DNS changes take anywhere from seconds to a while. When you think it's live, click **Verify**. If it isn't, you'll see "DNS isn't pointing here yet" — wait and try again. Verification is rate limited per IP, so hammering the button doesn't help.

What "verify" actually checks:

- **Vercel mode:** asks Vercel for the domain's configuration and passes when Vercel reports it's no longer misconfigured.
- **Self-host mode:** resolves the CNAME of your domain. If it points at the app host, done. If not, it compares IPs: every address your domain resolves to must be one of the addresses of the app host. That's why A records and flattened CNAMEs work for apex domains.

Once verified, the badge turns green and the domain appears in the **Domain** picker when you create a link (and through the API, by passing `"domain": "go.yourcompany.com"` to `POST /api/v1/links`).

## What changes on a custom domain

This is the part people don't expect, in a good way.

**Reserved words don't apply.** On the default domain, a slug can't be `blog`, `docs`, `app`, `api`, `status`, `login` or a couple dozen other reserved words, because those paths belong to the website. On your own domain, every `/<something>` is a short link. So `go.yourcompany.com/blog` or `go.yourcompany.com/app` are perfectly valid. The only exceptions are `en`, `es` and `pt` (the password gate and "link gone" pages live under those) and the internal `__root`.

**Slugs are per domain.** `zerosoft.ai/promo` and `go.yourcompany.com/promo` are different links and can point to different places. The same slug can exist once per domain.

**The root can redirect somewhere.** By default, someone opening `go.yourcompany.com/` with no slug lands on the Zerosoft home page. After verifying, set a **Root redirect** (your homepage, say) and the bare domain goes there instead.

**Everything else works the same.** Passwords, expiration, click limits, QR codes (generated with the custom domain in them), analytics, and the `link.clicked` webhook, whose payload includes the domain.

## APP_HOSTS: the self-host gotcha

The middleware has to decide, for every request, whether the host is "the app" or "a custom link domain". On a custom domain, every single-segment path is treated as a slug, which would break the dashboard if your app host got misclassified.

The app recognizes its own hosts from `NEXTAUTH_URL`, `SHORT_DOMAIN`, the Vercel URLs, `localhost` and anything ending in `.vercel.app`. If you serve the app from **extra** hostnames — `www.` variants beyond the obvious, an internal name, a second public domain — list them:

```
APP_HOSTS=links.example.org,links.internal.lan
```

Comma-separated, no paths. Hosts in this list can't be added as custom domains, and requests to them behave like the normal app.

## Removing a domain

You can't remove a domain that still has links on it. That's deliberate: deleting it would break every printed QR and every link already out there. Move or delete those links first, then remove the domain. In Vercel mode, removal also detaches it from the project.

## Moving from another shortener

If your links already live on `go.yourcompany.com` at Bitly, order matters. The [Bitly import](/blog/migrar-de-bitly-a-link) keeps back-halves on a custom domain only if that domain is **already verified** here, and verifying means the DNS already points here. So: lower the record's TTL a day ahead, switch the DNS, verify, and run the import right away. The old URLs keep working, with a gap of minutes instead of a broken weekend.

## Checklist

1. Add `go.yourcompany.com` in Custom domains (admin).
2. Create the record from the table: CNAME to `cname.vercel-dns.com` on Cloud, CNAME to your app host on self-host.
3. Self-host: make sure your proxy has a certificate for the new host, and set `APP_HOSTS` if you serve the app from extra hostnames.
4. Click **Verify** until it's green.
5. Optional: set a root redirect.
6. Create links and pick the domain.

One DNS record, no premium tier. Your domain was always yours; now your links are too.
