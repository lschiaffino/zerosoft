---
title: "How to contribute to Zerosoftware (no permission needed)"
description: "The code is open, the roadmap is public, and this blog ships in three languages. Here's how to get involved: issues, PRs, translations, documentation, and product ideas."
date: "2026-06-07"
author: "Zerosoftware"
tags: ["open source", "community", "contributing"]
---

Zerosoftware isn't a company you buy from — it's a project you can join. Link's code is open source, the roadmap is public, and this blog gets written in three languages. All of it stays alive because people show up one day and say "I can do this better." If you're one of those people, this post is for you.

## Report what's broken

The most underrated contribution in open source isn't code — it's a good issue. If something fails, tell us:

- **What you did**, step by step, until it broke.
- **What you expected** to happen, and what actually happened.
- **Your setup**: version, operating system, how you're running it (self-hosted on your VPS or on our cloud).

One issue with those three items is worth more than ten "doesn't work" comments. And if the bug is already reported, add your case anyway: every independent reproduction shortens the diagnosis.

## Send code

The repo is public and pull requests get real reviews. Before opening one:

1. **Check the open issues.** If your change is already being discussed, join that thread first. A surprise 2,000-line PR is hard to review; a small one, aligned with an issue, merges fast.
2. **Match the project's style.** Code is read far more than it's written: name things the way we name them, comment what we comment, no more.
3. **One PR, one change.** If you fix a bug and reformat half the repo along the way, the PR becomes unreviewable. Two PRs is better.

You don't need to be a senior engineer. A good share of merged PRs are typos, validations, tests, and edge cases nobody had tried. Link runs on SQLite: download it, run it, and you'll have a working local environment in an afternoon.

## Translations and documentation

Zerosoftware exists in three languages: English, Spanish, and Portuguese. The interface, the documentation at /docs, this blog. That's a lot of text, and there's always some sentence that reads like a machine translation in a trench coat.

If you speak two of those languages, your contribution is direct: flag the sentence that sounds off and propose a better one. Our translations don't come from a localization team in California — they come from people who read something and winced.

Same goes for documentation. The v1 API is documented endpoint by endpoint, but docs are never finished: missing examples, common errors nobody explained, a self-hosting walkthrough for your setup. If you got stuck anywhere in /docs, that spot is your PR.

## Ideas, not promises

After Link comes Track (project management, Q4 2026), CRM (Q1 2027), and Cal (scheduling, Q2 2027). That order didn't come from a marketing survey — it came from issues and conversations with the people using Link. If you want to influence what gets built, that's the place: tell us which expensive tool is overcharging you and what the free version would need to do to replace it.

What we won't promise: exact dates, features on demand, 24/7 support. We're a small project with big principles. What we do promise is that everything gets read.

## The deal

Contributing to Zerosoftware comes with a guarantee no SaaS can sign: what you build is yours forever. The code never closes, the license never changes, and if we disappear tomorrow, the software stays. Made of zeros, maintained by people. Join in.
