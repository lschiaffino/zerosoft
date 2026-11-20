---
title: "How to send a PDF for signature and what gets recorded"
description: "Step by step: send a contract for signature with Sign, without making the signer create an account, and read the certificate of completion to check that nobody touched the document."
date: "2026-11-20"
author: "zerosoft"
tags: ["sign", "docusign", "e-signature", "guide"]
---

Sending a PDF for signature sounds simple until someone asks how you know the signer is who they say they are, and that the file did not change afterwards. DocuSign's guides, like [the one on how to sign and send a PDF](https://www.docusign.com/blog/how-to-electronically-sign-and-send-pdf), cover the basic path: upload, place the signature, send. Here we walk the same path with [Sign](/products/sign), the zerosoft e-signature app, and stop at the part few people look at: the evidence left at the end.

## What you need first

- A PDF. Sign accepts PDF only, up to 4 MB and 100 pages. If your contract is in Word, export it first. If you wrote it as a Docs page, Sign turns it into the PDF for you.
- The email address of each signer. They do not need a zerosoft account.
- The order: who signs first, and whether someone only approves or only gets a copy.

Sign strips anything that runs or opens something from the file: scripts, open actions, forms and attachments. What gets sent is a clean PDF, and the certificate keeps the hash of the original in case you want to compare.

## Step 1: upload the document and add recipients

Create a new envelope, upload the PDF and add each person with a role: signer, approver or copy. The approver role is for a sign-off without a signature, such as finance before the client signs.

Each recipient has an order number. People sharing a number sign in parallel, and the next number gets its invitation only once everyone before it is done. For a contract between your partner and a client, give your partner 1 and the client 2: the client sees nothing until your side has signed.

## Step 2: place the fields

Drag fields onto the pages and assign each to a recipient. Available: signature, initials, date, name, email, text, checkbox and dropdown, required or optional. Each person fills only their own fields and cannot edit anyone else's.

A practical rule: mark as required the fields the document is worthless without (signature and date) and leave the rest optional. Guided filling takes the signer through one field at a time, which cuts down on documents returned half done.

One thing we do not do yet: place fields automatically from an anchor text. If you send the same contract every month, use a template: it keeps roles and fields, and only the emails change.

## Step 3: set expiry and reminders

Choose how many days until the envelope expires (1 to 365, default 30) and how often a reminder goes to whoever has not signed (0 to 30 days, where 0 means no reminders). A good starting point for a commercial contract: expires in 14 days, reminder every 3. If it expires incomplete, people are told and the link stops working.

You can add a message that travels in the email. Say what the document is and what you expect: "December service contract, sign on the last page" helps more than boilerplate.

## Step 4: send and watch the status

On send, each recipient gets a personal link. That link:

- is single use per person,
- expires with the envelope,
- can be revoked if you sent it to the wrong address,
- and only its hash is stored in the database, not the link itself.

By default the signer also confirms a code emailed to them before opening the document. Codes are stored as hashes too, with attempt limits per recipient and per IP. The check is by email: there is no SMS or ID-document verification yet.

Before signing, the person agrees to sign electronically. Then they type, draw or upload their signature. They can decline with a reason, and that reason reaches you. If you made a mistake on an envelope already sent, it cannot be edited: void it with a reason (recipients get it by email) and copy it into a new draft.

## Step 5: read the certificate of completion

When everyone has signed, Sign draws the fields onto the PDF and appends a certificate of completion. It lists:

- each recipient, with IP and browser,
- each envelope event (created, sent, opened, signed) with time, IP and browser,
- the SHA-256 of the original and of the signed document.

Everyone receives the signed copy. To check it, compute the SHA-256 of the file you hold and compare it with the hash in the completion email and on the envelope page:

```bash
sha256sum signed-contract.pdf
```

If a single byte changed, the result differs. One honest caveat: the certificate also lists an intermediate hash (the signed pages before the certificate was added), which cannot be recomputed from the final PDF. The one you compare is the hash of the final file.

## What legal weight it has

Sign does simple electronic signatures with an audit trail, the kind recognized by the US ESIGN Act and UETA. It does not yet issue eIDAS advanced or qualified signatures, nor the digital signature of Argentine Law 25.506, which requires a licensed certifier. For a services contract between two companies, that is usually enough. For an act the law requires to be signed with a digital or qualified signature, it is not. Check with someone who knows your jurisdiction before deciding.

## What to do after signing

With the envelope complete you can trigger an automation in [Flow](/products/flow): file the PDF, notify the team in Chat or update the deal in the [CRM](/products/crm). Triggers exist for completed and declined envelopes.

And if you run it yourself, the documents live on your infrastructure: private Blob or AES-256-GCM encrypted files, reachable only by the sender, admins and each recipient through their link. It is AGPL, so you can read in the code how the certificate is built.
