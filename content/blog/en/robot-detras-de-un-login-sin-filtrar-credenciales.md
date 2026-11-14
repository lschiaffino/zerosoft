---
title: "A robot behind a login, without leaving your password in the open"
description: "How to make a robot sign in to a site with username, password and 2FA, keep the session between runs and avoid exposing private data. Steps and real limits of zerosoft Robots."
date: "2026-11-14"
author: "zerosoft"
tags: ["robots", "security", "browse-ai"]
---

Browse AI's help center explains [how to scrape and monitor data behind a login](https://help.browse.ai/en/articles/10518514-how-to-scrape-and-monitor-data-behind-a-login). It recommends session cookies for ordinary logins without 2FA and suggests refreshing them from time to time, monthly as a reference. It is a good starting point, because most of what is worth automating (a supplier panel, an invoice portal, an internal listing) sits behind a password.

This post solves the same problem with Robots, the zerosoft browser automation app, and focuses on what matters most when a robot handles credentials: where the secret is stored, which site it may be typed into, and who sees what the robot brings back.

## Before you start

Use a robot with a login only on accounts that are yours or that you are authorized to automate. Read the site's terms: many prohibit automated access even with a valid account. If an official API or export exists, it is a better route than a browser.

## Step 1: store the credential once

Credentials live in the workspace, not inside the robot. Create one of type "basic" with three fields:

- **Username.**
- **Password.** Stored encrypted.
- **TOTP secret.** Optional, for sites with two-step verification. It is the text the site shows when you set up the authenticator app (something like `JBSW Y3DP EHPK 3PXP`). Robots validates it on save.

One name, for example `SUPPLIER_PORTAL`, serves every robot that signs in to that site. If you change the password, you change it in one place.

## Step 2: write the login into the steps

In the Steps tab, the login is built from ordinary steps. The "Log in and extract" template already has the structure and works as a mold:

1. **Go to URL** with the login page.
2. **If exists** on the username field. If it is not there, the robot skips the login. This handles the saved-session case, covered in step 4.
3. **Fill** the username field with `{{credentials.SUPPLIER_PORTAL.username}}`.
4. **Fill** the password field with `{{credentials.SUPPLIER_PORTAL.password}}`.
5. **Click** the sign-in button and **Wait** for an element that only shows when you are logged in.
6. **Extract list** with what you came for.

If the site asks for 2FA, add another Fill step with `{{credentials.SUPPLIER_PORTAL.totp}}`. Robots computes the current code (RFC 6238) on every attempt, so a retry 30 seconds later does not use an expired code.

## Step 3: the rules Robots enforces

These restrictions exist so a credential never ends up somewhere it can be read. The editor checks them on save:

- **Only in the value of a Fill step.** If you put `{{credentials...}}` in a selector, a URL, a text or a script, Robots rejects the robot and tells you which step.
- **Login site.** Each Fill step with a credential has a "Login site" field. The secret is typed only if the page is on that site (a domain and its `www.` count as the same). If the field ends up elsewhere, through a redirect or an iframe, the step fails without typing anything. Leaving the field empty uses the site of the last Go to URL step with a fixed address, but it is better to fill it in by hand.
- **No reading back what was typed.** A robot with a credential cannot have a script step or extract the `value` attribute, because some sites copy what you typed there. Fallback selectors are also disabled in login steps, so the robot never types the password into a similar but wrong element.

This is stricter than an ordinary browser on purpose. The day someone edits a robot and pastes a phishing URL into a step, the secret stays put.

## Step 4: keep the session and skip the login on each run

In the robot's settings, turn on "Save session between runs". Robots keeps cookies and localStorage, encrypted, and the next run starts already inside. Thanks to the "If exists" step from step 2, the robot sees there is no form and jumps straight to extracting.

Three practical details:

- If the saved session is larger than 1,000,000 characters, it is not saved and the next run logs in again.
- "Clear session" removes it when something looks off: a password change, a locked account, a site that left you halfway.
- Turning the option off also deletes what was stored.

A saved session is convenient, but it is also a key. Treat it like one: one robot per account, and the account with the minimum permissions it needs to read.

## Step 5: decide who sees the data

A robot with a login brings back private data, and Robots assumes so. Runs made with a login are tagged with who captured them, and only that person and admins see the rows. In the workspace, members can create robots and run the ones that use no login, saved session or credential. The ones that do stay with admins and owners.

When you connect the robot to a destination (the CRM, a flow, a sheet), Robots shows a notice: the rows may include private data, so send them only where that is allowed. Take it seriously. A customer list from a portal should not end up in an open chat channel.

## Step 6: keep it from breaking quietly

Logins fail more often than public pages: they expire, ask for a new captcha, change the form. Two settings help:

- **Automatic pause.** By default the schedule pauses after 3 failures in a row (you can raise it up to 20). It matters more with a login: a robot that keeps trying an old password can lock the account.
- **Failure capture.** In the Runs tab you see the screenshot, the URL and a DOM fragment of the step that failed, without the credential.

## What Robots does not do yet

- It does not solve captchas or SMS and hardware-key verification. If the login demands them, the robot does not move on.
- The TOTP code works with standard authenticator apps. 2FA delivered by email has no step of its own.
- The saved session is one per robot, not shared between robots.
- The Chrome extension for recording steps installs by hand with developer mode and does not update itself.

## What changes compared with someone else's cloud

When a third-party robot signs in to your portal, your password and session cookies live on their servers. With zerosoft on your own server, the encrypted credential, the session and the rows stay in your database, and the browser is your Chromium. On zerosoft Cloud the code is the same and you pay for usage at cost times three. For teams that automate access to customer systems, knowing where each secret lives is worth more than any run limit.
