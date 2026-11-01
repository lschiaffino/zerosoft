---
title: "How to migrate from Pipedrive to the zerosoft CRM"
description: "Move Pipedrive persons, organizations, deals, pipelines, custom fields and activities into the CRM with your API token, and what to check once it finishes."
date: "2026-10-31"
author: "zerosoft"
tags: ["crm", "pipedrive", "migration", "guide"]
---

If your team runs on Pipedrive, the hard part of a move is the pipeline: open deals, the stage each one sits in, and the trail of calls and notes that explains why. The zerosoft [CRM](/products/crm) pulls all of that straight from the Pipedrive API, with a preview before anything is written. Here is what comes across field by field, what stays behind, and the exact steps.

## What you need

One thing: your Pipedrive **personal API token**. In Pipedrive, open your avatar › Personal preferences › API. Use an admin account's token. A token sees what its user sees, so an admin token brings everyone's records.

On the zerosoft side, a workspace admin runs the import. The token is stored encrypted while the import runs and deleted when it finishes, fails or you cancel it. It never goes in a URL.

## What gets imported

The importer reads five things in this order: organizations, persons, deals, notes and activities. Before that it reads users, custom fields and pipelines.

- **Organizations become companies.** Name, website (the domain is taken from it), industry, employee count, city and country from the address, and owner.
- **Persons become contacts.** First and last name, primary email and phone, job title, owner, and their organization as the primary company.
- **Pipelines and stages**, in order and with each stage's probability. If you already have a pipeline or stage with the same name, it is reused.
- **Deals.** Title, pipeline, stage, value, currency, close date, owner, lost reason, and the linked person and organization. Open, won and lost deals come over; deleted ones don't.
- **Notes** land on the timeline of the contact, company or deal they were attached to, with their date and author. Pipedrive's HTML is converted to plain text.
- **Activities.** Calls, meetings and emails keep their type. Any other type, including custom ones you created, comes in as a task. Subject, note, due date, done state and duration come along.
- **Custom fields** on persons, organizations and deals. Each one becomes a custom field with a matching type: number, currency, date, select, multi-select, phone or text. Select options keep their labels.
- **Owners.** Each Pipedrive user is matched by email with a workspace member. You assign the ones that don't match, or invite them from the same screen.

### Won and lost

In Pipedrive, won or lost is a deal status. In the CRM it is a stage. So every imported pipeline gets two extra stages at the end, **Won** and **Lost**, and closed deals go there. The close date comes from when the deal was won or lost, or from the expected close date if it is still open.

## What doesn't come across

Reading the importer's code, these stay in Pipedrive:

- **File attachments** on deals, persons or organizations.
- **Leads** from the Leads inbox and **products** on deals. The importer doesn't read those parts of the API.
- **Secondary emails and phones.** Only each person's primary one travels.
- **System fields** not listed above, such as the person's label or the full address (only city and country).
- **Deal descriptions** and call outcomes.

If you need any of these, export them from Pipedrive as a backup before you close the account.

## Step by step

1. **Open the importer.** In zerosoft, go to Settings › Import and pick **HubSpot or Pipedrive to CRM**. It is also inside the CRM, under Settings › Import and export › **Import from another CRM**.
2. **Connect.** On the **Import from Pipedrive** card, click **Connect Pipedrive**, paste the token into **API token** and click **Connect and preview**.
3. **Review the preview.** Nothing has been imported yet. You get a sample of companies and contacts, the custom fields (each set to use an existing field or create one), the pipelines with their stages, and the owners table. Pipedrive doesn't report totals up front, so the count reads "All".
4. **Choose what to import.** Under **What to import**, tick Companies, Contacts, Deals and Activities. Activities include notes.
5. **Assign owners.** Email matches are already marked. For the rest, pick someone or keep the default owner. If you invite that person later and they join with the same email, the records nobody reassigned in the meantime become theirs.
6. **Click Start import.** It runs in chunks in the background. You can close the tab: the screen picks it up when you come back, and progress counts what has been processed.

## What to check afterwards

- **The per-object summary.** At the end you see processed, created, updated, skipped and failed. If anything failed, the warnings list says what.
- **The duplicates that weren't created.** A contact with an existing email or a company with an existing domain isn't duplicated. Its empty fields get filled in instead.
- **The Won and Lost stages.** If your process uses other names, rename them in the pipeline settings.
- **Your automations.** Imported records are written directly and don't trigger workflows or webhooks. If a workflow should have run for existing contacts, run it by hand.
- **A few big deals.** Open three or four and compare value, stage and timeline against Pipedrive.

## Running it again

Every record keeps its Pipedrive id, so a second import updates instead of duplicating. If someone edited a record in zerosoft after the import, it isn't overwritten. Only empty fields are filled, unless you tick **Replace with Pipedrive** (it overwrites changes made in zerosoft). That lets you migrate in two passes: import now, let the team try it, then run it once more on the day you switch Pipedrive off.

If you'd rather work with files, the CRM's CSV import has a **Pipedrive export** preset that maps the columns for you. Mapping and enum values work the same as in [the HubSpot CSV guide](/blog/migrar-contactos-de-hubspot-por-csv).

## What is still missing

Our parity table compares the CRM with HubSpot, not Pipedrive, so these are only the gaps we publish there:

- **Notetaker.** Calls and meetings on the timeline get an AI summary from their notes or an attached transcript. No bot joins the call to record it.
- **Native app.** It's an installable app (PWA) on iOS and Android, and views you already opened work offline. It isn't in the App Store or Google Play.
- **App directory.** Slack, Zoom, Stripe, Zapier and Make are built in, plus webhooks and a REST API. There's no third-party marketplace.

## What it costs

Self-hosting is $0, with the code under AGPLv3 and every feature included. zerosoft Cloud has a free plan to start, then charges for usage such as emails and storage. Seats aren't charged, so adding ten reps doesn't change the bill. For a side-by-side with HubSpot, see [zerosoft vs HubSpot](/compare/zerosoft-vs-hubspot).

Once you're in, a good first job is a [pipeline cleanup](/blog/higiene-del-pipeline): deals from an old CRM tend to carry stages nobody has touched in months.
