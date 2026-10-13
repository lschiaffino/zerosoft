---
title: "Why sign-in is Google only"
description: "Passwords are the weakest part of most logins, so we delegated sign-in to Google. The reasons, and the trade-offs."
date: "2026-06-13"
author: "zerosoft"
tags: ["security", "oauth", "login"]
---

When you open Link, there's exactly one button: **Continue with Google**. There's no sign-up form and no password to reset. We made that choice for security, and it's worth explaining.

## Passwords are the weakest link

The data has told the same story for years:

- More than half of people reuse the same password across services (Google/Harris survey, 2019: 52%). One in eight reuses it everywhere.
- HaveIBeenPwned tracks over 12 billion accounts leaked in breaches.
- The Verizon DBIR repeats it every edition: most compromises start with stolen, weak or phished credentials.

The problem is structural. Every service that asks you to create a password is asking for two things: that you pick a good one, and that they store it properly. One of the two always fails. And when it fails, the attacker doesn't just try that password here. They try it on your email, your bank and your job.

Meanwhile, behind the Google button there are thousands of security engineers, anomalous-login detection, 2FA, passkeys and anti-phishing models that, by Google's own published numbers, block 99.9% of automated attacks. No startup can match that. Neither can we. So we don't compete: we delegate.

## What it means for you

- **Nothing to remember.** No password, no second "just for this app" password, no 90-day rotations.
- **Nothing to hack.** If someone steals our database tomorrow, there are no hashes to crack. The password column doesn't exist. You can't leak what you don't store.
- **Your session inherits your Google account's security**, which is probably already the best-protected account you have (2FA, new-device alerts, passkeys).

## The trade-offs, honestly

It would be dishonest to sell this as pure upside. It isn't:

- **You need a Google account.** If you don't have one, or don't want one, you can't use zerosoft's cloud today. The self-host option, on the other hand, asks for no login.
- **We depend on Google's availability.** If their auth goes down, login goes down. Your links and the API keep working (redirects don't depend on login), but the dashboard does.
- **Google learns that you sign in here.** We only request email and name; they see neither your activity nor your data. But that metadata exists, and if it bothers you, self-hosting is the answer.

## Will we add more providers?

Yes, when they add coverage without breaking the key property: no shared secret stored on our servers. GitHub and Microsoft qualify. Passkeys qualify even better (they're the obvious future of login), and are probably what's next.

Email + password? No. That form is not coming back. The safest way to store passwords is not storing them.
