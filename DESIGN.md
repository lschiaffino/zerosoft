---
name: zerosoft
description: White, black and zeros. The zero is the mark; color belongs to the eleven apps. Optional brand themes (today "Red de subte") restyle the same structure.
colors:
  white: "#ffffff"
  panel: "#f5f5f5"
  side: "#fafafa"
  ink: "#0d0d0d"
  gray-1: "#4a4a4a"
  gray-2: "#5e5e5e"
  gray-3: "#6e6e6e"
  rule: "#e8e8e8"
  on-ink: "#ffffff"
  on-ink-2: "#b3b3b3"
  app-link: "#2f6bff"
  app-crm: "#7b4dff"
  app-cal: "#0e9f6e"
  app-track: "#f2611d"
  app-chat: "#e23d7f"
  app-docs: "#c2700a"
  app-flow: "#0284c7"
  app-agents: "#ff3b30"
  app-notes: "#e6b400"
  app-board: "#00b8a9"
  app-robots: "#6b7280"
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
    fontFamily: "Space Grotesk, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(2.75rem, 5.2vw, 4.75rem)"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Space Grotesk, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(1.75rem, 2.9vw, 2.625rem)"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Space Grotesk, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 500
    lineHeight: 1.05
  lead:
    fontFamily: "Space Grotesk, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.45
  body:
    fontFamily: "Space Grotesk, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Space Grotesk, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.2
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.7
    fontFeature: "\"zero\" 1, \"tnum\" 1"
rounded:
  square: "0px"
  control: "3px"
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
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 20px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
  button-chrome:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "32px"
  site-header:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    height: "64px"
  app-band:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    height: "48px"
  section-sign:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.headline}"
    height: "104px"
---

# Design System: zerosoft

## Overview

**Creative North Star: "Hecho de ceros"**

zerosoft is white, black and zeros. The mark is a zero (an oval ring, `ZeroMark`, path in `lib/zero-mark.ts`) next to "zerosoft.ai" in lowercase mono. The site's first viewport is a big zero made of small zeros (`ZeroField`). Everything else is quiet: a white field, ink type, 1px rules, square-ish 3px corners. Color belongs to the eleven apps: each one has its color and it only says where you are (the app's zero, the active item, a chart), never decorates.

Type is Space Grotesk for reading, interface and headings (weight 500 for titles, tight tracking) and IBM Plex Mono for data, code and the wordmark. The system is flat: no shadows, gradients or pills.

**Brand themes.** This is the **default** theme. The same structure (shell, UI kit, pages) can be restyled by an optional brand theme, chosen per browser with a cookie. Today there is one: **Red de subte** (see Themes). A third theme based on zeros/ASCII is planned; the layer is built so it only adds files.

**Key Characteristics:**
- White field, ink text, 1px rules. Ink only as a band where it means "the end" (closing band, footer, code).
- Eleven app colors, used as accents; each paired with a darkened text ink.
- The zero is the logo, the favicon, the app icon and every app's mark (the zero in the app's color).
- Space Grotesk for everything a person reads or operates; IBM Plex Mono for values and the wordmark.
- 3px corners on controls; no shadows, gradients, pills or emoji.

## Themes

Themes change the brand layer only: tokens, typefaces, logo and a few signature drawings. Structure, routes, copy and UX (tabs, `AdvancedSection`, `SettingsTabs`, `FormSection`, `EmptyState`, `PageHeader`, `DataTable`) are shared.

