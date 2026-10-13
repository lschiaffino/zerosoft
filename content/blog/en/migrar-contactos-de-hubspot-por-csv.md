---
title: "Moving your contacts out of HubSpot with a CSV"
description: "A step-by-step guide to exporting contacts and companies from HubSpot and importing them into Zerosoft CRM: column mapping, dedupe by email and domain, and what doesn't come along."
date: "2026-07-24"
author: "Zerosoftware"
tags: ["crm", "hubspot", "migration"]
---

Leaving a CRM sounds like a quarter-long project. For most small teams it's an afternoon: two CSV files, a mapping screen and a cup of coffee. The trick is knowing exactly what the importer does with each row before you hit the button, so you don't end up with 400 duplicates and a lifecycle column full of blanks.

This is the honest version. What moves, what doesn't, and the order that saves you from cleaning up afterwards.

## What you can import (and what you can't)

Zerosoft CRM's importer (`/app/crm/settings` → Import / Export) handles two entities:

- **Contacts**: first name, last name, email, phone, job title, website, city, country, lifecycle stage, lead status and source.
- **Companies**: name, domain, industry, employees, phone, website, city, country and lifecycle stage.

What it does **not** import today:

- **Deals.** There's no deal importer yet. If you have a live pipeline, you either recreate the open deals by hand (usually the fastest route for a small team) or script it against the public API: `POST /api/v1/crm/deals` exists and takes pipeline, stage, amount, close date and contacts.
- **Activities.** Notes, calls, emails and meetings logged in HubSpot stay in HubSpot. Export them to a file for reference; they won't land in the timeline.
- **Custom fields.** The CSV mapping only targets the standard fields above. Custom field values can be set through the API (`custom` on contacts, companies and deals), not through the CSV screen.
- **Owners.** There's no owner column in the import. Assign owners afterwards, from each record or via the API.

If any of those is a deal-breaker, better to know it now than halfway through.

## Step 1: export from HubSpot

From HubSpot, export your contacts and your companies as two separate CSV files from each object's index view. Two tips:

- **Export only what you'll map.** HubSpot exports can carry dozens of columns. Columns the importer doesn't recognize are ignored by default, but a 60-column mapping screen is how mistakes happen. Pick the properties in the view before exporting.
- **Keep the raw files.** Store the original exports somewhere safe. They're your backup of everything that doesn't move, including custom properties and record IDs.

## Step 2: import companies first

Order matters. When a contact is created without an explicit company, Zerosoft looks at the domain of their email and links them to the company with that exact domain (personal addresses like Gmail are skipped). So if `ana@acme.com` arrives after a company with domain `acme.com` exists, Ana gets linked automatically.

That only works if the companies are already there. Companies first, contacts second.

For the domain match to hit, the company's domain has to be the bare domain: `acme.com`, not `https://www.acme.com/`. Clean that column before importing.

## Step 3: the mapping screen

The importer is three steps: upload (or paste) the CSV, map columns, see the result. On the mapping step each column in your file shows its header, a sample value from the first row and a dropdown with the target field. The importer guesses based on the header name, ignoring case, spaces and punctuation, and knows a few aliases in English and Spanish (`nombre`, `correo`, `empresa`, `cargo`…).

With typical HubSpot headers, some map themselves and some need a click:

- Usually auto-mapped: `First Name`, `Last Name`, `Email`, `Job Title`, `City`, `Lifecycle Stage`, `Lead Status`, `Industry`, `Company name`.
- Usually need manual mapping: `Phone Number`, `Country/Region`, `Website URL`, `Company Domain Name`, `Number of Employees`.

Anything you leave on "— ignore —" is dropped. `Record ID` and friends can stay ignored.

### Enum values: the silent trap

Lifecycle stage, lead status and source are fixed lists in Zerosoft:

```
lifecycle:   subscriber, lead, mql, sql, opportunity, customer, evangelist
lead status: new, open, in_progress, open_deal, unqualified, connected, bad_timing
source:      organic, referral, ads, social, email, event, other
```

The importer accepts these case-insensitively, so `Lead` or `Customer` work. But a value that doesn't match exactly is **silently left empty**, not rejected. If your export says `Marketing Qualified Lead` or `In Progress`, find-and-replace it to `mql` or `in_progress` in the CSV first. Otherwise the contact imports fine and the field is blank, which you'll discover three weeks later in a report.

## Step 4: pick a dedupe mode

Before running, you choose what happens when a record already exists:

- **Skip it**: existing records are left alone; the row counts as skipped.
- **Update it**: existing records get the values from the file.

Dedupe keys are simple and worth memorizing:

- **Contacts** dedupe on email, case-insensitive. `Ana@Acme.com` and `ana@acme.com` are the same person.
- **Companies** dedupe on domain, case-insensitive.

And the edge cases:

- A contact **without an email** is always created. There's no key to compare, so re-importing the same file creates the same email-less contacts again.
- A company **without a domain** is always created, for the same reason. A company row with neither name nor domain is rejected.
- A row with an **invalid email** isn't imported and shows up in the error list with its row number.
- In update mode, **empty cells don't overwrite** anything. Only non-empty values travel, so a sparse file won't wipe good data.

Each import runs in a single transaction and shows a summary: total, created, updated, skipped and errors.

## Limits worth knowing

- Up to **5,000 rows per import**. Bigger file? Split it. Same mapping, run it again.
- Up to **20 imports per hour** per user.

If you have 40,000 contacts, that's eight files and a few minutes, not a support ticket.

## Step 5: check, then clean up

After importing:

1. **Merge leftover duplicates.** Each contact's page has a duplicates panel that lists other contacts sharing the same email and lets you merge them. The one you drop hands its deals, activities, emails and static-list memberships to the one you keep.
2. **Spot-check enums.** Filter contacts by lifecycle stage. If a big chunk has none, that's the trap from Step 3.
3. **Pause automations during big imports.** Imported contacts are created like any other, so a workflow triggered on "Contact created" can react to them. If one sends emails, switch it off before importing 5,000 rows.

## Doing it from a script instead

If you're comfortable with a bit of code, the public API (`/api/v1/crm/contacts`, `/companies`, `/deals`, documented at [/docs](/docs)) lets you move what the CSV can't: custom fields, owners, deals. Authenticate with a personal key in `Authorization: Bearer zs_…` and stay under 100 requests per minute.

Most teams don't need it. Two CSVs, companies first, clean the enums, pick a dedupe mode. Then the important part: [your data can leave just as easily](/blog/exportar-tus-datos-deberia-ser-un-derecho). Admins can export contacts, companies, deals and activities as CSV or JSON whenever they want.
