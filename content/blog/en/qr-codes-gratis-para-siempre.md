---
title: "QR codes are free. Forever."
description: "QR is an open standard since 1994: ISO/IEC 18004, patents waived by its inventor. Generating one costs zero compute. Charging for it as a premium feature is an abuse — Link includes it."
date: "2026-06-22"
author: "Zerosoftware"
tags: ["link", "qr", "open source"]
---

The QR code was born in 1994 at Denso Wave, a Toyota subsidiary. Masahiro Hara and his team created it to track car parts on the production line: they needed something that held more data than a barcode and read fast, from any angle.

Then they did something the software industry still hasn't fully processed: they waived their patent rights. The spec was published, the standard opened up, and today it's ISO/IEC 18004. Anyone can generate and read QR codes. No license, no royalties, no asking anyone for permission.

## Generating a QR costs nothing

A QR is not a service. It's arithmetic. Take your bytes, encode them into a grid of black and white modules, add Reed-Solomon error correction, draw the result. On any CPU from the last twenty years, that takes microseconds.

There is no "QR server". There is no per-code cost. Nothing scales with usage. You can generate a million QR codes on a ten-year-old laptop, offline, with an open source library.

## How it works, in 40 seconds

A QR is a matrix of modules: version 1 is 21×21, and each version adds 4 modules per side up to version 40, at 177×177. Three elements do the trick:

- **The corner squares** (finder patterns): tell the reader where the code is and at what angle. That's why you can scan it rotated, tilted or in perspective.
- **Reed-Solomon error correction**: data is stored with redundancy. At the highest level, the code still reads with up to 30% of it damaged or covered. That's why brands can stamp their logo in the middle.
- **The mask**: before being drawn, the grid goes through an XOR with a mask pattern to avoid large single-color blocks that would confuse the reader.

Everything else is data in a zigzag: encoding mode, length, and your content. A URL fits easily in the small versions.

## So why do they charge for it?

Look at any marketing or link SaaS: QR codes sit behind the premium plan. "Custom QR codes from so many dollars a month." They charge a monthly subscription to run a function from an open source library over an open standard with waived patents.

It's like charging you for addition. The outrage is legitimate: they're not selling technology, they're selling access to something that was already yours.

## In Link, it's included

Every short link you create in Link comes with its QR code, in two formats:

- **SVG**: vector, scales infinitely without pixelating. For print, storefronts, packaging.
- **PNG**: ready to drop into a deck, a PDF or a sticker.

No premium plan. No download limit. No watermark. Forever — because it was never ours to charge for.

Link is open source: self-host for $0, or cloud at cost with zero margin. QR codes are the cheapest part of the entire system. Charging for them would be ridiculous. So we don't.
