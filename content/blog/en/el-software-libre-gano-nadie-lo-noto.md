---
title: "Free software won. Nobody noticed."
description: "Linux, Postgres, nginx, Kubernetes: the world already runs on open source. The only layer that stayed proprietary is the one users touch. That last mile is what we are here to close."
date: "2026-05-28"
author: "Zerosoftware"
tags: ["open source", "linux", "saas"]
---

If you are reading this, your request traveled through a Linux server, passed through an nginx, queried a Postgres database and probably came out of a container orchestrated by Kubernetes. The world already runs on free software. It has for a long time — so long that it stopped being news.

The numbers are boringly conclusive:

- Over 80% of web servers — and effectively 100% of the world's 500 fastest supercomputers — run Linux.
- More than 90% of cloud infrastructure is built on open source software.
- Postgres, MySQL, Redis, nginx, Kubernetes, Docker, Git: the entire stack the internet is built with is free.
- Synopsys code audits have been reporting for years that over 90% of commercial codebases contain open source components.

The battle for the server is over. Free software won so completely that nobody celebrates it: it is simply the air the industry breathes.

## The layer that got left out

There is one visible exception: the layer users actually touch. The link shortener, the CRM, the calendar, the project board, the team chat. That last mile stayed proprietary, closed, and billed monthly.

The irony is hard to ignore: those products are built entirely on free software — they run on Linux, store data in Postgres, serve traffic through nginx — yet they are sold as black boxes. The modern SaaS is open source underneath and rent on top.

The result jumps out of any IT budget: the infrastructure, which is the technically hard part, is free. The office tools, which are the technically simple part, cost tens of dollars per user per month. The software price map is exactly upside down.

This is not a technical accident. Infrastructure was liberated because engineers built it for themselves, and sharing was a competitive advantage. The application layer stayed captured because that is where the business model lived: end users don't audit code, they pay subscriptions.

## The last mile

That is what we are here to close. Work tools — the ones used every day by people who don't write code — are the last mile of free software.

We started with **Link**: short links with custom aliases, cookie-less analytics, QR codes in SVG and PNG, password-protected and expiring links, and a public v1 API. It is available now, the code is open, and the cloud is billed at cost. Next come Track (Q4 2026), CRM (Q1 2027) and Cal (Q2 2027), under the same contract: self-host for $0 or cloud at cost, no margin.

Free software doesn't need to be discovered. It needs to be finished. The infrastructure is already free; what touches people is not — yet.

> The last mile of open source doesn't run in a datacenter. It runs in your browser tab.
