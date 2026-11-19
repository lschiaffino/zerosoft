---
name: seo-geo
description: Checklist de SEO y GEO (que buscadores y modelos de IA encuentren y citen a zerosoft) para cualquier página pública del sitio. Usalo al crear o cambiar una página pública (producto, comparativa, alternativa, directorio, herramienta, post, página fija), al tocar sitemap, robots, llms.txt o JSON-LD, o cuando pidan "SEO", "GEO", "que aparezcamos en Google/ChatGPT", "alternativa a X", "datos estructurados", "hreflang".
---

# SEO y GEO en zerosoft

Objetivo: que una persona o una IA que busca software gratis u open source
para no pagar X encuentre a zerosoft, y que la respuesta que cite sea
correcta. Todo sale de datos del repo; nada se escribe a mano dos veces.

Las reglas de copy y diseño de `AGENTS.md` y `docs/voice.md` mandan sobre este
archivo (sin rayas largas, sin "free forever", sin métricas inventadas, sin
funciones que no existen).

## Dónde vive cada cosa

| Qué | Archivo |
| --- | --- |
| Metadata (title, description, canonical, hreflang, OG, Twitter) | `lib/seo.ts` → `pageMetadata()` |
| Páginas fijas (ruta, textos, prioridad del sitemap, tarjeta OG) | `lib/seo-routes.ts` → `STATIC_PAGES`, `lib/seo-pages.ts` |
| JSON-LD | `lib/seo.ts`: `organizationLd`, `websiteLd`, `breadcrumbLd`, `faqLd`, `softwareLd`, `articleLd`, `graphLd`, `jsonLdString` |
| Sitemap | `lib/sitemap-entries.ts` (lo usa `app/sitemap.ts`) |
| robots.txt | `app/robots.ts` |
| llms.txt / llms-full.txt | `lib/llms.ts` |
| Comparativas y alternativas | `lib/compare.ts` + `content/feature-parity/<app>.ts` |
| Directorio de software (abierto y pago por categoría) | `content/software-directory.ts` |
| Búsquedas objetivo | `content/seo-keywords.json` |
| Tarjetas OG | `app/api/og/[...card]/route.tsx`, `lib/og/cards.ts` |
| Chequeos | `tests/unit/seo.test.ts`, `tests/unit/sitemap-llms.test.ts`, `tests/e2e/seo.spec.ts`, `scripts/seo-check.mjs` |

## Checklist por página pública

### Metadata
- [ ] `generateMetadata` llama a `pageMetadata()` (o `staticPageMetadata()` si es página fija). Nunca armar `alternates` a mano.
- [ ] Título único por idioma, la búsqueda primero ("Open-source HubSpot alternative: ..."). Hasta 50 caracteres lleva " · zerosoft"; más largo va `absoluteTitle`.
- [ ] Description de 70 a 160 caracteres con el dato concreto (qué es, que es open source, cuánto cuesta). `clampDescription` recorta, pero escribila para que no haga falta.
- [ ] Canonical a sí misma con locale (`/es/compare/...`), hreflang en/es/pt y `x-default` al inglés. Si la página no existe en un idioma, pasá `locales`.
- [ ] Tarjeta OG propia (`/api/og/...`) o la de página fija.
- [ ] Un solo `<h1>`.

### JSON-LD (un `<script type="application/ld+json">` con `graphLd([...])`)
- [ ] `BreadcrumbList` en toda página que no sea el home.
- [ ] `SoftwareApplication` (`softwareLd`) donde se presenta una app de zerosoft. Ofertas reales: self-host $0 y Cloud con plan gratis. Sin `aggregateRating` ni reseñas: no inventamos.
- [ ] `FAQPage` solo con preguntas que se ven en la página (mismo texto).
- [ ] `ItemList` en índices y listas (comparativas, directorio, apps), con `url` absoluta de cada ítem.
- [ ] `CollectionPage` en índices.
- [ ] Siempre con `jsonLdString` (escapa `<`). Validá: parseá el script y chequeá `@type` de cada nodo del `@graph`.

### Sitemap y robots
- [ ] Página fija nueva: sumala a `STATIC_PAGES`; el sitemap, la tarjeta OG y `seo-check` la toman solas.
- [ ] Rutas dinámicas nuevas: sumalas a `sitemapEntries()` en los tres idiomas, con `lastmod` de una fecha real (revisión, changelog) o sin `lastmod`. Nunca "ahora".
- [ ] `tests/unit/sitemap-llms.test.ts` cubre que estén.
- [ ] robots deja pasar a los crawlers de IA (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) al sitio público; la app, el login y la API quedan afuera.

### llms.txt y llms-full.txt
- [ ] Toda sección pública nueva con su línea en `llmsTxt()` (URL estable en inglés, una oración de qué es).
- [ ] Respuestas listas para citar: "zerosoft <App> is an open-source alternative to <Producto pago>", con la URL.
- [ ] Nada que no esté en la página: el archivo sale de los mismos datos.

### Contenido citable (GEO)
- [ ] La primera oración responde la búsqueda sola: "zerosoft CRM es una alternativa open source a HubSpot: $0 en tu servidor, plan gratis en zerosoft Cloud".
- [ ] Datos en tablas o listas HTML reales (`<table>` con `<th scope>` y `<caption>`), no en imágenes.
- [ ] Lo que falta, dicho: la tabla de paridad lista lo que no tenemos.
- [ ] Fechas visibles de última revisión.
- [ ] Nombres de productos reales y licencias verificables. Precios de terceros solo si son de lista, con "desde" y verificables; si no, sin precio.
- [ ] Apps "Próximamente" marcadas como tales: no se pueden usar todavía.

### Páginas "alternativa a <producto pago>"
- [ ] Slug `/compare/<producto>-alternative` (sale de `content/feature-parity/<app>.ts`) y su par `/compare/zerosoft-vs-<producto>`.
- [ ] Productos pagos sin tabla de paridad: van al directorio (`/software/<categoría>`) con link a la app que los reemplaza; no se crea una página de comparación sin tabla.
- [ ] Cada búsqueda objetivo nueva va a `content/seo-keywords.json` con `target` a una página que exista (el test lo verifica).

### Diseño y accesibilidad
- [ ] Sin scroll horizontal a 390 px, claro y oscuro. Tablas anchas con `.table-wrap` o tarjetas en mobile.
- [ ] Titulares que no se parten feo (`text-wrap: balance`), columnas de texto de 60 a 75 caracteres.
- [ ] Contraste del aspecto Actual (el del sitio público; no se cambia).

## Cómo verificar

1. `npx vitest run tests/unit/seo.test.ts tests/unit/sitemap-llms.test.ts`.
2. Con un servidor de producción corriendo (en la Mac del dueño, envuelto en
   `~/.zerosoft-watcher/heavy.sh` y con `E2E_PORT`): `node scripts/seo-check.mjs http://localhost:<puerto> --limit 200`.
3. `CI=1 npx playwright test tests/e2e/seo.spec.ts` (sumá la página nueva a `PATHS`).
4. Mirá las capturas a 1280 y 390, claro y oscuro.
5. JSON-LD a mano: en la consola, `JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@graph'].map(n => n['@type'])`.

## Lo que no hacemos desde el repo

Enviar el sitio a Search Console, Bing Webmaster, directorios externos,
Product Hunt o foros publica a nombre del dueño: se deja listo y se avisa en el
reporte. Las variables `GOOGLE_SITE_VERIFICATION` y `BING_SITE_VERIFICATION`
(ver `siteVerification` en `lib/seo.ts`) las carga el dueño en Vercel.
