---
title: "Migrating from Notion to Docs: two paths and a checklist"
description: "How to move your Notion workspace to Docs with the Markdown and CSV export or an API integration: what travels, what to review and in what order."
date: "2026-10-29"
author: "zerosoft"
tags: ["docs", "notion", "migration"]
---

A Notion workspace piles up over the years: wikis, project databases, meeting notes, pages someone duplicated "just in case". Moving it elsewhere feels like a chore, usually because of a question nobody can answer offhand: what gets lost on the way?

This guide answers that for Docs. There are two import paths, a list to work through before and another to check after. If you are still deciding whether Docs is enough for you, read the [comparison with Notion](/blog/zerosoft-docs-vs-notion) first.

## Before you start: sort what you are moving

Importing is a good excuse to leave the junk behind. An hour of prep saves several later:

1. Open your workspace and list the ten pages your team actually consults.
2. Mark the databases that are still alive (rows edited in the last few months).
3. Archive or delete the rest. If in doubt, export it anyway and park it in an Archive page.

With that map, the rest is mechanical.

## Path 1: the Markdown and CSV export

The simplest path, and it needs nobody's credentials.

**In Notion.** According to their [official export help](https://www.notion.com/help/export-your-content), the whole-workspace export lives in Settings, General, Export all workspace content, and Notion emails you a download link when it is ready. They note it can take a long time on large workspaces and that the link expires after 7 days, so do not leave it for the last day. You can also export a single page from its three-dot menu. Pick Markdown & CSV, with subpages and with files and images.

**In Docs.** Open Docs, go to Import, choose Notion as the source, pick the destination (the workspace or a teamspace you can write in) and upload the .zip. Before anything is written, Docs shows a preview with the number of pages, databases, files and total size, plus the page tree. If it looks right, you confirm.

What the importer does, according to the code:

- Each .md file becomes a page, keeping the folder tree Notion builds.
- Links between pages in the export become `[[` links to the new pages, so your web of references survives.
- Images and attachments are uploaded to your storage as image or file blocks.
- Notion `<aside>` blocks become callouts.
- Each CSV becomes a database block with the column types detected. The page of each row comes in as that row's body, not as a subpage.
- Limits: up to 1 GB per file and 5,000 pages per import. If you import the same export again, pages that already came in are skipped instead of duplicated.

## Path 2: the API integration

Use it when you do not want to wait for an export, when you only need part of the workspace, or when you want to sync again later.

1. In Notion, create an internal integration and copy its secret. Give it permission to read content and, if you want people to match your members, to read user information including email.
2. On every root page you want to bring over, open the three-dot menu, Connections, and add the integration. What you do not share with it stays invisible.
3. In Docs, go to Settings, Import, Notion, paste the secret and pick the destination. Docs tests the token with a read request before importing anything.
4. Check the preview: it shows pages, databases and rows, lets you choose what to bring (pages, databases, images and files) and estimates how long it takes.

This path respects Notion's API limit of 3 requests per second, so a large import can take several minutes. If it stops, it resumes where it left off. Mentions and links between pages are rewritten to point at the imported pages, formulas and rollups come in with their current value (not as live formulas), and files up to 10 MB are copied to your storage.

A practical advantage: importing again updates what was already imported instead of duplicating it. And if someone edited an imported page in zerosoft, it is not overwritten unless you choose to replace it on purpose. That allows a staged migration: bring one team, try it for a week, then bring the next.

## What to review afterwards

No migration is identical to its source. Give this list half an hour:

- **Key pages.** Open your ten most used pages and compare them with Notion. Titles, lists, tables and code should look the same.
- **Databases.** Check the column types it detected (dates, selects, numbers) and the views. Formulas and rollups arrive with the value from import time; if you relied on them recalculating, you need to rebuild them.
- **Links.** Pick a page with many references and click every `[[`.
- **Large files.** Anything over 10 MB keeps its name but is not uploaded. The import summary tells you how many.
- **Access.** Notion permissions do not travel. Pages get the access of the destination you chose, so create the teamspace before importing and give it the right members.
- **Public pages.** If you published Notion pages with a link, republish them from Docs; the URL changes.

## A one-week plan

- **Day 1.** Tidy the Notion workspace and request the export.
- **Day 2.** Import into a test teamspace and run through the list above.
- **Day 3.** Fix what came out different and tell the team.
- **Day 4.** Import the rest into the final destination.
- **Day 5.** Switch the habit: the new wiki is the only place anyone writes.
- **After that.** Leave Notion read-only for a month and export it one last time before closing it.

## Why it pays to think about the exit

Migrating is a good moment to ask where your data lives. In Docs you can export each page to Markdown or PDF, and if you self-host zerosoft, the pages sit in your own database and storage. The next move, if you ever need one, does not depend on an email with a link that expires. Docs has its own limits, which we publish on the [product page](/products/docs): read them before you decide.
