---
title: "Social media content calendar: a CSV template and Social"
description: "Plan the month in a spreadsheet, import it into Social as scheduled, for approval or drafts, and let the queue fill the gaps. Steps, a template and the limits."
date: "2026-11-21"
author: "zerosoft"
tags: ["social", "hootsuite", "guide"]
---

A content calendar is a list of what you will post, on which network and on which day. Hootsuite describes it in [its guide](https://blog.hootsuite.com/how-to-create-a-social-media-content-calendar/) as a plan that can live in a spreadsheet, a document or a project tool. We agree on the basics. What differs is where the list ends up: in a template you download after filling in a form, or in your own tool, with your own data, ready to go out.

This guide builds a month of content in a spreadsheet you control and imports it into Social, the zerosoft social media app.

## First, where Social stands

Social still shows as "Coming soon" on the site. The networks (Facebook, Instagram, LinkedIn, X, TikTok, YouTube, Threads and Bluesky) are built on the official APIs and tested against simulated networks. We have not verified them with live accounts yet, and several need the developer app of whoever runs the instance. If you self-host, that setup is part of the job. The row-by-row detail is in the parity table on the [Social](/products/social) page.

Everything below can be tried today with the simulated networks. The spreadsheet flow stays the same once you connect real accounts.

## Step 1: decide three things before writing a row

1. **How often per week, per network.** Pick a number your team can keep up. Three posts a week on two networks is 24 rows a month. Four networks every day is 120, and someone will quit by week two.
2. **Pillars.** Three or four recurring topics: product, customers, behind the scenes, ideas from your field. They keep the calendar from filling up with whatever comes to mind first.
3. **Who approves.** If someone on the team needs a second pair of eyes on their posts, settle it now (step 5 below).

## Step 2: the spreadsheet

Social reads a CSV with these columns: date, time, text and link (optional). With a header row the order does not matter, and the names are recognized in English, Spanish and Portuguese (`date`, `time`, `text`, `link`). Without a header, the order is the one above. The separator can be a comma or a semicolon, so a CSV exported from a spreadsheet set to a European or Latin American locale works as is.

A starting template:

```
date,time,text,link
2026-12-01,09:30,"We shipped the December release: what changed in the calendar.",https://yoursite.com/news
2026-12-03,18:00,"Three questions we hear before every purchase.",
2026-12-08,09:30,"A Monday with the team: our 15-minute meeting.",
```

Rules worth knowing, taken from the importer's code:

- **Times are read in the workspace time zone.** A date without a time is an error: it is not guessed.
- **Date formats.** `2026-12-31` is always understood. With slashes (`03/04/2026`) you choose at import whether the day or the month comes first.
- **Up to 350 rows per file** and 2 MB. Anything beyond that is left out, and you are told.
- **The link is appended to the end of the text** if the text does not already contain it.
- **No photos per row.** A CSV carries text only.

You can add columns of your own (pillar, owner, goal): the ones Social does not recognize are ignored, so your spreadsheet can be richer than what gets imported.

## Step 3: import and read the preview

In Social, open **Import CSV**. Pick the accounts (each row goes out on every account you tick), upload the file or paste the rows, and look at the **Preview**. Each row ends up as "Ready" or "Skipped", with the reason:

- the date or time is not understood,
- that date and time have already passed,
- there is no text or link,
- the link is not a valid URL.

Per-network problems are flagged as well, such as text over X's character limit. Fix the spreadsheet and load it again, or import the good rows and skip the rest.

## Step 4: choose how it comes in

The **Import as** selector has three options:

- **Scheduled posts:** they go out on their own at each row's date and time.
- **Posts for approval:** they wait in the "Needs approval" tab until an admin reviews them.
- **Drafts:** they do not go out. Use this when a post needs a photo or video, because the CSV cannot carry them. Open each draft in the composer, add the file (up to 10 MB) and schedule it.

For the first month, I suggest importing as drafts or for approval, reviewing the whole calendar in month view, and only then scheduling. Scheduled posts can be dragged to another day on the calendar and keep their time.

## Step 5: approvals for whoever needs them

Members with the "Needs approval" role send their posts for review instead of scheduling them. An admin approves or rejects with a comment, and the author gets a notification. Each post records who approved it. Multi-step approvals do not exist yet: it is a single review.

## Step 6: the queue for the gaps

A calendar of fixed dates does not cover everything. For content that can go out any day, each account has **Queue times** (on the Accounts screen): the weekdays and hours when you want things to go out. In the composer, **Add to queue** takes the account's next free slot and shows you which one it is before you confirm. If the account has no queue times, it tells you.

A combination that works: the CSV for posts tied to a date (launches, events) and the queue for the content that is always useful.

## Step 7: review once a week

Once there are 10 posts with metrics, Social suggests best times based on your own engagement. Before that it shows starting times, labeled as such. Take it as a suggestion: two or three weeks of data from a small team say little.

If you route links through the suite's shortener, Link counts the clicks and Social can add UTM parameters. How to set them up: [UTMs without a spreadsheet](/blog/utms-sin-planilla).

## What is missing, so it does not surprise you

- Pinterest, Google Business Profile and Instagram and Facebook stories are not there yet.
- There is no image editor and no Canva integration.
- X posts take text and up to four photos, no video.
- There is no trending hashtag search. You get saved sets and suggestions from what your team already used.

## Cost

Self-host: $0, with every core feature under AGPL. On zerosoft Cloud seats are not charged, so adding a reviewer does not change the bill. If you are coming from Hootsuite, the full comparison is at [Hootsuite vs zerosoft Social](/compare/hootsuite-alternative).
