# SEO y GEO del sitio público

Cómo está armado el SEO de zerosoft.ai y qué tiene que hacer quien administra
el dominio. La rutina diaria del blog está en `docs/blog-routine.md`.

## Piezas

| Qué | Dónde |
|---|---|
| Metadata de cada página (title, description, canonical, hreflang con x-default, Open Graph, Twitter) | `lib/seo.ts` → `pageMetadata` |
| Páginas fijas (ruta, claves de título y descripción, prioridad, fecha de revisión) | `lib/seo-routes.ts` → `STATIC_PAGES`; la metadata, en `lib/seo-pages.ts` |
| JSON-LD: Organization, WebSite, SoftwareApplication con ofertas, FAQPage, BreadcrumbList, BlogPosting, ItemList | `lib/seo.ts` |
| sitemap.xml (tres idiomas, hreflang, lastmod real) | `app/sitemap.ts` + `lib/sitemap-entries.ts` |
| robots.txt | `app/robots.ts` |
| Imágenes OG en PNG, en el idioma de la página | `app/api/og/[...card]/route.tsx` + `lib/og-card.tsx` (fuentes en `lib/og-fonts`) |
| Comparaciones (`/compare`, `/compare/zerosoft-vs-<x>`, `/compare/<x>-alternative`) | `lib/compare.ts`, `app/[locale]/compare` |
| llms.txt y llms-full.txt (llmstxt.org) | `lib/llms.ts`, `app/llms.txt`, `app/llms-full.txt` |
| Blog: tags, autor, RSS y Atom, relacionados | `lib/blog.ts`, `lib/blog-feed.ts`, `app/[locale]/blog` |
| Búsquedas objetivo | `content/seo-keywords.json` |
| Chequeos | `tests/unit/seo.test.ts`, `tests/unit/sitemap-llms.test.ts`, `tests/e2e/seo.spec.ts`, `scripts/seo-check.mjs`, `scripts/blog-gaps.mjs` |

Reglas que el código ya hace cumplir:

- Cada URL pública tiene canonical a sí misma (`/<locale>/<ruta>`) y hreflang en, es, pt y x-default (inglés).
  Un post que no existe en un idioma no lista ese idioma; si se sirve con la caída al inglés, su canonical apunta al original.
- `lastmod` es una fecha real: revisión de paridad, fecha del changelog, `date`/`updated` del post, fecha de los legales.
  Sin una fecha real no se pone.
- Un tag con un solo post es `noindex,follow` y no va al sitemap (`TAG_MIN_POSTS`).
- Los links internos de los posts se escriben sin idioma (`/products/crm`) y se reescriben al del post: sin redirect de por medio.
- Las comparaciones salen de `content/feature-parity`: el competidor es el de la tabla, y el precio de lista solo se muestra si
  `pages.json → products.<app>.compare.rival` es el mismo competidor.
- `NEXT_PUBLIC_SITE_URL` define el dominio de canonicals, sitemap y OG. Sin la variable, `https://zerosoft.ai`.

Para sumar una página pública: agregala a `STATIC_PAGES` (o al sitemap si es dinámica), usá `staticPageMetadata` o
`pageMetadata`, y sumala a `PATHS` en `tests/e2e/seo.spec.ts`.

## Verificación en Search Console y Bing (lo hace quien administra el dominio)

Opción recomendada, una vez y para todos los subdominios: **propiedad de dominio por DNS**.

1. Search Console (https://search.google.com/search-console) → Agregar propiedad → **Dominio** → `zerosoft.ai`.
   Google muestra un registro `TXT` con la forma `google-site-verification=<código>`.
2. En el DNS de `zerosoft.ai`, crear ese `TXT` en el nombre raíz (`@`). Esperar a que propague y tocar Verificar.
3. En Search Console → Sitemaps, enviar `https://zerosoft.ai/sitemap.xml`.
4. Bing Webmaster Tools (https://www.bing.com/webmasters) → **Importar desde Google Search Console**: trae la
   propiedad verificada y el sitemap, sin otro registro. Si preferís verificar aparte, Bing da un `CNAME`
   (`<código>.zerosoft.ai` → `verify.bing.com`) o el meta tag de abajo.

Opción por meta tag (si no hay acceso al DNS), ya implementada:

| Variable de entorno (Vercel → Settings → Environment Variables, Production) | Valor | Meta que imprime |
|---|---|---|
| `GOOGLE_SITE_VERIFICATION` | el `content` del meta que da Search Console (propiedad de **prefijo de URL** `https://zerosoft.ai/`) | `<meta name="google-site-verification">` |
| `BING_SITE_VERIFICATION` | el `content` del meta `msvalidate.01` | `<meta name="msvalidate.01">` |
| `YANDEX_SITE_VERIFICATION` | opcional | `<meta name="yandex-verification">` |

Después de cargar la variable hay que volver a desplegar (los meta salen en el HTML del build). Se imprimen en todas
las páginas del sitio (`app/[locale]/layout.tsx` → `siteVerification()`).

Comprobar: `curl -s https://zerosoft.ai/en | grep -o '<meta name="google-site-verification"[^>]*>'`.

## Antes del lanzamiento (dueño)

- Confirmar `NEXT_PUBLIC_SITE_URL=https://zerosoft.ai` en Production (sin barra final).
- Verificar el dominio y enviar el sitemap (arriba).
- En Search Console → Inspección de URL, pedir indexación de `/en`, `/es`, `/pt`, `/en/compare` y `/en/blog`.
- Correr `node scripts/seo-check.mjs https://zerosoft.ai` contra producción y revisar los errores.
- Validar una página de cada tipo en https://search.google.com/test/rich-results y https://validator.schema.org.
