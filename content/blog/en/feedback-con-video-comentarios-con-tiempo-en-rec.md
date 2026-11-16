---
title: "Giving feedback on video: a 3-minute review with Rec"
description: "How to review a design or a pull request in a short video with a structure people understand without a meeting, and how to run it in Rec with time-stamped comments, restricted access and a Track issue."
date: "2026-11-16"
author: "zerosoft"
tags: ["rec", "feedback", "async"]
---

A text comment on a design says "the spacing feels off". The person who gets it asks "where?", and the thread that was meant to save a meeting turns into a long back and forth. A three-minute video where you point at the screen fixes that, as long as the video has a structure.

Loom has [a best-practices guide for giving feedback on video](https://www.loom.com/blog/best-practices-for-providing-feedback-via-loom). This post starts from the same problem and offers a method you can copy today, with the parts of Rec that support it and what it still lacks.

## When to use video and when to use text

Use video when the feedback is visual or sequential: a design, a flow of screens, a large pull request, a landing page with several problems. Use text for a one-line fix. A practical rule: if you would say "look here" more than twice, record.

One limit: if the other person is going to disagree strongly, video does not replace a call. It helps you reach the call with the points already shown.

## The structure of a 3-minute review

A fixed structure tells the viewer what is coming and lets them skip around.

1. **Verdict in the first 15 seconds.** "Almost ready, two required changes and three suggestions." Someone in a hurry can stop there.
2. **Required changes first.** Each one with what you see, why it matters and what you would change. One sentence per part.
3. **Suggestions after.** Say out loud that they are optional. It stops someone from spending an hour on something you meant as an aside.
4. **Close with the next step.** Who does what and by when. Without a concrete ask, the video is just an opinion.

A script template, in your own words:

```
Verdict: [ready / almost ready / needs a redo]
Required 1: [where] [what I see] [what I would change]
Required 2: ...
Suggestions: [where] [idea]
Next step: [person] [action] [date]
```

Record one take. If you slip, start again instead of editing: a review with a pause or a "sorry, I meant" is still clearer than a text thread.

## Recording it in Rec

Rec records from the browser: screen, camera or both, with the camera bubble drawn into the video. You can pick the full screen, a window or a tab. There is a 3 second countdown at the start, pause, restart the take and mute the mic.

Two details that help in a review:

- **Record the tab, not the whole screen**, if the material is in the browser. Someone else's notification will not sneak in.
- **One take per topic.** If you review a design and a document, make two videos. It is easier to link each one where it belongs.

The video uploads in parts while you record and the link is copied as soon as you stop. If the network drops, recording continues and retries by itself.

What Rec does not have yet: drawing on screen or highlighting the mouse while you record. To point at something, move the cursor slowly and say where you are. There is no Chrome extension either; there is a desktop app for Mac and Windows.

## Closing the loop: time-stamped comments

What makes video useful as feedback is that the reply points to the exact second. In Rec, comments are marked on the timeline: one click jumps to that second, and when playback passes the mark the comment shows over the video. There are also six emoji reactions anchored to a second.

Ask the reviewer to reply there and not in chat. Two reasons: each reply stays attached to the moment it discusses, and you get one grouped notice ("3 new comments") instead of three loose messages. Replies are text; you cannot answer with another video yet.

## Who can watch it

Feedback on an unreleased design or on internal code should not be open to the world.

- New videos start **restricted**: only the person who recorded and the people invited. You can switch to workspace members or anyone with the link.
- You can **invite by email** as viewer or commenter. Someone outside gets a single-use link.
- You can set a **password** and an **expiry**, and block downloads. Note the last one: the video is still streamed, so a determined person can capture it. Blocking downloads stops casual forwarding.

## From review to task

A review that does not end in assigned work gets forgotten. From the video, with one click, Rec creates a Track issue or a Docs page with the link, the AI summary, the chapters and the transcript. The text is copied as is, without being rewritten.

The transcript, summary and chapters need a transcription provider to be configured and the workspace AI quota. If you run it yourself, you choose the provider (the `REC_TRANSCRIBE_PROVIDER` variable). Without that, the video works the same but without text.

The full flow: record the review, share it restricted to the right people, they comment on the exact second, and you turn the required changes into Track issues. If what you want off your calendar is the review meeting, [meeting notes that end in tasks](/blog/notas-de-reunion-que-terminan-en-tareas) follows the same logic.

## Why it matters where the video lives

A review video often shows things you do not want on someone else's service: unreleased product screens, customer data in a dashboard, code. With self-hosted Rec the files stay in your installation's storage and you pay only for that storage. On zerosoft Cloud you pay by usage and seats cost nothing.

Rec is a new product and far from having everything Loom has: no AI removal of filler words, no mobile app, no meeting recording. The full, current list is on the Rec comparison page.

## Summary

- Video for visual or sequential feedback, text for one-line changes.
- Verdict first, then required changes, suggestions, next step.
- One take per topic, three minutes at most.
- Time-stamped comments for replies, restricted access by default.
- Required changes become Track issues before you close the tab.
