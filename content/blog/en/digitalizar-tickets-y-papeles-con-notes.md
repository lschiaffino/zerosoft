---
title: "Digitizing receipts and paperwork with your phone: a ten minute a week method"
description: "How to go from the shoebox to notes you can actually find: taking the photo, scanning several pages into one PDF in Notes, naming, tagging and searching. With what text reading does today and what it still doesn't."
date: "2026-11-01"
author: "zerosoft"
tags: ["notes", "evernote", "documents"]
---

Evernote has a guide on [how to scan and organize receipts](https://evernote.com/en-us/learn/how-to-scan-receipts). The basics it covers are the right ones: flatten the paper, find good light and keep a backup copy. After that the guide leans on its app's text recognition to make scans searchable.

This post takes the same problem (a pile of paper you can't find when you need it) and solves it with Notes, the zerosoft notes app. It gives you a weekly routine, a naming convention and a list of what Notes doesn't do yet, which isn't short.

## What to digitize and what to toss

Before the first photo, decide what gets in. A simple rule: digitize what you might need to prove or look up, and throw out the rest.

- **Yes:** invoices and receipts for big purchases, warranties, contracts, tax payment proofs, prescriptions, certificates.
- **Depends:** bank statements (many banks already offer a PDF, so download it instead of photographing paper).
- **No:** flyers, a coffee receipt, mail you've already answered.

Mind thermal receipt paper: the ink fades over time. If a receipt is a warranty, scan it the same week.

## Taking a good photo

Scan quality is decided before you touch the app.

1. Put the paper on a flat surface that contrasts with the sheet. A dark table under a white page helps edge detection.
2. Flatten it. A curled receipt reads badly where it bends.
3. Use window light or a lamp from the side. Keep your shadow and the flash off the page.
4. Hold the phone parallel to the paper. Perspective correction fixes an angle, but not a blurry shot.

## Scanning in Notes, step by step

Open a note (a new one is fine) and choose "Scan document" in the editor toolbar. The flow:

1. **Take or pick a photo.** On a phone it opens the rear camera. On a computer it lets you pick a file.
2. **Adjust the four corners.** Notes tries to detect the page edges on its own. If it gets them wrong, drag each corner into place or move them with the keyboard arrows.
3. **Leave "Clean up for reading" on.** It converts the image to grayscale and adjusts levels so the background is light and the text dark. If colors matter (a plan, a chart), turn it off.
4. **Add another page** if the document has more than one. The cycle repeats.
5. **"Add to note".** One page becomes a JPG image. Several pages become a single PDF, in the order you shot them.

The cropping and cleanup happen in your browser, before the file is uploaded. The upload limit for a scan is 100 MB. If you go over, the dialog stays open with your pages so you can drop some and try again.

## A title you can search for

A note called "Scan Nov 1, 2026, 10:42" is the default name Notes gives. Change it right away. A formula that works for almost everything:

`Vendor, what it is, month and year`

For example: "Southside Appliances, fridge, warranty, Nov 2026". Inside the note, write one line with the amount, the warranty expiry date and what you expect to do with it. That line is real text, and Notes search always reads it, with nothing else required.

## Notebooks and tags for paperwork

You don't need a separate system. If you already follow the [four notebooks and few tags](/blog/organizar-notas-libretas-y-etiquetas) setup, paperwork goes in Areas (home, finances, health) or in Archive once it stops mattering.

For quick filtering, a short tag list:

- `receipt`, `warranty`, `contract`, `taxes` as types.
- The year, for example `2026`, to build the accountant's folder.
- `review` for what you scanned and haven't named yet.

Notes lowercases tags and turns spaces into hyphens. Keep them plain ASCII so you don't end up with two tags that differ only by an accent.

## What Notes reads from a scan

This part needs precision, because it's where promises get inflated.

- **PDFs with text.** If a PDF already has a text layer (an invoice downloaded from the vendor's site), Notes reads it on the server, with no model involved, and adds it to search. This applies to PDFs added since the feature shipped.
- **Photos and scanned PDFs.** Reading the text in an image needs a vision model. It's off by default. An admin turns it on in the Notes settings, and from then on images and scans that get added are sent to the AI model and use the workspace's AI quota. Earlier files are not read, and locked notes are never included.
- **Size limit.** Notes reads files up to 12 MB. Anything over that can't be searched, and the note tells you which files they are.
- **State of the feature.** We haven't tested it with a real model yet, so we can't tell you how well it reads a crumpled receipt. Until we verify it, treat search inside photos as a bonus and not the main plan: the title and the line of text you wrote are what guarantee you'll find it.

If the content is sensitive (health documents, contracts), think before enabling reading: it sends those files to an AI provider. With Notes on your own installation you choose which model is used and how it's configured.

## Marking up and annotating

For a contract or a form you need to fill in, Notes has "Annotate image or PDF": pen, highlighter, boxes and text, and it saves a copy with your marks while leaving the original untouched. Handy for pointing at the clause you want to ask about or filling in a form by hand.

## The ten minute weekly routine

Digitizing everything in one day doesn't work. A short habit does:

1. **During the week:** paper that matters goes in a tray, no thinking.
2. **Same day every week:** scan the tray. One document per note, several pages in one PDF.
3. **Name and tag** on the spot, while you still remember what it is.
4. **Toss or keep:** papers with legal value (deeds, original contracts, titles) stay even after scanning. The rest goes.
5. **Once a month:** filter by `review` and by notes with no notebook, and finish sorting.

## What Notes doesn't do yet

- **No Evernote importer.** If you have years of notes there, migration is manual today.
- **No notes export** with a button. If you self-host zerosoft, the data is in your database, but that isn't a button.
- **No receipt scanner that pulls amount and vendor** into fields. The text stays in the note and you write the data you care about.
- **No guaranteed automatic crop.** Edge detection helps, but sometimes you have to move the corners by hand.
- **Notes are personal.** You can share one with a link, but there are no shared notebooks for team editing.

## For the fridge door

- Digitize what you might need to prove.
- Flat paper, side light, phone parallel.
- Scan, adjust corners, several pages into one PDF.
- Title: vendor, what it is, month and year.
- One line of text with the amount and dates.
- Ten minutes a week, always the same day.
