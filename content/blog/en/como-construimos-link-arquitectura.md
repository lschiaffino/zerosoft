---
title: "How we built Link: the entire architecture fits on one page"
description: "Next.js, SQLite and a route handler that responds in milliseconds. No Redis, no Kafka, no microservices. This is what an honest shortener looks like."
date: "2026-06-25"
author: "Zerosoftware"
tags: ["link", "architecture", "open source"]
---

Most "enterprise" shorteners describe their architecture with fifteen-box diagrams. Ours fits in this post. Not for lack of ambition: a link shortener doesn't need more.

## The redirect is a route handler, not a platform

Link is Next.js with the App Router. The whole product flows through one route handler that does exactly three things: read, record, redirect.

```ts
// app/[slug]/route.ts
export function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const link = getLink(params.slug); // SELECT by indexed slug
  if (!link || expired(link) || maxedOut(link)) {
    return new Response("Not found", { status: 404 });
  }
  if (link.password && !authorized(req, link)) {
    return NextResponse.redirect(`/gate/${params.slug}`, 302);
  }

  recordClick(req, link.id); // ~200-byte INSERT
  return NextResponse.redirect(link.url, 302);
}
```

Measured on the cheapest VPS we could find: under 3 milliseconds end to end, p99 included. The latency you feel is the network's, not ours.

## SQLite, seriously

The database is SQLite with better-sqlite3, in WAL mode. For this workload it's an engineering decision, not a shortcut:

- **Synchronous, in-process:** no network, no connection pool. A `SELECT` is a microsecond lookup.
- **One file:** backup is copying the file. Restore is pasting it. Moving servers is an `scp`.
- **Headroom:** millions of indexed rows answer in milliseconds. Our heaviest user is decades from the limit.

## Analytics without cookies

No tracker, no pixel, no fingerprint. Everything comes from the headers the browser already sends with every request:

```ts
function recordClick(req: NextRequest, linkId: string) {
  const ua = parseUA(req.headers.get("user-agent")); // device, browser, os
  db.prepare(`INSERT INTO clicks
    (link_id, ts, referrer, country, device, browser, os)
    VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    linkId,
    Date.now(),
    domainOf(req.headers.get("referer")),    // domain only
    req.headers.get("cf-ipcountry") ?? null, // country, never touching the IP
    ua.device, ua.browser, ua.os
  );
}
```

We store the referrer's domain, not the full URL. The country comes from the edge header, not from geolocating the IP — which we never store anyway.

## QR on demand

QRs are never generated ahead or stored: they're computed on each request to `/qr/[slug].svg`. It's a deterministic algorithm over a string; storing it would mean paying disk for something that recomputes for free in a millisecond.

## What we don't use (and why)

- **Redis:** SQLite in WAL already reads in microseconds. A cache would be one more part to maintain to gain nothing.
- **Kafka / event queues:** the analytics `INSERT` is part of the request and costs under a millisecond. A queue is the solution to a problem we don't have.
- **Microservices:** a shortener is one process. Splitting it into five turns every deploy into choreography and every bug into a distributed investigation.

Boring architecture is a feature: fewer parts that can fail at 3 a.m. All the code is open — audit every line.
