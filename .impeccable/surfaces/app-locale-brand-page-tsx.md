---
version: 1
slug: "app-locale-brand-page-tsx"
primary_target: "app/[locale]/brand/page.tsx"
related_targets: []
---

# Surface brief: brand world + branding.zerosoft.ai

Scope: the zerosoft visual world (site, app shell, all products) and its first proving surface, the brand guidelines page served at branding.zerosoft.ai (route /[locale]/brand). Mode of the brand page: Persuade/Read hybrid (designers, press, contributors; must make the system intelligible and downloadable).

Audience/job: founders and teams evaluating zerosoft, contributors and press needing assets. Action: understand the system, download the logo/assets kit, copy colors and type.

## Direction contract

THESIS: zerosoft is a transit network. Each app is a line with its own color; integrations are interchange stations; the zeros are the stations. Refuses the category default of a neutral SaaS grid with a single accent and feature cards.

OWN-WORLD: white enamel panels and a near-black #111 signage band; eleven line colors (the existing per-product colors, tuned for AA) drawn as 16px strokes with round caps; stations are white circles with a thick black ring (the zero), interchanges are linked double rings. One condensed transit grotesque (Archivo, wdth 62–100) for signage and headings, Archivo normal width for UI, JetBrains Mono with slashed zero only for data. Square corners everywhere except stations. No pills, gradients, shadows, emojis.

STORY: the visitor sees the suite as one network, understands that each app is a line they can ride alone or combine, and believes the system is coherent enough to replace ten subscriptions; then downloads the kit or enters a product.

FIRST VIEWPORT: black signage band nav (wordmark left, links, one white action right). Left 40%: condensed headline "Una red. Once líneas." at ~88px plus one sentence. Right 60%: the live network diagram, every station clickable, line labels in signage type. Primary action in the band.

FORM: transit wayfinding (Subte signage and network diagrams), position 1 on the ordered list (chosen as the pick card). seed:8ffe4a4506e4e07f

Signature interaction: hovering/focusing a line lights it and dims the rest; in the app the sidebar is that product's line, nav items are stations, the active station is filled with the line color. Motion: a line draws in once (stroke-dashoffset), stations snap; nothing floats.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