- **Registry:** `lib/brand-theme.ts` (`BRAND_THEMES`, cookie `zs_brand`, routes that force a theme). Server: `getBrandTheme()` in `lib/brand-theme-server.ts`. Client: `BrandProvider` / `useBrand()` in `components/brand/BrandProvider.tsx`.
- **Switching:** any URL with `?brand=subte` stores the cookie and redirects to the same URL without the parameter; `?brand=default` clears it (`middleware.ts`). The root locale layout reads it and sets `<html data-brand="…">`.
- **Forced routes:** `/[locale]/brand` (and branding.zerosoft.ai) is always default; `/[locale]/nuevo-branding/subte` is always subte. The middleware passes the forced theme in the internal `x-zs-brand` header.
- **Tokens:** `styles/brand.css` holds what every theme shares (spacing, body scale, app `-ink`/`-on` colors). Each theme defines the same token names in `styles/themes/<theme>.css`: default in `:root`, the others under `html[data-brand="<theme>"]`. Token families: neutrals (`--brand-*`), type (`--font-signage`, `--font-ui`, `--font-data`, `--signage-stretch|weight|tracking|leading`, `--t-display|h1|h2|h3`), shape (`--radius-1`, `--stroke-rule`), interface (`--ui-hover`, `--ui-press`, `--ui-field`), chrome (`--chrome-bg|fg|fg-2|fg-3|line|hover|border|active-bg|active-fg|focus`), sidebar (`--side-bg`) and section signs (`--sign-bg|fg|fg-2|border`). Product CSS never hardcodes a theme value: titles use `font-family: var(--font-signage)` with the `--signage-*` tokens, heavy rules use `var(--stroke-rule)`, chrome uses `--chrome-*`.
- **Brand components:** `Logo` (wordmark or symbol), `ProductGlyph` (an app's mark), `BrandSymbol` (bullet/milestone), `AccentGlyph` (empty states, public headers) and `HeroVisual` (first viewport) dispatch on the theme. Default renders live in `components/brand/default` and `components/zero`; subte in `components/brand/subte`, `Station`, `NetworkMap`.
- **Adding a theme:** add the key to `BRAND_THEMES`, create `styles/themes/<theme>.css` and import it in `app/layout.tsx`, add its case to the dispatching components, load its fonts (without preload) in `app/[locale]/layout.tsx`, and (optionally) a guide at `/[locale]/nuevo-branding/<theme>` forced in `lib/brand-theme.ts`.

### Optional theme: Red de subte

Each app is a subway line, integrations are interchange stations, the zeros are the stations (white circles with a ring 0.44 of the radius). Neutrals `#ffffff` / enamel `#f4f4f2` / signage ink `#111111` (grays `#3d3d3d`, `#5c5c5c`, `#767676`; rule `#d9d9d6`). Archivo condensed (wdth 75, weight 800) for signage and titles, Archivo normal width for UI, JetBrains Mono for data. 2px corners, 4px ink rules. Chrome is a black signage band; section signs are full-width black bands with a station; the app sidebar is the product's line (a 6px stroke in `--accent`) with each item as a station; `/app` and the site's first viewport show the live `NetworkMap`. Logo: the outlined "zerosoft" wordmark with the station as its "o" (`lib/brand-mark.ts`). Full guide, kit and assets: `/[locale]/nuevo-branding/subte` (`public/brand/`).

## Colors

A white-and-ink base carrying eleven saturated app colors that work as wayfinding, not decoration.

### Primary
- **Ink** (ink): text, primary buttons, rules under page headers, the closing band and footer.
- **White** (white): the page field.

### Secondary: the eleven apps
- **App colors** (app-link through app-robots): identical to `PRODUCT_CONFIG[key].color` and `--c-<key>`. Used for the app's zero (`ProductGlyph`, `.product-zero`), the active item in the sidebar, tab bars, charts and swatches. Never for text.
- **App inks** (ink-link through ink-robots): the same hue darkened to at least 4.75:1 on white; the only form allowed as text.
- **Text on an app fill** (`--c-<key>-on`): white on Link, CRM and Robots; ink on the other eight.

### Neutral
- **Gray 1** (gray-1, 8.9:1): secondary copy, descriptions.
- **Gray 2** (gray-2, 6.5:1): meta, table heads, section names in the sidebar.
- **Gray 3** (gray-3, 5.1:1): the lightest gray allowed for text. Never lighter (no #9a9a9a for text).
- **Panel** (panel) and **Side** (side): the only tinted surfaces (plates, the app sidebar).
- **Rule** (rule): 1px dividers and borders.
- **On Ink / On Ink 2**: text on the ink bands (footer, closing band, code).

### Named Rules
**The Ink-For-Text Rule.** An app color is never set as text. Text in an app's color uses its `-ink` variant; text on an app fill uses its `-on` value.

**The Labeled Color Rule.** An app color never carries meaning alone: the zero sits next to the app's name.

**The Logo Is Ink Rule.** The zerosoft zero and wordmark are ink or white only. A colored zero is an app's mark, never zerosoft's.

## Typography

**Display/Body Font:** Space Grotesk (titles at 500 with -0.02em tracking; UI and reading at 400 to 600)
**Mono Font:** IBM Plex Mono (data, code, the wordmark, small uppercase captions)

### Hierarchy
- **Display** (500, clamp 44 to 76px, 1.05): the first-viewport headline.
- **Headline** (500, clamp 28 to 42px): section titles (`SectionSign`), the second clause in gray-2.
- **Title** (500, 28px): subsections and page titles (`PageHeader` uses 32px).
- **Lead** (400, 20px, 1.45): section intros, max 60ch.
- **Body** (400, 17px, 1.55): reading copy, max 65ch.
- **Label** (600, 15px): buttons, navigation, small headings.
- **Data** (IBM Plex Mono, 13px, slashed zero, tabular): values a reader might copy or compare.

### Named Rules
**The Mono Is Data Rule.** Mono is for values, code and the wordmark. Buttons and navigation are Space Grotesk, sentence case.

**The Lowercase Name Rule.** The name is always "zerosoft.ai" (or "zerosoft") in lowercase, next to the zero.

## Layout

Full-bleed sections on a white field. Content sits in a 1280px container with 32px gutters (16px under 860px). Sections open with a section sign (a 1px ink rule on top, the zero and the headline) and end with generous space. The first viewport is a split: headline, one sentence and two actions on the left; the zero made of zeros on the right (on a product page, tinted with its color). The closing band and the footer are ink.

Spacing lives on a multiple-of-8 scale with a 4px half step.

## Elevation & Depth

Flat. No box shadows. Surfaces separate by plane (white, panel, ink) or by a 1px rule. Sticky chrome uses z-index only.

## Shapes

Controls and plates have 3px corners (`--radius-1`). Avatars and plates are square. The zero is an oval ring. Rules are 1px; the heavy rule (`--stroke-rule`) is 1px of ink in default (4px in subte).

## Components

### Buttons
`.btn` in `styles/ui.css`, one component for site and app. Sentence case, 1px border, `--radius-1` corners.
- **Variants:** `.btn-primary` (alias `.btn-solid`): ink plate, one per view. `.btn-secondary` (plain `.btn`, alias `.btn-outline`): white with a 3.3:1 field border. `.btn-ghost`: text only, hover fill. `.btn-danger`: red text; `.btn-primary.btn-danger` is the red plate. `.btn-chrome` / `.btn-chrome-outline` sit on the theme's chrome (site header, board header): ink on white in default, white on the black band in subte. `.btn-invert` / `.btn-invert-solid` sit on ink bands (closing band).
- **Sizes:** default 40px on the site, 36px inside `.app-frame`; `.btn-sm` 32px / 28px; `.btn-lg` 48px.
- **States:** hover inverts the primary plate; press scales to 0.98; focus is a 2px ink outline offset 2px (`--chrome-focus` on chrome); disabled is 40% opacity; loading is `aria-busy="true"`.
- **Copy:** a verb and an object ("Crear link", "Guardar cambios").

### Logo and marks
- **`Logo`** `{ tone?: 'current' | 'ink' | 'white', height?, variant?: 'wordmark' | 'symbol', title? }`: in default, `ZeroMark` + "zerosoft.ai" in mono (`.brand-logo-default`); the symbol is the zero alone. `tone="current"` (chrome) inherits the text color.
- **`ProductGlyph`** `{ product, size?, onLine? }`: an app's mark. Default: the zero in the app color (`.product-zero card-<key>`). `onLine` only applies to subte.
- **`BrandSymbol`**: the zero as bullet or milestone (changelog nodes, product steps, section signs).
- **`AccentGlyph`** `{ color, height? }`: the zero in a given color, used by `EmptyState` and the help-center header.
- **Favicon / app icon / OG:** `app/icon.svg` and `app/apple-icon.tsx` are the white zero on an ink square; product, changelog and tool OG images (`lib/product-og.ts`) are a zero made of zeros on ink; blog covers (`lib/blog-cover.ts`) are zeros only.

### App shell
`app/[locale]/app/layout.tsx` + `components/app/AppSidebar.tsx` + `styles/app.css`.
- **Band** (`.app-band`, 48px, sticky, `--chrome-*`): white with a 1px rule in default. The zero links to `/app`, then the product switcher (the app's zero and its name), the current section after a slash (`AppTopbar`), search with `⌘K` and notifications. Under 1024px a menu button opens the drawer.
- **Sidebar** (`.side`, 240px, `--side-bg`): "+ Nuevo", then the product's items with their icons; the active item has `aria-current="page"`, a white row, a 2px bar in `--accent` on its left edge and its icon in `--accent-ink`. Section names in 12px gray-2. Footer: Ajustes, Docs, back to the site, the user.
- **Switcher:** a menu (`role="menu"`, arrow keys, Home/End, Esc returns focus) listing the eleven apps with their zeros; the current one carries `aria-current`.
- **Collapsed** (≥1024px, `.sidebar-collapsed`, 56px, remembered in localStorage `zs-side-collapsed`): only the icons, labels kept for screen readers.
- **Mobile drawer** (<1024px): slides from the left under the band, 48% ink backdrop, Esc closes and returns focus.
- **Color:** AppSidebar injects `--accent`, `--accent-ink` and `--accent-on` on `.app-frame`. The app color is wayfinding only (active item, active tab bar, charts); actions stay ink.
- **Heights:** `--band-h` (48px) is the only chrome above content.

### App home (`/app`)
Default: the eleven apps as a grid of plates (`.app-home-apps`), each with its zero in the app color, name and one line; Link's numbers follow, since `/app` is also Link's overview. Subte: the `NetworkMap` as launcher next to the list of lines.

### UI kit (`styles/ui.css`)
Loaded site-wide after `globals.css`. Product screens use these classes instead of their own versions.
- **Fields:** `.input`, `.select`, `.textarea` (40px site, 36px app; 1px `--ui-field` border at 3.3:1; focus thickens the border to 2px ink; `aria-invalid="true"` turns it red). `.label` (13px 600, sentence case), `.ui-field` wraps label + control + `.ui-help` / `.ui-error`; `.ui-fields`, `.ui-fields-2`; `.ui-input-group` + `.ui-addon`.
- **Checkbox and switch:** `.ui-check` (16px square, ink when checked, indeterminate) and `.ui-switch` (32×18 rail, ink when on).
- **Badges:** `.badge` is a 22px plate, 12px 600; `.badge-ok`, `-warn`, `-bad`, `-info`, `-ink`, `-outline`. Never a pill, never uppercase. `.kbd` for shortcuts.
- **Dense tables:** `.table` (inside `.table-wrap`): 32px header with a 1px ink rule, 36px rows, tabular numerals. `.num`, `.data`, `.table-compact`, `.table-sticky`, `.cell-link`.
- **Tabs:** `.ui-tabs` with `.ui-tab` (`aria-current="page"` links or `role="tab"` buttons). The active tab carries a bar in the app color under ink text.
- **Modal and drawer:** native `<dialog class="ui-modal">` / `<dialog class="ui-drawer">` with `showModal()`. 1px ink border, 48% ink backdrop, no shadow.
- **Toasts:** `.ui-toasts` / `.ui-toast` (ink plate, `data-tone="error"` in red).
- **Empty and loading:** `.ui-empty` (see EmptyState). `.ui-skeleton` plates; skeletons, not spinners.
- **Page:** `.ui-page`, `.ui-page-header` (title 32px, `--stroke-rule` ink rule below), `.ui-section`, `.ui-disclosure` (Avanzado), `.ui-settings`.
- **Tokens in `globals.css`:** `--ui-backdrop`, `--ui-dur` (160ms), semantic `--ok`/`--warn`/`--bad` each with `-ink` (text, AA) and `-soft`. Old names (`--dim`, `--line`, `--ink-2`, `--subtle`, `--r-*`) are aliases of the theme tokens.

### React components (`components/ui/`)
- **`PageHeader`** `{ title, description?, actions?, back? }`: the top of every app page. One `.btn-primary` in `actions`.
- **`EmptyState`** `{ title, body?, action?, secondary?, product?, quiet?, compact? }`: the brand glyph in the app color, what goes here, one primary action and a shortcut or import in `secondary`.
- **`FormSection`** `{ title, description?, onSubmit?, submitLabel?, note?, footer?, tone? }`: a settings block with its own Guardar.
- **`AdvancedSection`** `{ storageKey, label?, hint?, defaultOpen? }`: the "Avanzado" disclosure, remembered per `storageKey`.
- **`SettingsTabs`** `{ items, mode: 'route' | 'query', param?, layout: 'side' | 'top' }`: settings navigation.
- **`DataTable`** `{ columns, rows, rowKey, rowHref?, caption?, empty?, compact?, sticky? }`: a dense `.table`.

### Site (`components/site`, `styles/site.css`, `styles/pages.css`)
- **Header** (`.site-header`, 64px, sticky, `--chrome-*`): white with a 1px rule; the logo, links with an underline on hover and on the current section, locale plates and one `.btn-chrome` action. The products menu lists the eleven apps with their zeros.
- **First viewport** (`.lp-hero`, `.pd-hero`): headline left, `HeroVisual` right (the zero made of zeros; tinted on a product page).
- **Section sign** (`SectionSign`): a 1px ink rule, the zero (the app's zero on a product page) and the headline; the second clause in gray-2.
- **Pricing** (`CloudPricing`), **the math** (`.stack`), **steps**, **closing band** (`.lp-end`, ink, with the eleven apps as `EndLines`) and **reading pages** (`.read-hero`, `.prose`) keep their structure; they read their colors and rules from the theme tokens.
- **Changelog** (`ChangelogList`): one milestone per release (`BrandSymbol`), product filters as `.ui-tabs`, each change marked with its `ProductMark`.
- **Feedback board** (`BoardChrome`, `styles/board-public.css`): the chrome tokens (white header in default), the logo (the zero alone under 520px).
- **Brand page** (`/[locale]/brand`, branding.zerosoft.ai, `styles/brand-default.css`): the default logo on white and on ink, the icon, neutrals and the eleven app colors (copyable HEX), the two typefaces and a pointer to the optional theme.

### Product screens
Product-specific notes (shared by every theme):
- **Link:** detail is one header plus five tabs (`?tab=`); numbers sit in a ruled strip; create has one entry with route tabs; custom domains at `/app/links/domains`.
- **CRM records:** `PageHeader`, tags, `RecordTabs` (`?tab=activity|properties|related`), `RecordMoreMenu`; create forms use `FormSection` + `AdvancedSection`; every list route has `loading.tsx` and `error.tsx`. Settings are `SettingsTabs` in query mode.
- **Cal:** one event-type editor with `.ui-tabs` and a single sticky save; quick create in QuickModal; bookings grouped by day; public pages (`.bk`) carry the workspace's brand, not zerosoft's.
- **Docs:** page tree next to the shell sidebar; editor with a sticky 48px bar; floating menus with a 1px ink border; help center (`/h/<handle>`) in the workspace's color.
- **Global settings:** `SettingsTabs` (Cuenta, Workspace, Admin), each block a `FormSection`, details in `AdvancedSection`.
- **Product diagrams** (Link route, CRM step line and deal stages, Docs tree, Flow nodes, Cal routing stepper) are still drawn as a line with stations in every theme; moving them to theme tokens is pending.

## Do's and Don'ts

### Do:
- **Do** use the zero as the only brand shape, and the app's zero in its color as its mark.
- **Do** use the `-ink` variant for text in an app's color and the `-on` value on an app fill.
- **Do** read every brand value from the theme tokens (`--brand-*`, `--font-*`, `--signage-*`, `--chrome-*`, `--stroke-rule`).
- **Do** keep text at gray-3 (#6e6e6e) or darker.
- **Do** separate surfaces by plane or a 1px rule.

### Don't:
- **Don't** hardcode a theme's look (condensed 800 titles, 4px rules, black chrome, stations) outside its theme file or component.
- **Don't** add shadows, glows or gradients.
- **Don't** use pills, emoji or decorative circles.
- **Don't** set a raw app color as text, or let it stand without its name.
- **Don't** color the zerosoft zero with an app color, stretch it, or retype the name in another font.
- **Don't** set buttons or navigation in mono or uppercase.
