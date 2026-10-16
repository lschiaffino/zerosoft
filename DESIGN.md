---
name: zerosoft
description: Red de subte. Each app is a line, integrations are interchange stations, the zeros are the stations.
colors:
  enamel-white: "#ffffff"
  enamel-panel: "#f4f4f2"
  signage-ink: "#111111"
  gray-1: "#3d3d3d"
  gray-2: "#5c5c5c"
  gray-3: "#767676"
  rule: "#d9d9d6"
  on-ink: "#ffffff"
  on-ink-2: "#b8b8b8"
  line-link: "#2f6bff"
  line-crm: "#7b4dff"
  line-cal: "#0e9f6e"
  line-track: "#f2611d"
  line-chat: "#e23d7f"
  line-docs: "#c2700a"
  line-flow: "#0284c7"
  line-agents: "#ff3b30"
  line-notes: "#e6b400"
  line-board: "#00b8a9"
  line-robots: "#6b7280"
  ink-link: "#2c66f8"
  ink-crm: "#7b4dff"
  ink-cal: "#008358"
  ink-track: "#c84800"
  ink-chat: "#cf3172"
  ink-docs: "#ab6000"
  ink-flow: "#0078b7"
  ink-agents: "#dd2720"
  ink-notes: "#916c00"
  ink-board: "#008176"
  ink-robots: "#6b7280"
typography:
  display:
    fontFamily: "Archivo, Arial Narrow, Arial, sans-serif"
    fontSize: "clamp(3.25rem, 6.1vw, 5.5rem)"
    fontWeight: 800
    lineHeight: 0.92
    letterSpacing: "-0.01em"
    fontVariation: "\"wdth\" 75"
  headline:
    fontFamily: "Archivo, Arial Narrow, Arial, sans-serif"
    fontSize: "clamp(2rem, 3.4vw, 3rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.005em"
    fontVariation: "\"wdth\" 75"
  title:
    fontFamily: "Archivo, Arial Narrow, Arial, sans-serif"
    fontSize: "2rem"
    fontWeight: 800
    lineHeight: 1.05
    fontVariation: "\"wdth\" 75"
  sign:
    fontFamily: "Archivo, Arial Narrow, Arial, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 800
    lineHeight: 1
    fontVariation: "\"wdth\" 75"
  lead:
    fontFamily: "Archivo, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.45
  body:
    fontFamily: "Archivo, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Archivo, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.2
  data:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.7
    fontFeature: "\"zero\" 1, \"tnum\" 1"
rounded:
  square: "0px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "16px"
  s-4: "24px"
  s-5: "32px"
  s-6: "48px"
  s-7: "64px"
  s-8: "96px"
  s-9: "128px"
components:
  button-primary:
    backgroundColor: "{colors.signage-ink}"
    textColor: "{colors.enamel-white}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "10px 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.enamel-white}"
    textColor: "{colors.signage-ink}"
  button-on-band:
    backgroundColor: "{colors.enamel-white}"
    textColor: "{colors.signage-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "10px 20px"
    height: "44px"
  button-on-band-hover:
    backgroundColor: "{colors.signage-ink}"
    textColor: "{colors.enamel-white}"
  button-outline-on-band:
    backgroundColor: "transparent"
    textColor: "{colors.on-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "10px 20px"
    height: "44px"
  signage-band:
    backgroundColor: "{colors.signage-ink}"
    textColor: "{colors.on-ink}"
    height: "74px"
    padding: "0 56px"
  section-sign:
    backgroundColor: "{colors.signage-ink}"
    textColor: "{colors.on-ink}"
    typography: "{typography.headline}"
    height: "104px"
  enamel-plate:
    backgroundColor: "{colors.enamel-panel}"
    rounded: "{rounded.square}"
    height: "240px"
---

# Design System: zerosoft

## Overview

**Creative North Star: "Red de subte"**

zerosoft is drawn as a transit network. Each of the eleven apps is a line with its own color; integrations are interchange stations where two lines meet; the brand's zeros are the stations themselves, white circles with a thick black ring. The world borrows from Buenos Aires Subte signage and network diagrams: white enamel panels, a near-black signage band, condensed heavy lettering, colored strokes with round caps. It replaced the earlier black, white and oval-zeros look.

The system is flat and literal. Depth comes from the contrast between the enamel field and the black band, never from shadows. Color is wayfinding: a line color tells you which app you are on, and nothing else in the interface competes with it. Type is one family, Archivo, used at two widths: condensed (wdth 75, weight 800) for signage and headings, normal width for reading and UI. JetBrains Mono appears only where the content is data.

