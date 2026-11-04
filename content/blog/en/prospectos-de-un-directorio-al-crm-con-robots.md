---
title: "From a web directory to companies in your CRM: a prospect list built by a robot"
description: "How to walk through a paginated public directory, keep only the new rows and load them as companies into the CRM without duplicates, using zerosoft Robots. Steps, settings and real limits."
date: "2026-11-03"
author: "zerosoft"
tags: ["robots", "crm", "browse-ai"]
---

Browse AI offers a ready-made robot to [extract data from a Google Maps place](https://browse.ai/t/extract-details-info-place-google-maps), and it states that phone and website are only captured when the business published them. That detail matters more than any template: a prospect list is only as good as the fields the site actually shows.

This post solves the same problem with Robots, the browser automation in zerosoft. We take a public directory (a chamber of commerce, a supplier listing, an event catalog), walk through it page by page and leave the companies in the CRM, once each.

## Before you start: what to do and what to skip

Pick directories that allow automated reading. Check the site's terms and its robots.txt file before scheduling anything, and avoid sites that forbid extraction. Browse AI says it on its own pages: legality depends on jurisdiction and use, so ask someone who knows.

A practical rule for the CRM: load companies, not people. Personal data (a personal email, a phone number) comes with consent rules that a company listed in a business directory usually does not. In Robots the CRM destination can create companies by domain, and that is the route we use here.

## Step 1: create the robot and read the list

Create a new robot from Templates. "List and each detail page" fits this case, since it already has the structure: open the URL, extract a list and loop over it. Replace the URL with the directory's.

In the Extract list step:

1. **Card selector.** The block that repeats for each company, for example `li.company`.
2. **Fields.** One column name per data point, with a selector relative to the card: `name`, `site` (the `href` attribute of the link), `city`, `category`, `phone`. Up to 20 fields per row.
3. **Pagination.** Choose the mode the directory uses: Next button, Load more button or Infinite scroll. Set a maximum number of pages. Robots walks up to 20 pages per step and collects up to 1,000 rows in total.

If the site shows the phone only on the company page, the Loop over list step opens each link and reads the missing fields there. Turn on "If an item fails, log a warning and go to the next item" so one broken page does not stop the others.

Run the robot once by hand. In the Runs tab you see the rows it produced. If a column is missing, the cause is almost always an overly specific selector.

## Step 2: choose the table key

Open the Data tab. Robots keeps a table across runs and marks each row as new, changed or gone. For that to work it needs a unique key: enter `site`. With no key, the whole row counts as the key, and a phone change would look like one new company plus one company that disappeared.

The table holds up to 10,000 rows per robot and you can download it as CSV whenever you want.

## Step 3: send the companies to the CRM

In Integrations, add a CRM destination and pick Companies (by domain or name). Then map the columns to CRM fields: name, domain, website, phone, industry, city and country.

Two decisions that prevent trouble:

- **Domain.** Map `site` to Domain or to Website. The destination normalizes the URL to a lowercase domain and looks for an existing company with that domain. If there is no domain, it looks by name.
- **If the record already exists.** The default is "Only fill empty fields": it never overwrites what your team typed by hand. Choose "Leave it unchanged" if the robot should only add new companies, or "Overwrite with the robot's data" only if the directory is your source of truth.

The destination runs after each successful run and sends the new and changed rows, not the whole table. Rows with neither a name nor a domain are skipped, and the run result reports how many were created, updated and skipped.

## Step 4: schedule it and hear about changes

In Schedule, a weekly run is enough for a directory. The minimum interval Robots accepts is 5 minutes, but a company listing does not change that often, and the less you ask, the calmer the source site stays.

In Integrations also turn on the change email: it arrives with the new rows and the ones that are gone. If the robot fails several times in a row (say, because the directory was redesigned), the schedule pauses on its own (by default after 3 failures in a row, configurable) and stops hitting a broken page. The "Re-learn selectors automatically" option, which is off by default, makes Robots try to find the element again by its fingerprint from the last good run and save the new selector if the run ends well.

## Step 5: prioritize with an AI column

A list of 400 companies is not a call list yet. In Data you can add an AI column that fills in each row from a short instruction, such as "Is this a company with fewer than 50 people according to its description? yes or no". Each column processes up to 100 rows per run and rows that did not change keep their value. In the cloud, AI is billed by tokens.

Treat that column as a hint and not as a fact: check a sample before filtering with it.

## What it still does not do

- It does not solve captchas. If the directory uses them, the robot does not get through.
- The CRM destination creates contacts only with an email. A directory that does not publish emails gives you companies, not contacts, and that is the right outcome for this flow.
- It does not enrich with third-party emails or buy databases. What enters the CRM is what the site showed.

## What changes compared to a credit plan

With a credit service, every extracted row uses up quota, and walking 20 pages every week shows on the invoice. In zerosoft the core is AGPL: on your server the robot runs in your Chromium and the table lives in your database. In zerosoft Cloud you pay for usage at cost times three, with both numbers visible.

The practical result: one robot, a table with history and companies in the CRM that already had a record before your team opens the directory. After the first run, your job is to review each week's new rows, not to rebuild the list.
