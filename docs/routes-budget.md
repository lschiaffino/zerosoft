# Presupuesto de rutas de Vercel

Vercel rechaza el deploy si `.vercel/output/config.json` tiene más de 2048
`routes` (`too_many_routes`). Nos pasó con Voice: main tenía 2036 y Voice
llevó el total a 2084.

## Cómo se cuentan

Con Next 15 y `middleware.ts`, `@vercel/next` escribe **3 rutas por cada ruta
dinámica** (página o API con algún `[segmento]`, incluidas todas las páginas
bajo `app/[locale]`):

- la normal: `^/api/crm/objects/(?<nxtPid>[^/]+?)(?:/)?$`
- la `.rsc`: `^/api/crm/objects/(?<nxtPid>[^/]+?)(?:\.rsc)(?:/)?$`
- la de datos: `^/_next/data/<build>/api/crm/objects/(?<nxtPid>[^/]+?)(?:/)?.json$`
  (la agrega porque Next 15 no declara `appType` en `routes-manifest.json` y el
  builder asume que hay Pages Router; con middleware, duplica cada ruta
  dinámica para resolver `/_next/data`).

Más unas 95 fijas (sistema, `redirects`, `headers`, `rewrites` de
`next.config.mjs`: cada regla suma una). Las rutas **estáticas** (sin
corchetes) no suman: se resuelven por sistema de archivos.

```
rutas ≈ 95 + 3 × (rutas dinámicas en app/)
```

Validado: main (5bdf2f3c) tiene 647 dinámicas → 2036; con Voice, 663 → 2084,
el número exacto del error. Con las familias consolidadas, main quedó en 1022
(309 dinámicas) y main + Voice + Rec + Docs D4, con el script aplicado a
`voice`, `rec`, `docs` y `v1`, en 1082 (medido con `vercel build`).

Para medir de verdad: `npx vercel build --prod` (con `.vercel/project.json`
que tenga `settings.framework = "nextjs"`) y
`jq '.routes|length' .vercel/output/config.json`. Para estimar sin buildear:
`jq '.dynamicRoutes|length' .next/routes-manifest.json` después de
`next build`. `tests/unit/routes-dispatch.test.ts` estima desde el árbol de
archivos y falla arriba de 1700.

## Cómo bajar el conteo: catch-all por familia

Las rutas API dinámicas de una familia se mueven tal cual a `lib/routes/` y
un catch-all generado las despacha:

```
app/api/crm/objects/[id]/route.ts  →  lib/routes/crm/objects/[id]/route.ts
app/api/crm/[...zsPath]/route.ts   (generado: tabla de patrones + createDispatcher)
```

`lib/routes/dispatch.ts` respeta la semántica de Next: misma precedencia
(estático > dinámico > catch-all), mismos nombres de `params`, 405 si el
método no existe, HEAD por GET y OPTIONS automático con `Allow`. Una URL que
no coincide con nada devuelve 404 sin cuerpo (antes, la página 404 de Next).

Quedan como archivo propio, y Next las elige antes que el catch-all:

- las rutas estáticas de la familia (no cuestan nada);
- las que tienen config de segmento propia (`maxDuration`, `force-static`,
  `generateStaticParams`, `runtime` distinto, etc.), para no cambiar su
  límite de tiempo ni su cacheo.

### Aplicarlo

```
node scripts/consolidate-routes.mjs --count            # rutas dinámicas sueltas por familia
node scripts/consolidate-routes.mjs app/api/voice --dry
node scripts/consolidate-routes.mjs app/api/voice
```

El script mueve con `git mv`, reescribe los imports a esos módulos en todo el
repo (tests incluidos) y regenera el catch-all. Es idempotente: si la familia
ya tiene catch-all, suma las rutas nuevas. Si una ruta con `maxDuration`
cuelga de un `[segmento]` del primer nivel (chocaría con el catch-all), corta
y pide una base más profunda, por ejemplo `app/api/agents/[id]`.

### Al agregar rutas en una familia ya consolidada

Se puede crear `app/api/crm/algo/[id]/route.ts` como siempre: funciona, pero
cuesta 3 rutas. Antes de mergear, correr el script sobre la familia para
sumarla al catch-all. Lo que no se puede es un `[segmento]` nuevo en el primer
nivel de una familia con catch-all (`app/api/crm/[x]/…`): Next no acepta dos
nombres de slug en el mismo nivel; va en el catch-all.

## Otra palanca (no aplicada)

Si `.next/routes-manifest.json` declarara `"appType": "app"` (Next 16 lo
hace), `@vercel/next` dejaría de escribir las rutas `/_next/data/…` y el
conteo bajaría un tercio. En Next 15 se puede forzar con un paso después de
`next build`, pero depende de un detalle interno del builder: queda como
plan B.