**Scope of application.** The full world is built on the brand guidelines page (`/[locale]/brand`, branding.zerosoft.ai). The rest of the marketing site and the apps carry only the minimal application: the new wordmark and station symbol (header, footer, app topbar, OG images, kit), Archivo and JetBrains Mono as the global `--sans`/`--mono`, the signage display face on the landing hero headline (`.lp-h1`), square Archivo hero CTAs, and the home particle field redrawn as station rings. Their full redesign is a later round. The app-sidebar pattern in the direction (the sidebar as the product's line, nav items as stations, the active station filled with the line color) is **not built yet**; do not treat it as an existing component.

**Key Characteristics:**
- White enamel field, #111 signage band for chrome and section headers.
- Eleven line colors, drawn as 16px round-capped strokes; each paired with a darkened text ink.
- The station (white circle, ring 0.44 of the outer radius) is the logo's "o", the symbol, and every map node.
- One condensed heavy grotesque for signage; normal-width Archivo for UI; mono with slashed zero for data only.
- Square corners everywhere except stations. No shadows, gradients, pills or emoji.

## Colors

A neutral enamel-and-ink base carrying eleven saturated line colors that work as wayfinding, not decoration.

### Primary
- **Signage Ink** (signage-ink): the signage band, section header bands, the press footer, primary buttons, station rings, all body text. The site-wide `--ink` was moved to the same value.
- **Enamel White** (enamel-white): the page field and station fill.

### Secondary: the eleven lines
- **Line colors** (line-link through line-robots): identical to `PRODUCT_CONFIG[key].color` and `--c-<key>`. Used for 16px map strokes, product station rings (`LineGlyph`), color swatches and fills. Never for text.
- **Line inks** (ink-link through ink-robots): the same hue darkened in OKLCH to at least 4.75:1 on white. The only form of a line color allowed as text (links, labels, the copy confirmation, the red strike on "no" specimens). Canonical OKLCH values live in `lib/brand.ts` and the sidecar.
- **Text on a line fill** (`--c-<key>-on`): white on Link, CRM and Robots; signage ink on the other eight.

### Neutral
- **Enamel Panel** (enamel-panel): plates behind logo, station and misuse specimens; the only tinted surface.
- **Gray 1** (gray-1): secondary copy, captions, station names on the map.
- **Gray 2** (gray-2): meta, table heads, struck-through "no" examples.
- **Gray 3** (gray-3): the lightest gray allowed for text (4.54:1); also dimension lines.
- **Rule** (rule): 1px table and list dividers, swatch borders.
- **On Ink / On Ink 2** (on-ink, on-ink-2): primary and secondary text on the black band.

### Named Rules
**The Ink-For-Text Rule.** A line color is never set as text. Text in a product's color uses its `-ink` variant; text on a line fill uses its `-on` value.

**The Labeled Line Rule.** A line color never carries meaning alone: every line on the map has its name in signage type at a terminus, and every swatch sits beside the product name. Notes (#e6b400) and Board (#00b8a9) strokes fall below 3:1 on white, so the label is what makes them legible.

**The Logo Is Ink Rule.** The wordmark and the brand symbol are signage ink or white only. A line-colored ring belongs to a product symbol, never to the zerosoft mark.

## Typography

**Display Font:** Archivo variable, condensed (wdth 75, weight 800), fallback Arial Narrow
**Body Font:** Archivo variable, normal width, fallback -apple-system, Helvetica Neue, Arial
**Label/Mono Font:** JetBrains Mono with slashed zero and tabular figures, fallback ui-monospace

**Character:** A heavy condensed transit grotesque that reads like station signage, paired with the same family at normal width so the interface feels like one voice. Mono is a tool for values, not a style.

Archivo is loaded with the `wdth` axis (62 to 125); the build uses 75 for all signage. `--wdth-tight` (62) is defined but not yet used.

### Hierarchy
- **Display** (800, wdth 75, clamp 52 to 88px, 0.92): the first-viewport headline. The landing hero `.lp-h1` uses the same treatment at clamp 48 to 96px.
- **Headline** (800, wdth 75, clamp 32 to 48px, 1.0): section titles, set white inside the black section-sign band. Raised to the h1 step (clamp 40 to 64px) for the press close.
- **Title** (800, wdth 75, 32px, 1.05): subsections, 72px above and 16px below.
- **Sign** (800, wdth 75, 26px, 1.0): line names on the network map and signage labels.
- **Lead** (400, 20px, 1.45): section intros, max 60ch.
- **Body** (400, 17px, 1.55): reading copy, max 65ch, gray-1 when secondary.
- **Label** (600, 15px): buttons, band navigation, station names, small headings above specimens.
- **Data** (JetBrains Mono, 13px): HEX values, file names, sizes, measurements.

### Named Rules
**The Mono Is Data Rule.** JetBrains Mono, with `"zero" 1`, is only for values a reader might copy or compare: HEX, OKLCH, file names, sizes, pixel measures. Labels, buttons and navigation are Archivo.

**The Two Widths Rule.** Signage and headings are condensed 800; everything a user reads or operates is normal width. Never set running text condensed, never set a heading at normal width.

**The Lowercase Name Rule.** The wordmark is always "zerosoft" in lowercase, outlined from the brand's own drawing with the station as its "o"; never retyped in another font or as a typographic zero.

## Layout

Full-bleed bands on a white field. Content sits in a 1200px wrap with 56px side padding (16px under 900px). Sections end with 112px of space (72px on small screens) and open with a full-width black section-sign band, 104px tall (80px small), holding a white-ringed station and the headline.

The first viewport is a 2:3 split: condensed headline, one sentence and the kit download on the left; the live network diagram on the right, filling the viewport height below the 74px band. A 4px ink rule closes the hero. Under 900px everything stacks to one column, the band drops its links and keeps the logo and one action, the hero map enlarges its line labels to 40px and hides station names, and a wider copy of the map scrolls horizontally with its caption pinned. Multi-column tables become stacked two-column rows.

Spacing lives on a multiple-of-8 scale with a 4px half step (spacing tokens). Wide gaps between columns are 56px; grid gaps 24 to 32px.

## Elevation & Depth

Flat by construction. There are no box shadows anywhere in the world. Depth comes from tonal layering of only three planes: the white field, the enamel panel for specimens, and the black signage band for chrome and section headers. Sticky band at the top uses z-index only.

### Named Rules
**The No-Shadow Rule.** Nothing casts a shadow, glows or blurs. If a surface needs to separate, it changes plane (white, enamel, ink) or takes a 1px rule. The only shadow on the brand page is inside the logo-misuse specimen that shows what not to do.

## Shapes

Square. Every container, plate, button, band, swatch and focus outline has a 0 radius. The circle is reserved for stations: a white disc with a ring 0.44 of its outer radius (`STATION_RING`), the same ratio as the wordmark's "o". Interchanges are two stations 1.6 radii apart joined by a bar the thickness of the ring. Lines are 16px strokes with round caps and round joins, routed in horizontals, verticals and 45-degree diagonals. Rules come in three weights: 16px line, 8px ring, 4px rule; dividers are 1px.

### Named Rules
**The Circle Is A Station Rule.** A circle in this world always means a station. Do not use round avatars, dots, pills or rounded cards to decorate; any circle will be read as a stop on a line.

## Components

### Buttons
Signage-plate buttons: solid, square, inverted on hover.
- **Shape:** square (0), 2px border in the fill color, minimum height 44px (40px under 900px).
- **Primary:** signage ink fill, white Archivo 600 15px, 10px 20px padding.
- **Hover / Focus:** fill and text swap (ink to white) over 0.2s on the expo-out curve; focus is a 3px ink outline offset 3px, white on the black band.
- **On-band / Outline:** on the black band the main action is a white plate ("Descargar kit"); a transparent white-bordered variant exists for secondary actions on ink.

### Signage Band (navigation)
The site chrome on the brand page: a sticky 74px #111 band, wordmark left, Archivo 600 15px links with a 2px underline that appears on hover, one white action pushed to the right. Under 900px the links are hidden and the band is 64px.

### Section Sign
Every section opens with a full-width black band containing a white-ringed station and the section title in Headline. It replaces eyebrows and kickers: the station marks where you are.

### Network Map (signature)
The SVG diagram of the suite (`NetworkMap`, data in `lib/brand-network.ts`, real integrations only). Lines draw in once with stroke-dashoffset (1.4s, expo-out, staggered 80ms per line); stations snap visible at the end with no easing; reduced motion skips both. Hovering or focusing a line or station dims everything else to 14% opacity and the caption below shows a color bar and what the station connects. Every station is keyboard-focusable with a 3px ring; lines carry a 44px invisible hit stroke and stations an invisible touch zone of at least 24px. Station names are Archivo 600 15px in gray-1 with a white halo.

### Station and Line Glyph
`Station` renders the zero (single or interchange) at any size; `LineGlyph` is a product's station with the ring in its line color, optionally sitting on a short stretch of line. Used as list markers in tables and as product symbols.

### Enamel Plates
Square enamel panels (240px tall for logo plates, 200px for stations, 160px for misuse) present specimens, with 13px gray captions below. An ink plate variant shows the reversed logo.

### Tables
Full-width, rules only: 1px rule dividers, 16px cell padding, 13px gray-2 heads, no fills or zebra striping. HEX values are copy buttons: mono data with an underline on hover and a copied confirmation in the Cal ink.

## Do's and Don'ts

### Do:
- **Do** draw every app as a 16px round-capped stroke in its line color, and every node as a station with a 0.44 ring.
- **Do** use the `-ink` variant for any text in a product's color and the `-on` value for text on a line fill.
- **Do** open sections with the black section-sign band and a station, not a small label above the title.
- **Do** set headings in Archivo wdth 75 weight 800 and everything operable in normal-width Archivo.
- **Do** keep JetBrains Mono for values only, with the slashed zero on.
- **Do** separate surfaces by plane (white, enamel #f4f4f2, ink #111) or a 1px rule.
- **Do** animate lines once by drawing them and let stations snap; respect reduced motion.

### Don't:
- **Don't** round corners on anything but stations.
- **Don't** add shadows, glows, gradients or outlines to surfaces or to the logo.
- **Don't** use pills, tags, emoji or decorative circles.
- **Don't** set a raw line color as text, or let a line color stand without its name.
- **Don't** color the zerosoft wordmark or symbol with a line color, stretch it, capitalize it, rebuild it in another font, or replace the station with a typographic zero.
- **Don't** set buttons, navigation or labels in mono or uppercase with tracking.
- **Don't** make lines float, pulse or loop; motion is one draw-in.
