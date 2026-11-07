---
title: "How to migrate from Evernote to Notes with .enex files"
description: "Move your Evernote notebooks into Notes: how to export the .enex, what comes across (attachments, tags, dates, to-dos), what gets lost and what to check after."
date: "2026-10-31"
author: "zerosoft"
tags: ["notes", "evernote", "migration", "guide"]
---

Leaving Evernote is daunting because of the sheer volume: years of notes, web clips, scanned PDFs and half-checked to-do lists. The good part is that Evernote exports everything to an open format, `.enex`, and [Notes](/products/notes) reads it. Here is what the importer brings note by note, what it leaves out, and how to do it one notebook at a time so you don't end up with one big pile.

## What you need

No token and no connection to your Evernote account. Just the `.enex` files the desktop app exports. Anyone in the workspace can import into Notes; you don't need to be an admin.

The limits, straight from the importer's code:

- **4 MB per** `.enex` **file.**
- **500 notes per file.** If a notebook has more, the whole file is rejected, so export it in parts.
- **100 attachments per file**, each up to 4 MB.
- **Up to 20 files** at once from the file picker.

## What gets imported

For every note in the `.enex`:

- **The title.**
- **The content**, turned into editor blocks: headings (levels 4 to 6 become H3), paragraphs, bulleted and numbered lists, quotes, code blocks, dividers and tables.
- **Checkboxes**, with their state. A to-do you ticked in Evernote arrives ticked.
- **Text formatting:** bold, italic, underline, strikethrough, inline code and links (`http`, `mailto` and `tel`).
- **Attachments.** Images, PDFs and other files are uploaded and placed where they sat in the note. Any that weren't referenced in the text go at the end.
- **Tags.**
- **Created and last-edited dates**, so the list keeps its order.
- **The source URL** on notes you clipped from a web page.

You can also import Markdown files (`.md`, `.markdown` or `.txt`): one note per file, titled from the front matter, a leading `# Title`, or the file name.

## What doesn't come across

- **The notebook name.** The `.enex` doesn't carry it. Notes land in whatever notebook you have open when you import (see below for how to use that).
- **Encrypted text** made with Evernote's encrypt feature. It's dropped, so decrypt it in Evernote before exporting.
- **Remote images**, the ones that were a link to another site rather than an attachment.
- **Colors, fonts and highlights.** Tables arrive with each cell's text and no formatting, up to 200 rows and 20 columns.
- **Reminders, author and location** on the note.
- **Blocked attachments** such as SVG or HTML, and anything over 4 MB. The note still imports, without that file.

## Step by step

1. **Export from Evernote.** In the desktop app, right click the notebook › Export notebook and pick `.enex`. Do this for each notebook.
2. **Create the notebooks in Notes**, one per Evernote notebook, with the same names.
3. **Open the target notebook** in the Notes sidebar.
4. **Click Import notes** at the bottom of the sidebar and choose that notebook's `.enex`. The notes are created there.
5. **Read the toast.** It says how many notes were imported and whether any file couldn't be read.
6. Move on to the next notebook.

If you import with no notebook open, the notes land loose in All notes. You can move them later by selecting several at once, but going notebook by notebook from the start is faster.

## What to check afterwards

- **The counts.** Compare how many notes each notebook had in Evernote with the number in the toast.
- **A note with heavy attachments.** If a PDF is missing, it was probably over 4 MB.
- **Tags.** They show up in the sidebar. If you had variants of the same tag in Evernote, this is a good moment to rename and merge them. We cover that in [organizing notes with notebooks and tags](/blog/organizar-notas-libretas-y-etiquetas).
- **No duplicates.** Importing the same file twice creates the notes twice. If an import stopped halfway, delete what came in before you retry.

## If you want to leave again

The way out is just as open: every note exports as Markdown, `.enex` with attachments, HTML, or PDF through print, and a whole notebook or every note downloads as `.enex`. We wrote about why that matters to us in [exporting your data should be a right](/blog/exportar-tus-datos-deberia-ser-un-derecho).

## What is still missing

Our parity table against Evernote lists these gaps:

- **Searching text inside images and scans.** Text in regular PDFs is searchable. Reading images and scans is switched on per workspace and hasn't been tested with a real model yet. If your Evernote is full of scanned receipts, keep that in mind.
- **Live co-editing.** Notes detects changes from someone else and lets you keep yours or load the latest, but two people can't edit the same note at the same time.
- **Slack, Google and Outlook integrations.** None yet.
- **Email to a note.** Built and tested, but not available on zerosoft Cloud yet.
- **Native apps.** Notes is an installable web app that works at 390 px and offline. There's no native app and no widgets.
- **Transcription with speakers.** Recordings are transcribed, but speakers are only separated with a Deepgram or AssemblyAI key.

## What it costs

Evernote Personal costs about $14.99 a month on monthly billing. Notes on your own server costs $0: the code is AGPLv3 with every feature. On zerosoft Cloud there's a free plan to start, then you pay for usage, such as storage for attachments. Seats aren't charged. The full comparison is at [zerosoft vs Evernote](/compare/zerosoft-vs-evernote), and if you're weighing options, see [Evernote alternatives](/compare/evernote-alternative).
