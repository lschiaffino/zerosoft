---
title: "Static lists, dynamic lists and custom fields in zerosoft CRM"
description: "How to segment contacts with static lists, dynamic lists, saved views and custom fields: what each is for, its limits, and rules to keep the data clean."
date: "2026-09-20"
author: "zerosoft"
tags: ["crm", "segmentation", "how-to"]
---

Every CRM eventually grows a junk drawer. A field called "Notes 2". A select with the options "Yes", "yes" and "Y". Thirty lists named "Webinar", "Webinar March", "webinar march FINAL". None of it was a bad idea at the time. Together, they make segmentation slower than exporting to a spreadsheet, which is exactly what people end up doing.

zerosoft CRM gives you three tools to slice your contacts: static lists, dynamic lists and saved views, plus custom fields to slice by. They overlap a little, and each has limits worth knowing. Here's when to use which.

## The three tools, in one paragraph each

**Static lists** are a hand-picked set of contacts. You add people from the list's page (search and add) or automatically with the workflow action "Add to list". They don't change unless someone, or a workflow, changes them. Good for: event attendees, beta customers, "people we met at the fair".

**Dynamic lists** are a saved filter over contacts that recalculates every time you open it. The filter can combine a text search (name or email), lifecycle stage, lead status and source. The lists page shows the live member count; the list itself shows up to 500 members. Good for: "all SQLs", "new leads from referrals", "everyone in bad timing".

**Saved views** are a saved table configuration on contacts, companies, deals or tasks: quick filters, advanced filters and sort. The advanced filter builder combines rules with AND and works on standard fields and on custom fields. Good for: anything that depends on a custom field, or on companies and deals rather than contacts.

## The limit that decides most cases

Here's the honest part: **dynamic lists only filter on four things**: text search, lifecycle stage, lead status and source. They don't filter on custom fields, owner, company or creation date, and lists are contacts only.

So the rule of thumb is simple:

- Segment depends on lifecycle, lead status or source → **dynamic list**.
- Segment depends on a custom field, an owner, a date, or is about companies or deals → **saved view**.
- Segment is a list of specific people that no filter describes → **static list**.

One more thing lists don't do: they're not mailing lists. zerosoft CRM doesn't send marketing campaigns or sequences. A list is for organizing, counting and triggering work, not for blasting email.

## Custom fields: what exists

Custom fields live in Settings → Custom fields and can be added to **contacts, companies and deals**. Five types:

- **Text**: free text.
- **Number**: amounts, counts, months.
- **Date**: renewal dates, trial end, last audit.
- **Select**: a fixed set of options (up to 100).
- **Boolean**: yes or no.

Each field has a **key** and a **label**. The key is what the data, the API and workflows use: lowercase, starting with a letter, only letters, digits and underscores, like `contract_months` or `renewal_date`. The label is what people see, and you can change it anytime. Pick the key carefully: in the settings screen you can edit the label and the select options, not the key.

Where custom fields show up:

- In the **record page**, in its own section.
- In **filters**: select fields become quick dropdown filters on the contacts and deals tables, and every custom field is available in the advanced filter builder with operators that fit its type (contains, =, >, before, between, is / is not…).
- In **workflows**: "Update field" can set `custom.your_key`, and emails and notifications can print `{{contact.custom.your_key}}`, `{{deal.custom.your_key}}` and so on.
- In the **API**, as the `custom` object on contacts, companies and deals.
- In **exports**, inside the `custom` column.

## Rules for not making a mess

### 1. Prefer select over text whenever the answer is a category

A text field called "Industry" will collect "SaaS", "saas", "Software" and "software (B2B)" within a month. A select with six options can't. If you can list the answers, it's a select. Text is for things that are truly free: a short note, a reference number.

### 2. Prefer a standard field over a custom one

Before creating a field, check whether one already exists. Lifecycle stage, lead status, source, priority, amount and close date are standard and work everywhere: dynamic lists, reports, the board. A custom "Lead temperature" that duplicates lead status will split your data in two.

### 3. Name keys for the future, not for today

`q3_webinar_attended` is a field you'll delete in October. `webinar_attended_at` (a date) works for every webinar. Name keys after the stable concept, put the variable part in the value.

### 4. Every field needs an owner and a reason

If nobody can say which report, filter or decision uses a field, don't create it. Review custom fields once a quarter. Deleting one is admin-only and removes it from forms and filters, but it doesn't scrub the stored values from the records, which still travel in exports. Deleting is cleanup, not erasure.

### 5. Dynamic before static

A static list is frozen the moment you make it. A month later it's wrong in both directions: people who should be in it aren't, and people who shouldn't, are. If a filter can describe the segment, use a dynamic list or a saved view. Use static lists only when the membership is a fact about the past ("attended the March event") rather than a state ("is a customer").

### 6. Let workflows maintain static lists

When a static list does make sense, don't maintain it by hand. Example: "Customers 2026" as a static list, fed by a workflow with the trigger **Deal won** and the action **Add to list**. The action adds the deal's first contact. It's an append-only log of who became a customer, no clicking required.

### 7. One naming convention for lists

Pick a pattern and stick to it, for example `[Type] Description`: `[Event] Fair Madrid 2026`, `[Segment] SQL from referrals`, `[Ops] Untouched leads`. When there are 40 lists, you'll be glad they sort themselves.

## A worked example

Say you run a small agency and want to find "clients whose contract renews in the next 60 days".

1. Create a custom field on **companies**: `renewal_date`, type Date.
2. Fill it in for your clients (by hand, or once via the API if you have it in a spreadsheet).
3. In the companies table, open advanced filters: **lifecycle is Customer** AND **renewal_date between** today and 60 days from now.
4. Save it as a view: "Renewals, next 60 days".

That's a saved view, not a list, because it depends on a custom field and lives on companies. Remember that filter dates are absolute, so update the range when you use it.

The best CRM setup isn't the one with the most fields and lists. It's the one where every field has a reason, every list has a rule, and anyone on the team can find the right segment in ten seconds.
