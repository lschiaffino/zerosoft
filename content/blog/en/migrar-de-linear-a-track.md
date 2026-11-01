---
title: "Migrate from Linear to Track: what imports and how"
description: "How to move your Linear issues to Track with an API key or a CSV export: what comes across (teams, cycles, labels, comments), what stays behind, what to check."
date: "2026-10-31"
author: "zerosoft"
tags: ["track", "linear", "migration", "guide"]
---

Leaving Linear is scary for one practical reason: years of issues, comments and cycles that nobody wants to retype. This guide covers how the Linear import in [Track](/products/track) works, exactly what it brings (we read it from the importer's code), what it leaves out, and what to check once it's done.

## Two ways in: API key or CSV

Both live in Track under **Settings › Import and export**, and in the workspace import hub (**Settings › Import**, Linear source). Only workspace admins can import, since everything that comes in is visible to the whole team.

**Linear API key.** This is the most complete path.

1. In Linear, open Settings › Account › Security & access › Personal API keys and create a new key.
2. Give it Read access. The importer only reads; nothing is written back to Linear.
3. In Track, pick **Linear (API key)** under *Import from*, paste the key and choose the target under *Into*: an existing team or **A new team for each Linear team**.
4. Hit **Preview**, read what shows up, and confirm with **Import N issues**.

The key is kept encrypted while your data is being read and deleted when the import finishes, fails or is cancelled.

**Linear CSV.** If you'd rather not create a key, export from Linear under Settings › Workspace › Import and export › Export CSV and choose **Linear (CSV export)**. Track recognizes Linear's headers and suggests a column mapping you can adjust (title is required). Files can be up to 4 MB, so split anything bigger. A CSV only carries what its columns carry, which makes the API the safer route for comments and project target dates.

Both paths share external IDs. If you import the CSV first and run the API import later, issues that already came in are not duplicated.

## How Linear maps to Track

Track uses Linear's vocabulary, so most things land where you expect:

- **Teams become teams.** Each Linear team turns into a Track team, and its key (say `ENG`) becomes the prefix for the new identifiers.
- **Linear projects become milestones** inside the team, with their target date. The reason is structural: a Linear project can span several teams, while here it hangs off the team of each issue.
- **States** are matched by name within the team, and created with their category when missing. Backlog and Triage go to Backlog, Unstarted to To do, Started to In progress, Completed to Done and Canceled to Cancelled.
- **Priority.** Urgent, High and Low carry over. Medium and *No priority* both land as Medium: Track has four priorities and no separate "no priority" value.
- **Cycles**, with their start and end dates.
- **Labels** with their colors, up to ten per issue.
- **Estimate**, **due date** and the original **created date**.
- **Sub-issues.** A second pass links each sub-issue to its parent, even when the parent arrived later.
- **Comments** with their dates, up to 50 per issue.
- **Assignees**, matched by email against workspace members.

## What doesn't come across

Good to know before you start:

- **Relations** (blocks, related, duplicate). Only parent and child links are imported.
- **Attachments, reactions and subscribers.**
- **Very long text.** Descriptions and comments are cut at 5,000 characters.
- **Exact identifier numbers.** The prefix comes from the team, but numbers are assigned in Track as issues are created, so `ENG-142` may not end up as `ENG-142`. If you link to issues from other tools, check those links.
- **Later edits.** Re-importing skips issues that are already in and only adds new comments. Rename an issue in Linear after the import and that change won't follow.
- **Huge workspaces.** Each import takes up to 20,000 issues. If you have more, the preview tells you the rest was left out.

## The preview is where you decide

Before anything is created, Track shows how many issues, comments, teams, labels, cycles and milestones are coming. Below that are three tables worth reading:

- **Teams**, marked new or existing.
- **Statuses**, with their type and whether each one is new or reuses an existing state.
- **Assignees**, with the member each one matched. Anyone who isn't a workspace member ends up unassigned, and the preview flags it.

That last table matters most, so **invite your team before you import**. If people are already in the workspace with the same email they use in Linear, issues stay assigned and comments keep their author. If not, the issue arrives unassigned and the comment is signed by whoever runs the import, with the original name in bold above the text.

## While it runs

The import moves in batches. Linear is read 50 issues per page, and if Linear's API answers with a rate limit, the importer waits a minute and carries on. You can close the tab: the per-minute cron picks the job up where it stopped. The import doesn't send notifications or fire webhooks either, because it's a move, not new activity.

## What to check afterwards

When it finishes, the summary tells you how many issues and comments came in, how many were skipped, what was created and how many issues ended up unassigned. Then:

1. **Open three or four big issues** and compare description, labels and comments with Linear.
2. **Look at each team's states.** If Linear had near-duplicates ("In Review" and "Review"), you may want to merge them.
3. **Check the team's cycles** and the active one.
4. **Go through the unassigned issues** and assign them.
5. **Review the milestones** of each team and their target dates.

If something went wrong, fix it in Linear and import again. Whatever is already in won't be duplicated.

## What Track still lacks compared to Linear

It's in our parity table, and here it is again:

- **Native iOS and Android apps with push**: not yet.
- **Offline mode**: not yet.
- **SSO**: sign-in is Google only, no SAML or SCIM. There is an audit log with filters and export.
- **Per-team permissions**: there are private teams and guests limited to chosen teams, but no per-team owner role.
- **Integrations**: Sentry, Figma, Zendesk and Intercom are partly covered. There's no app inside the Zendesk or Intercom sidebar.

The full list, area by area, is at [/compare/zerosoft-vs-linear](/compare/zerosoft-vs-linear).

## What it costs

Linear Standard costs $8 per user per month, so a team of ten pays $960 a year. Track on your own server costs $0; the core is AGPLv3 with every feature. On zerosoft Cloud you start on a free plan and then pay for usage. Seats aren't charged, so adding someone to the team doesn't change the bill.

For a day-to-day comparison, read [Track vs Linear](/blog/zerosoft-track-vs-linear), and to plan once you've moved, [how cycles work in Track](/blog/ciclos-en-track). And if you ever want to leave, Track exports issues to CSV from the same tab you imported in.
