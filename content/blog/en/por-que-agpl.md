---
title: "Why we chose AGPLv3 over MIT, Apache or BSL"
description: "What AGPLv3 requires, what it doesn't, the network clause in plain words, and what it means if your company self-hosts zerosoft."
date: "2026-07-31"
author: "zerosoft"
tags: ["open source", "licensing", "agpl"]
---

The core of zerosoft (every feature of all eleven apps) is licensed under the GNU Affero General Public License, version 3. We considered MIT, Apache 2.0 and the Business Source License, and chose AGPLv3.

AGPL has a reputation. Some companies ban it outright, and plenty of developers assume it means "you'll have to open-source your whole company". It doesn't. So here's why we picked it, and what it really asks of you.

A quick disclaimer before we start: this is our reading of a public license, written by people who build software, not by lawyers. It's not legal advice. If your company has real stakes riding on a licensing question, the license text and your counsel win over a blog post.

## The options we turned down

**MIT and Apache 2.0** are permissive. Anyone can take the code, change it, close it and sell it: no obligation to share anything back. That's a perfectly honest choice and a lot of great software uses it. For us, it has one specific problem: a well-funded company could take the apps, put them behind a login, improve them privately and compete with the very thing we're trying to keep free. Permissive licenses make that legal and cheap.

**BSL and other "source-available" licenses** go the other way. You can read the code, but production use is restricted (typically: don't offer it as a competing service) until a change date, years later, when it converts to an open license. It protects the company. It's also not open source by the Open Source Initiative's definition, and it means the rules can tighten at every new version. We didn't want our core to be something you can *look at*. We wanted it to be something you *own*.

**AGPLv3** sits in the middle in a very specific way: it's a real, OSI-approved open-source license, and it closes the one loophole that matters for web software.

## What the GPL family obliges

The GPL idea is old and simple: you can use, study, modify and share the software, and if you *distribute* a modified version, you must share its source under the same license. Freedoms travel with the code.

The catch with web apps is that you never distribute them. Users touch a server; they never receive a binary. Under the plain GPL, a company can modify a web app, run it as a service for millions and never share a line. This is sometimes called the "SaaS loophole".

## The network clause, in plain words

AGPL adds one thing: section 13. If you **modify** the program and users **interact with it remotely over a network**, your modified version must offer those users a way to get its corresponding source code.

That's it. A few consequences people often miss:

- **No modification, no extra obligation.** Running the unmodified zerosoft (even as a public service) doesn't trigger section 13. The source is already public.
- **It's about the users of your instance.** The obligation is towards the people interacting with your modified version, not "the whole internet" and not us.
- **It covers the program and your changes to it**, under the same license. It doesn't reach out and grab unrelated software that merely talks to it over HTTP, like the scripts calling our public API with a `zs_…` key.

## What it means if you self-host at work

The most common case: a company runs zerosoft on its own server for its own team.

- **Unmodified:** use it however you like. Internal, external, commercial: no obligation beyond keeping the license notices. You don't pay us and you don't publish anything.
- **Modified, used only internally:** the people interacting with it are your own employees. Offering them the source of your own internal fork is, in practice, a non-event. Nothing goes public.
- **Modified, with public-facing surfaces:** this is the part worth thinking about. Several zerosoft features are used by people outside your company: Cal's public booking pages at `/book/[slug]`, the embeddable Chat widget, link-in-bio pages at `/@handle`. A conservative reading is that those visitors also interact with your modified version, so you should be ready to offer them its source. The easy way to stay comfortable: keep your fork in a public repository, or upstream your changes.

And if you contribute your change back to us, the question disappears: it's in the main code, which is already public.

## Why this protects you too

AGPL is usually framed as protection for the author. It's also protection for the user.

Every improvement someone makes to a public zerosoft service flows back to the commons. Nobody can build a closed, better version on top of the code you depend on and leave you behind. And because the copyleft applies to everyone (including any company that might acquire us someday), the code that's out there today stays AGPL. A future owner could change the license for *new* code, but they can't take back what's already published. You can always fork from the last free version.

That's the difference with a license that can be revised at every release. We made the promise in the one format that can't be quietly broken. It's the practical side of what we wrote in [free of charge vs free to use](/blog/gratis-vs-libre).

## What AGPL doesn't cover: /ee

There's one folder that isn't AGPL: `/ee`. It's for enterprise features (SSO/SAML, audit logs, custom roles, white-label) under a separate, source-available commercial license, and it's still mostly in development. Core code can only touch it through one file (`ee/lib/license.ts`), and without a license key the core keeps working exactly the same. We explain where that line is drawn, and why, in [open core explained](/blog/open-core-explicado).

## The short version

- You can use zerosoft for anything, including commercially, for free.
- You can modify it. If you run a modified version that people use over the network, share your changes with those people.
- You can't take it private.

We think that's a fair deal. It's the same one that keeps us honest: if we ever make the cloud worse than the code, you can take the code and leave.
