---
title: "An internal wiki with Docs, step by step"
description: "How to build a company wiki with Docs: a page tree, [[ links, templates, comments, sharing and trash, plus the limits to know before you start."
date: "2026-08-25"
author: "zerosoft"
tags: ["docs", "wiki", "playbook"]
---

Every company has a wiki. Most of them are a graveyard: an onboarding page from three years ago, a "Processes (WIP)" folder, and a link to a Google Doc nobody can open. The tool is rarely the problem. The structure is.

This is a step-by-step guide to building an internal wiki with Docs that stays alive. Docs gives you a fairly small set of pieces: nested pages, `[[` links, templates, comments, sharing, trash, and that's exactly the point: fewer pieces, fewer ways to make a mess.

## Step 0: one workspace for the team

If you're using Docs inside a team workspace, everyone in the team works on the same page tree. That's your wiki. You don't need a special "wiki mode"; you need agreement on the top level of the tree.

Which brings us to the most important decision.

## Step 1: design the top level (and keep it short)

Pages in Docs nest as deep as you want. Each page can hold subpages, and the sidebar shows the whole tree. That's a trap if you start with fifteen top-level pages. Start with five or six, at most:

- **Start here**: what the company does, who's who, where things live.
- **How we work**: processes, rituals, policies.
- **Teams**: one subpage per team, each team owns its subtree.
- **Customers**: playbooks, FAQs, escalation paths.
- **Decisions**: one page per decision, newest first.
- **Archive**: where old stuff goes instead of being deleted.

Create a page from the sidebar with **New page**, and a subpage with the small arrow next to any page in the tree. Reorganizing is drag-and-drop: drag a page onto another to nest it under that one, or onto the top-level drop zone to bring it back up. Moving a page moves its whole subtree with it.

Give each top-level page an icon (there's an emoji picker) and, if you like, a cover. It sounds cosmetic; it's how people find things in a sidebar at a glance.

## Step 2: write pages people can skim

The editor is block-based: type `/` for the command menu. You get paragraphs, three heading levels, bulleted and numbered lists, to-dos, quotes, code blocks with a language, dividers, simple tables, and a **database** block: a small table with typed columns (text, number, select, date) that you can also show as a gallery. Inline formatting covers the usual: bold, italic, links and so on.

For wiki pages, the rule is simple: headings first, prose second. Someone landing on "Expense policy" wants the answer in five seconds, not a story. A table or a short database block is often better than three paragraphs: a list of tools with an owner and a renewal date, for instance.

## Step 3: link everything with `[[`

The difference between a wiki and a folder of documents is links. In any page, type `[[` and start typing a page title; Docs searches titles as you type and inserts a link to the page you pick.

Use it aggressively:

- Every process page links to the team page that owns it.
- Every decision page links to the pages it changed.
- The **Start here** page is mostly `[[` links.

Need a specific person to look at something? Type `@` and pick a teammate. They get a notification that you mentioned them on that page.

Search in Docs is by title. It's what powers `[[`. It doesn't search inside page bodies. That's one more reason for descriptive titles: "Expense policy" beats "Money stuff v2".

## Step 4: templates, built-in and DIY

When you create a page from the Docs home, you can start from a template: **Meeting notes** (agenda, notes, action items), **Project spec** (problem, goals, non-goals, plan, open questions), **Weekly retro**, or a blank page.

You can't save your own templates yet, but there's a good workaround: make a page called **Templates** at the top level, put your house formats under it (an "Incident postmortem", a "Decision record", a "New hire checklist"), and use **Duplicate** from the page options when you need one. Duplicate copies the page and all its subpages, so a template can even be a small tree: say, a project page with "Spec", "Launch checklist" and "Retro" already nested inside. Then drag the copy where it belongs.

## Step 5: comments instead of side conversations

Every page has a comments panel. You can comment on the whole page or on a specific block, so feedback lands next to the paragraph it's about instead of in a chat thread nobody will find later.

Resolve a comment when it's handled; you can reopen it if it wasn't. A good habit for wiki owners: once a month, open the pages you own and clear out unresolved comments. Open comments on a wiki page usually mean the page is wrong.

## Step 6: sharing

Each page has a **Share** panel with three kinds of share: public, with a team, or with a specific user. For an internal wiki, the team workspace already gives your team the full tree, so most pages won't need anything extra.

Each share sets whether the person or team can view or edit; people with view access open the page read-only. Two honest notes. First, if you want customers to read some pages, publish them: they form a [help center](/blog/centro-de-ayuda-con-docs) at `/h/<your-handle>`, with no custom domain on zerosoft Cloud. Second, inside the workspace everyone can edit: there's no per-page "view only" for members of the same team.

## Step 7: the trash, and the archive habit

Delete a page and it goes to the **Trash** on the Docs home, where you can restore it or delete it permanently. Deleting permanently also removes the page's subpages, and there's no undo for that.

Our recommendation: use the trash for mistakes and the **Archive** page for history. Old processes get dragged under Archive with a line at the top saying what replaced them and a `[[` link to it. History is useful; confusion isn't.

## Bonus: let your wiki answer customers

If you also use Chat, the auto-answer bot can use your Docs pages as its knowledge source. With AI enabled, it answers with an AI model using the most relevant pages as context, so it works best with short, well-titled pages. Which is what a good wiki has anyway.

## The limits to know before you start

Docs doesn't have realtime co-editing: if two people edit the same page at the same time, the second one to save gets a warning and chooses between loading the new version or overwriting it. Plan for page owners rather than crowds. Each page keeps a history of up to 50 versions and exports to Markdown or PDF, but there's no full-text search, no export of the whole space and no Notion import. If your team lives in one giant page edited by ten people at once, or you need to bring over years of Notion content, those gaps matter.

For a team that wants a tidy, linked, owned wiki on its own server (free to self-host, or on zerosoft Cloud with a free tier), the pieces above are enough. The rest is discipline, and no tool sells that.
