---
title: "How to migrate from Excalidraw to Board (and what about Miro)"
description: "Import your .excalidraw files into Board in bulk: which elements and images come across, what gets dropped, the limits, and what to do if you use Miro."
date: "2026-10-31"
author: "zerosoft"
tags: ["board", "excalidraw", "migration", "guide"]
---

[Board](/products/board) runs the same open source editor as Excalidraw. That keeps a move from Excalidraw or Excalidraw+ short: the `.excalidraw` format is read as is, and what you drew looks the same on the other side. Miro is a different story, and we cover it at the end with what actually works.

## What the importer reads

One format: `.excalidraw` files, which are the JSON of an Excalidraw scene. The excalidraw.com editor produces them, and so does Excalidraw+, from **Save to…** in the menu. The file picker also takes `.json` files with the same content.

It doesn't read libraries (`.excalidrawlib`). A shape library isn't a scene, so the importer rejects it.

The limits:

- **50,000 elements** per file.
- **4 MB per scene.** The file you upload, images included, can weigh up to 4.5 MB.
- **Up to 50 files** at once from the list.

## What gets imported

- **Every live element in the scene:** shapes, arrows, lines, text, freehand drawing, frames and whatever else is on the canvas. Elements Excalidraw had marked as deleted are dropped.
- **Images pasted on the board**, as long as they're inside the file as PNG, JPEG, GIF or WebP. SVG images are converted to PNG in your browser before upload. All of them go to storage like any other save.
- **The background color** and **grid size**.
- **The name.** Each file becomes a new board named after the file, without the extension.

## What doesn't come across

- **Images by URL.** If the file points to an image on another site instead of embedding it, that image isn't saved.
- **Unsafe links.** An element with a `javascript:` or `data:` link loses the link.
- **AI-generated HTML** from wireframe to code, and the element that displayed it. In Board that preview stays in the session of whoever generated it.
- **The rest of the editor state:** zoom, scroll position, theme and selected tool. Board opens the board with its own defaults.
- **Anything outside the file:** comments, collaborators, history or folders from Excalidraw+. A `.excalidraw` file holds the scene and nothing else.

## Step by step

### Many files at once

1. **Gather your files.** In excalidraw.com or Excalidraw+, open each scene and use **Save to…** to download the `.excalidraw`.
2. **Open the Board list.** If you want them in a folder, open that folder first.
3. **Click Import**, next to New board, and pick all the files together.
4. **Check the result.** With a single file, Board opens the new board. With several, they show up in the list and a toast says how many were imported and how many couldn't be read as `.excalidraw`.

### One file inside a board

On a board you can edit, the canvas menu has **Open**. It loads an `.excalidraw` into that board and, after asking you to confirm, replaces what was there. That's handy for redoing a board you already shared without changing its link.

## What to check afterwards

- **Boards that failed.** If the toast says some couldn't be read, it's usually a library instead of a scene, or a file over 50,000 elements or 4 MB. For heavy ones, remove some images or split the scene in two in Excalidraw before exporting.
- **Images.** Open a board with photos and make sure they're all there. Missing ones were linked by URL, so paste them again.
- **Names.** A file called `Untitled-2024-03-01.excalidraw` becomes a board with that name. Rename it from the list.
- **Cmd+K.** Imported boards can be found by name and by the text inside them.

## If you're coming from Miro

Board doesn't import Miro boards. It doesn't read Miro's format and there's no connection to its API. What you can do:

- **Bring the board in as a reference.** In Miro, from the board menu, **Save as image** downloads a JPG of the area you pick. Paste it on a Board board as an image and draw on top. On Miro's free plan, exports only come in the small size.
- **Move stickies over as text.** Board's sticky tool has **Paste a list**: one line per sticky, up to 100 at a time, and words with `#` become tags. If you have your sticky text in a list, they're on the canvas in a minute.

Then, to sort what you brought over, Board can group stickies by theme with AI, run dot voting and a shared timer. There are examples in [brainstorming with Board](/blog/lluvia-de-ideas-con-board) and [running a retro on a whiteboard](/blog/retro-en-una-pizarra).

## What is still missing

Our parity table compares Board with Excalidraw+. The gaps we list:

- **Paint bucket fill, autoshape and fixed-width pen.** Excalidraw+ added them in 2026 and they aren't in the editor version we run.
- **Voice and screen sharing.** Not available.
- **Roles.** Workspace roles plus edit or view per board, with no other board-level roles.
- **Offline.** Unsaved changes stay as a local draft you can restore. There's no offline mode that syncs later.
- **Large boards.** Up to 4 MB per scene, with a warning when you go over.
- **Wireframe to code.** The generated page stays in the session of whoever made it. It isn't saved or shared.

## What it costs

Miro Starter costs about $10 per user per month on monthly billing. Board on your own server costs $0, with the code under AGPLv3 and every feature included. On zerosoft Cloud there's a free plan to start, then you pay for usage, such as image storage. Seats aren't charged, so bringing the whole team into a workshop doesn't change the bill. The comparison with Excalidraw+ is at [zerosoft vs Excalidraw+](/compare/zerosoft-vs-excalidraw-plus).
