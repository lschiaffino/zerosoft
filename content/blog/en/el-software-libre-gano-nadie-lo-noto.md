---
title: "Open source runs the servers. The apps on top are still rented."
description: "Linux, Postgres, nginx and Kubernetes already run the internet. The tools office workers use every day are the part that stayed closed. That's the layer we're building."
date: "2026-05-28"
author: "zerosoft"
tags: ["open source", "linux", "saas"]
---

The request that loaded this page went through a Linux server and an nginx proxy, probably read from Postgres and ran in a container. Most of the internet's infrastructure is open source, and has been for so long that nobody mentions it.

The evidence is public:

- Every one of the TOP500 supercomputers runs Linux.
- Postgres, MySQL, Redis, nginx, Kubernetes, Docker and Git are all open source.
- Synopsys code audits have reported for years that more than 90% of commercial codebases include open source components.

## The layer that stayed closed

The exception is the layer people actually click on: the link shortener, the CRM, the calendar, the project board, the support chat. Those stayed proprietary and billed monthly.

They're built on the same open stack (Linux, Postgres, nginx) and sold as closed boxes. So the hard part, infrastructure, costs nothing, and the simple part, a form over a table, costs tens of dollars per user per month.

That's not a technical accident. Engineers built infrastructure for themselves and gained from sharing it. The application layer is where the subscription business lived, and end users don't audit code.

## What we're building

zerosoft is that application layer, open source. Eleven apps today: CRM, Chat, Agents, Flow, Robots, Track, Link, Docs, Notes, Cal and Board, under AGPLv3. Self-hosting costs $0. zerosoft Cloud has a free tier and then charges per workspace for usage (clicks, bookings, emails, storage), with free seats.

The infrastructure is already open. We're working on the part people see.
