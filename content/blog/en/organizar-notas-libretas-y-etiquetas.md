---
title: "How to organize your notes: four notebooks, a few tags and search that finds things"
description: "A note system you can set up in an afternoon: four PARA-style notebooks, a short tag list, pinned notes for daily use and full-text search. With the steps in Notes and what it still lacks."
date: "2026-10-18"
author: "zerosoft"
tags: ["notes", "evernote", "productivity"]
---

Most guides to organizing notes start with structure: notebooks, notebook stacks, nested tags, naming conventions. Evernote has a whole guide on [how to organize notes](https://evernote.com/learn/how-to-organize-notes) and another on the [PARA method](https://evernote.com/learn/what-is-the-para-method). They're fine starting points. The trouble is that the structure becomes the work, and a month later nobody knows whether the recipe goes in "Home" or in "Resources".

This post argues for the opposite: as little structure as you can get away with, because search does most of the work. Four notebooks, a short tag list and a couple of habits. We'll show how to set it up in Notes, the zerosoft notes app, and what Evernote does that we don't do yet.

## The starting rule: capture fast, sort later

A note you never wrote down because you "didn't know where to put it" is the only note that's truly lost. So the system has one rule for the moment of capture: write it and move on. If you don't know where it goes, leave it loose. Sorting waits for the weekly review.

In Notes, press `N` anywhere in the list and a new note opens. Press `/` and the cursor jumps to search. With those two shortcuts, capturing costs almost nothing.

## Four notebooks, PARA style

PARA, from Tiago Forte, splits everything into Projects, Areas, Resources and Archive. We take it as is because it answers a single question: does this have an end date?

1. **Projects.** Something that finishes: "Office move", "October launch", "Lisbon trip". When it's done, its notes move to the Archive.
2. **Areas.** Responsibilities that never end: finances, health, the team, clients.
3. **Resources.** Topics you care about and want close at hand: recipes, saved articles, design references.
4. **Archive.** Everything that isn't active anymore. You don't delete it. You set it aside.

Notice that projects don't get their own notebooks. Each project is a tag inside the Projects notebook. That way you don't end up with forty notebooks, and closing a project means moving its notes, one at a time or during the review.

In Notes you create the four from the sidebar. Each note lives in one notebook (or none). If you delete a notebook, its notes go to the trash and you can restore them from there.

One data point on where you start: Evernote's Free plan allows [one notebook and 50 notes](https://evernote.com/compare-plans), so this system already needs a paid plan there. Notes has no per-plan cap on notebooks or notes.

## Tags: a short, closed list

Tags are for whatever cuts across notebooks. A supplier invoice can sit in Areas and carry the client's tag. The classic mistake is creating a tag for every new topic. Three months in there are two hundred of them, half with a single note.

A list that fits on an index card:

- **One per active project**, named the same everywhere: `office-move`, `october-launch`.
- **One per person or client** you work with often: `acme`, `lucia`.
- **Three status tags**, at most: `todo`, `reference`, `idea`.

Notes lowercases every tag and turns spaces into hyphens, so `October Launch` and `october-launch` end up as the same tag. The rule left to you: if a tag isn't on the list, it goes on the list first. Notes accepts up to 20 tags per note, but if a note needs more than three, it's probably two notes.

To tag, open the note and type in the tag field: Enter or a comma adds one, Backspace on the empty field removes the last one. The sidebar shows each tag with its note count, and a click filters the list.

## Pinned: what you open every day

There are five or six notes you use daily: the grocery list, the store's opening checklist, this week's agenda. Don't search for them. Pin them. In Notes, pinned notes sit at the top of the list and have their own view.

If you've pinned more than ten, they've stopped being special. Check them during the weekly review.

## Search does the rest

This is why you can get away with so little structure. Notes search looks at the title and the full text of every note. If your database supports it (SQLite and Turso with FTS5), it works like this:

- **Prefix matching.** `budg` finds "budget" and "budgets".
- **Every word is required.** `acme invoice` returns only notes that contain both.
- **Ranked by relevance**, with the title weighted above the body.
- **A snippet** around the match, so you know which note it is before opening it.

Combine it with filters: pick the Areas notebook, the `acme` tag and type `contract`. Three clicks, one note.

A habit worth more than any tag: write the title you'll search for. Nobody finds "Meeting". "Acme: 2027 pricing, meeting with Lucía" finds itself.

## Saving from the web without copy and paste

Notes includes a clipper as a bookmarklet: drag it to your bookmarks bar and, from any page, it saves a note with the page title, the source link and whatever text you had selected, as quote blocks. The note arrives tagged `clip`, so in the weekly review you filter by that tag and decide which notebook each one belongs in.

An honest difference from Evernote's Web Clipper: ours saves your selection and the link. It doesn't copy the whole page or its images. For a long article, select the paragraphs that matter; that's usually a better note than the full page anyway.

## Asking your notes

When you can't remember where something ended up, search needs you to remember a word. "Ask your notes" takes a normal question: "how much did we charge Acme last year?". Notes finds the most relevant notes by keyword, hands them to a model with instructions to answer only from them, and shows you which notes it used. If none cover the topic, it says so.

It needs AI configured on your install. On zerosoft Cloud it's billed by tokens. If you leave it off, search works exactly the same.

## The weekly review, in fifteen minutes

1. Filter by `clip` and by notes with no notebook. Move them or delete them.
2. Open the Projects notebook. If a project is done, move its notes to the Archive.
3. Look at your pinned notes. Unpin what you no longer open.
4. Scan the tag list in the sidebar. Tags with a single note: delete them or merge them by hand.
5. Empty the trash if needed.

## What Notes doesn't do yet

So you can decide with everything on the table:

- **No Evernote importer.** Today you migrate by pasting content or using the clipper.
- **No note export.** If you self-host zerosoft, your notes sit in your own database, but there's no button to download them yet.
- **No reminders, notebook stacks or nested tags.** Notebooks are a single level.
- **No PDF or file attachments, and no OCR** on images, one of Evernote's most useful features.
- **Notes are personal.** You can share one through a read-only link and revoke it whenever you want, but there are no shared notebooks for team editing. That's what [Docs](/blog/wiki-interna-con-docs) is for.

## The card to tape to your monitor

- Capture with `N`, search with `/`. Sort later.
- Four notebooks: Projects, Areas, Resources, Archive.
- Tags: one per project, one per client, three for status. Lowercase.
- Pin what's daily, never more than ten.
- Titles you can search for.
- Fifteen minutes a week: clips, finished projects, pinned notes, stray tags.
