---
title: "Moving from Bitly to Link: what the import brings and what it leaves"
description: "Import Bitly links into Link by API token or CSV: what comes across, what doesn't, how back-halves are kept, and the right order for custom domains."
date: "2026-08-20"
author: "zerosoft"
tags: ["link", "bitly", "migration"]
---

Switching link shorteners has a special kind of fear attached: somewhere out there are printed flyers, old tweets and PDFs with your short links in them. Break those and you don't get a second chance.

So we built the Bitly import in Link around one goal: keep the back-halves. `go.yourcompany.com/spring-sale` should still be `go.yourcompany.com/spring-sale` after the move. Here's how the import works, exactly what it brings, what it doesn't, and the order of operations that avoids broken links.

## Two ways in: API token or CSV

Both live in Link settings, under **Import from Bitly**.

**API token.** In Bitly, go to Settings → API and generate an access token. Paste it in Link and hit **Import**. Link uses the token once to read your links through Bitly's API and doesn't store it. You can (and should) revoke it in Bitly afterwards.

**CSV file.** Export your links from Bitly (Links → Export) and upload the file. The parser is forgiving: it looks for a column whose header mentions `long`, `destination`, `original`, `target` or is just `url` for the destination; a `bitlink`, `short`, `link` or `custom` column for the short URL; plus `title` and `tags` if they exist. Tags can be separated by `|`, `;` or `,`. That also means a CSV from almost any other shortener works, as long as it has a destination column. The file limit is 5 MB.

## What gets imported

For every link:

- **The destination URL.** Including any UTM parameters that were already in it.
- **The title.**
- **Tags**, up to five per link (that's Link's limit; extras are dropped).
- **The back-half**, when possible. More on that below.

Through the API, the import reads all bitlinks in your account's **default group**, both active and archived. If a link has a custom back-half on your own domain, that's the version that gets imported, since it's the one people actually have.

## What does not get imported

Be clear-eyed about this before you start:

- **Click history.** Your Link analytics start at zero on import day. If you need historical numbers, export them from Bitly and keep that file. We don't fake past data.
- **Custom domains.** The domain itself has to be added and verified in Link separately (see below).
- **Archived status.** Archived bitlinks come in as active links. Archive them again in Link if they should stay dead.
- **Other groups.** The API route only reads the default group. If you use several Bitly groups, export each one to CSV.
- **QR code designs, campaigns, and anything specific to Bitly's apps.** Link generates its own plain QR (SVG and PNG) for every link, pointing at the same short URL.

## How back-halves are kept

This is the part that matters. For each link, the import looks at the short URL's host and path:

1. **If the host is a custom domain you've already verified in Link**, the link is created on that domain with the same back-half. `go.yourcompany.com/spring-sale` stays exactly that.
2. **Otherwise** (including everything on `bit.ly`), the link is created on the default domain with the same back-half, if it's free and valid.
3. **If the back-half is taken or invalid** (say it's a reserved word like `blog` on the default domain, or longer than 32 characters), Link generates a new random one.

At the end you get a report: how many links were imported, how many kept their back-half, the full list of the ones that got renamed (old → new) and the ones skipped with the reason, usually an invalid destination URL.

One unavoidable truth: **links on `bit.ly` itself will keep depending on Bitly.** The import recreates them as `zerosoft.ai/abc123`, but nobody can move `bit.ly`'s DNS. Whatever you printed with `bit.ly` keeps working as long as Bitly serves it. This is the strongest argument for using your own domain, whatever shortener you pick.

## The right order for custom domains

Here's the trap: the import keeps back-halves on a custom domain only if that domain is already verified in Link, and verification checks that the DNS points at Link. Which means your Bitly links on that domain stop resolving at Bitly the moment you switch.

So do it in this order:

1. **Export the CSV from Bitly** (or keep your API token handy). Do it before touching DNS.
2. **A day before, lower the TTL** of the record for `go.yourcompany.com` at your DNS provider, so the change propagates fast.
3. **Add the domain in Link** and note the record it asks for ([DNS details here](/blog/dominios-propios-dns-paso-a-paso)).
4. **Switch the DNS record** and click **Verify** until it turns green.
5. **Run the import immediately.** Links land on your domain with their back-halves.
6. **Spot-check** a few old URLs, including your most clicked ones.

The gap between step 4 and 5 is minutes. During it, visitors get a clean "This link is gone" page instead of an error, and then everything works again.

## Big accounts: the 2,000 limit

Each import run processes up to 2,000 links. If your source has more, the report says so. Don't just run the same API import again: it starts from the top, the first 2,000 back-halves are already taken by then, and you'd get duplicates with new random slugs. For large accounts, use the CSV route and split the file into chunks of up to 2,000 rows, importing them one at a time. Imports are also rate limited (a handful per IP every few minutes), so pace yourself.

## Two more things to check

- **Webhooks fire on import.** Every imported link is a newly created link, so if you've set up a `link.created` webhook, it fires once per link. Thousands of events at once might surprise whatever is listening. Pause the webhook during the import if that matters.
- **The team sees everything.** Imports land in your active workspace, so everyone in it sees the links. Import into the right workspace.

## After the move

Once you're in, the usual Link toolkit applies to your old links: edit destinations without changing the short URL, add passwords, expiration dates or click limits, download QR codes, and watch cookie-free analytics. If you want the full picture of how Link and Bitly compare beyond the import, we wrote [an honest comparison](/blog/zerosoft-link-vs-bitly), including the cases where you should stay put.

And if it turns out Link isn't for you, the [export](/blog/exportar-tus-datos-deberia-ser-un-derecho) is one click away too: every link as CSV, or JSON with every click. Moving in should never be easier than moving out.
