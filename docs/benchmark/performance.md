# Benchmark de performance: todas las apps

Fecha: 2026-10-22. Build de producción (`npx next build`, Next.js 15.5.27) del
commit `644c85b`, servido con `next start` en local con SQLite en archivo.

## Cómo se midió

- **Servidor:** `next start -p 3267` con `DEMO_MODE=true`, base SQLite nueva
  (`TURSO_DATABASE_URL=file:...`) y `RATE_LIMIT_DISABLED=true` para sembrar.
- **Datos sembrados por la API de la app**, además de la siembra demo: 200
  contactos CRM, 100 links (más 6.000 clicks en 30 días cargados directo en
  `clicks`), 50 issues, 30 páginas de Docs con 60 bloques cada una, 30 notas,
  10 pizarras, 8 flows, 8 agentes, 8 robots y 40 conversaciones de Chat. La
  bio `/@demo-1` quedó publicada con 12 links.
- **Navegador:** Playwright con Chromium headless a 1280x800, CPU throttling 4x
  (`Emulation.setCPUThrottlingRate`), red "4G" (9 Mbps de bajada, 1,5 Mbps de
  subida, 60 ms de latencia vía `Network.emulateNetworkConditions`) y caché
  desactivada. Cada página arranca en un contexto nuevo: es una **primera
  visita en frío**, sin cookie `tz`. Una pasada de calentamiento no se cuenta.
  Después vienen 3 corridas y se reporta la **mediana**.
- **Métricas:** TTFB (`responseStart` de navigation timing), FCP y LCP
  (PerformanceObserver), CLS (layout-shift sin input reciente), JS transferido
  (bytes codificados de recursos `Script`), bytes totales y cantidad de
  requests (CDP).
- **INP-proxy:** la duración más larga de Event Timing (con `interactionId`)
  de la interacción principal, con la CPU todavía a 4x y la red sin
  throttling. "Acción → resultado" mide desde el click o la tecla hasta el
  frame en que se ve el resultado (URL nueva o elemento visible). Las
  interacciones fueron:
  - abrir el primer registro desde cada lista;
  - Cmd+K en las páginas de detalle;
  - tipear 4 letras en los editores de Docs y Chat;
  - la tecla `r` (rectángulo) en Excalidraw;
  - click en un nodo de xyflow.
- **API:** cada endpoint de lista recibió 15 requests secuenciales en caliente,
  sin red emulada. Se reportan la mediana y el p90.
- **Ruido:** la máquina (8 núcleos, 8 GB) estuvo compartida con otros agentes
  que compilaban en paralelo. Las corridas se hicieron solo con load average
  por debajo de 3. Las páginas de Board editor a Robots se volvieron a correr
  cuando una compilación ajena levantó la carga.

**Límites.** TTFB es el tiempo del servidor local. En producción se suman el
RTT al edge de Vercel y, sobre todo, un RTT a Turso por cada query secuencial
(ver fix 2). Los números de API son de SQLite local, así que miden el costo
del query y no la red.

## Resultados por página (mediana de 3, primera visita, 4x CPU, 4G)

Marcas: `(!)` = "necesita mejorar" según Core Web Vitals; `(x)` = "malo".

| App | Página | TTFB ms | FCP ms | LCP ms | CLS | INP-proxy ms | Acción → resultado ms | JS KB | Total KB | Requests |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| CRM | Contactos | 27 | 844 | 1028 | 0.001 | 128 | 374 | 212 | 724 | 82 |
| CRM | Contacto | 22 | 872 | 872 | 0.000 | 136 | 138 | 212 | 718 | 65 |
| Link | Links | 21 | 864 | 1168 | 0.000 | 168 | 313 | 192 | 694 | 63 |
| Link | Link + analytics | 26 | 840 | 1088 | 0.000 | 24 | 127 | 207 | 543 | 53 |
| Track | Issues | 30 | 904 | 904 | 0.001 | 88 | 473 | 212 | 729 | 75 |
| Track | Issue | 30 | 1036 | 1036 | 0.003 | 16 | 162 | 227 | 723 | 61 |
| Docs | Docs home | 27 | 668 | 1080 | 0.048 | 160 | 330 | 198 | 714 | 71 |
| Docs | Editor (60 bloques) | 42 | 912 | 1852 | 0.215 (!) | 120 | 388 | 259 | 783 | 76 |
| Notes | Notas (lista + editor) | 24 | 976 | 976 | 0.133 (!) | 160 | 409 | 244 | 731 | 49 |
| Board | Pizarras | 35 | 1024 | 1024 | 0.000 | 96 | 791 | 195 | 697 | 65 |
| Board | Editor Excalidraw | 104 | 812 | 812 | 0.000 | 320 (!) | 318 | 587 | 1012 | 81 |
| Flow | Flows | 20 | 932 | 932 | 0.000 | 120 | 371 | 206 | 699 | 56 |
| Flow | Editor xyflow | 25 | 908 | 908 | 0.000 | 136 | 166 | 280 | 770 | 53 |
| Cal | Tipos de evento | 63 | 884 | 956 | 0.000 | 136 | 409* | 191 | 682 | 54 |
| Cal | Editor tipo de evento | 23 | 884 | 884 | 0.000 | 48 | 162 | 204 | 698 | 56 |
| Chat | Inbox | 21 | 912 | 912 | 0.000 | 144 | 450 | 192 | 727 | 62 |
| Chat | Conversación | 27 | 860 | 860 | 0.000 | 112 | 343 | 220 | 761 | 70 |
| Agents | Agentes | 19 | 884 | 1068 | 0.000 | 16 | 364 | 201 | 691 | 53 |
| Agents | Editor de agente | 21 | 844 | 1052 | 0.000 | 128 | 132 | 216 | 705 | 49 |
| Robots | Robots | 17 | 876 | 1224 | 0.000 | 128 | 340 | 205 | 693 | 56 |
| Robots | Editor de robot | 22 | 976 | 1208 | 0.000 | 24 | 161 | 220 | 708 | 52 |
| Público | Home `/es` | 41 | 780 | 780 | 0.034 | - | - | 155 | 529 | 35 |
| Público | Reserva `/es/book/demo-1/30min` | 25 | 532 | 532 | 0.000 | - | - | 167 | 413 | 28 |
| Público | Bio `/@demo-1` | 18 | 576 | 576 | 0.000 | - | - | 155 | 388 | 22 |
| Público | Centro de ayuda `/es/h/demo-1` | 29 | 508 | 508 | 0.000 | - | - | 157 | 400 | 23 |
| Público | Feedback board `/es/feedback-board` | 26 | 528 | 528 | 0.000 | - | - | 158 | 411 | 25 |

\* Cal, tipos de evento: en la segunda pasada el click en la tarjeta navegó
en 1 de 3 corridas (en las otras dos el selector cayó en un link que no
navega). En la primera pasada, con más carga, dio 832 ms en 3 de 3.

**Link corto** (`/82p4b8u`, 302 con registro del click): mediana de 4,3 ms y
p90 de 7 ms en el servidor local. El registro del click es un batch
sincrónico antes del redirect (`lib/track.ts:145`). En producción eso suma un
RTT a Turso a cada redirect.

**Visita recurrente** (con cookie `tz` ya puesta), medida en dos páginas:

| Página | Total KB primera visita | Total KB recurrente | FCP / LCP |
|---|---:|---:|---|
| CRM Contactos | 724 | 561 | sin cambio (880 ms) |
| Track Issues | 729 | 569 | sin cambio (976 ms) |

Los 160 KB de diferencia salen de `components/app/TimezoneCookie.tsx:46`. En
la primera visita escribe la cookie y llama a `router.refresh()`, que vuelve a
pedir todo el árbol RSC (unos 159 KB, la mayor parte mensajes i18n) y lo
re-renderiza. Pasa una vez por navegador, en la primera página de la app.

### Latencia de API (servidor local, en caliente, 15 requests)

| App | Endpoint | KB respuesta | Mediana ms | p90 ms |
|---|---|---:|---:|---:|
| CRM | `/api/crm/contacts` | 13.5 | 4.1 | 5.2 |
| CRM | `/api/crm/contacts?q=garc` | 10.7 | 3.8 | 4.8 |
| Link | `/api/links` | 6.4 | 2.6 | 3.7 |
| Link | `/api/links/analytics` | 3.9 | **23.0** | 24.7 |
| Track | `/api/track/issues` | 17.6 | 3.4 | 4.1 |
| Docs | `/api/docs/pages` | **375.2** | 5.1 | 6.8 |
| Notes | `/api/notes` | 7.3 | 2.7 | 3.2 |
| Board | `/api/boards` | 2.3 | 1.8 | 3.5 |
| Flow | `/api/flow/flows` | 3.8 | 2.2 | 3.4 |
| Cal | `/api/calendar/event-types` | 0.6 | 2.1 | 3.4 |
| Cal | `/api/calendar/bookings` | 0.0 | 3.4 | 6.4 |
| Chat | `/api/chat/conversations` | 29.8 | 3.4 | 4.6 |
| Agents | `/api/agents` | 6.0 | 2.5 | 4.9 |
| Robots | `/api/robots` | 3.8 | 2.8 | 4.4 |
| Shell | `/api/search?q=perf` (Cmd+K) | 2.8 | 5.0 | 6.3 |
| Shell | `/api/notifications?limit=5` (polling cada 30 s) | 2.3 | 2.5 | 4.0 |

Con SQLite local todos los endpoints responden en menos de 25 ms. Hay dos
excepciones:

- `/api/links/analytics` es 5 veces más lento que el resto con apenas 6.000
  clicks, porque agrega todos los clicks en cada request.
- `/api/docs/pages` devuelve 375 KB para 31 páginas, porque trae el `content`
  de cada una.

## Tamaño de bundle (salida de `next build`)

- **Ninguna ruta supera 300 kB de First Load JS.** La más pesada es
  `/[locale]/app/flow/[id]` con 225 kB (75,7 kB propios, sobre todo xyflow).
  Le siguen:
  - `/app/docs/[id]`: 200 kB
  - `/app/notes`: 189 kB, que trae el editor de Docs y `marked`
  - `/app/track/projects/[id]`: 162 kB
  - `/app/robots/[id]`: 161 kB
  - `/app/crm/settings` y `/tools/[slug]`: 158 kB
  - `/app/agents/[id]` y `/app/track/issues/[id]`: 157 kB
  - El resto de las listas está entre 125 y 151 kB.
- **Compartido por todas:** 106 kB:
  - `chunks/0937d497…js`: 54,2 kB (react-dom)
  - `chunks/70089…js`: 46,7 kB (runtime de Next y router)
  - otros: 5 kB
- **Middleware:** 47,6 kB.
- **Lo que `next build` no muestra:**
  - **Chunks lazy de Excalidraw.** El editor de Board figura con 154 kB, pero
    al abrirse baja 587 KB de JS comprimido: `ad7441be` (144 KB gz),
    `999c4005` (141 KB gz) y `79272` (57 KB gz). El chunk más grande del
    build, `8bb1228e` (1,7 MB, 722 KB gz, WASM de subsetting de fuentes de
    Excalidraw), no se carga al abrir: queda para exportar.
  - **CSS.** Cada página de la app trae 15 hojas de estilo (96 KB gz) con el
    CSS de las 11 apps y de xyflow, porque `app/[locale]/app/layout.tsx:12-27`
    las importa todas.
  - **El HTML.** Cada documento pesa 160 a 200 KB gz (530 a 730 KB sin
    comprimir), y unos 158 KB gz son el JSON de mensajes i18n de los 22
    namespaces (`i18n/request.ts:7`, `app/[locale]/layout.tsx:75,95`). Un
    404 pesa 493 KB sin comprimir.
- `@next/bundle-analyzer` no está configurado, así que no se usó.

## Comparación con Core Web Vitals

Umbrales "good" de Google (percentil 75): LCP ≤ 2,5 s, CLS ≤ 0,1, INP ≤ 200 ms
([web.dev/articles/vitals](https://web.dev/articles/vitals)).

- **LCP:** todas las páginas pasan. La peor es el editor de Docs con 1,85 s,
  seguida de Robots, la lista de Links y el editor de Robots (~1,2 s). Para
  4x CPU y 4G es un buen punto de partida.
- **CLS:** dos páginas fallan.
  - **Editor de Docs: 0,215.** Los bloques se renderizan vacíos en el
    servidor y el texto se inyecta después de hidratar. La attribution del
    layout-shift muestra `.docs-block-outer` creciendo de 34 a 90 px a los
    ~2 s.
  - **Notes: 0,133.** El panel principal se reacomoda cuando NotesApp vuelve
    a pedir las notas por API al montar.
  - Docs home y el editor de Docs suman además 0,048 cuando el árbol de
    páginas se porta al sidebar (`#side-branch`) después de hidratar y empuja
    el pie del sidebar.
- **INP:** solo falla el editor de Excalidraw, con 320 ms en la mediana de la
  segunda pasada y 136 ms en la primera, al apretar una tecla de herramienta
  con CPU 4x. El resto queda por debajo de 200 ms. Abrir un registro desde
  una lista tarda entre 310 y 470 ms hasta ver la página nueva (es una
  navegación con render en el servidor). Lo más lento son las listas de
  Board (791 ms) y Cal (409 a 832 ms).
- **Incumbentes:** no hay datos públicos de CrUX por app logueada (Linear,
  Notion, HubSpot y Dub sirven sus apps detrás de login), así que la
  comparación justa son los umbrales. Como referencia cualitativa:
  - Notion publicó que pasar a SQLite en WASM aceleró la navegación entre
    páginas un 20 % (hasta 33 % en India) y que la carga inicial empeoró por
    bajar y procesar el WASM
    ([notion.com/blog](https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite)).
  - Linear se apoya en un sync engine local-first: las mutaciones se aplican
    en memoria y se sincronizan después, así que abrir un issue no espera al
    servidor. Fuentes secundarias:
    [performance.dev](https://performance.dev/how-linear-feels-instant),
    [análisis de la arquitectura](https://hungrymindsdev.substack.com/p/why-linear-feels-so-fast-technical).
  - Nuestro "abrir un issue" tarda unos 470 ms con CPU 4x. Ahí está la
    brecha con Linear: en la navegación, no en la carga inicial.

## Peores casos

1. **Editor de Docs:** CLS 0,215 y LCP 1,85 s, ambos por los bloques vacíos en
   SSR.
2. **Editor de Board:** 587 KB de JS y 1 MB en total, con INP de hasta 320 ms
   en una tecla.
3. **Notes:** CLS 0,133. Además, `listNotes` trae hasta 500 filas con
   `SELECT n.*` y la lista no está virtualizada.
4. **Todas las páginas:** el HTML lleva unos 158 KB gz de mensajes i18n de las
   11 apps, incluso en `/@handle`, el booking y el centro de ayuda. En las
   páginas públicas es más que todo su JS.
5. **Todas las páginas de la app:** 15 hojas de CSS (96 KB gz) que bloquean el
   render, y unos 160 KB extra de `router.refresh()` en la primera visita.
6. **`/api/docs/pages`:** 375 KB para 31 páginas, con contenido completo y sin
   límite.
7. **`/api/links/analytics`:** escala lineal con los clicks (23 ms con 6.000).

## Top 10 fixes por impacto

| # | Fix | App | Impacto esperado | Esfuerzo |
|---|---|---|---|---|
| 1 | Mandar al cliente solo los namespaces i18n de la ruta | todas | -130 a 150 KB gz por documento HTML y por cada refresh RSC | M |
| 2 | Deduplicar la sesión con `cache()` y bajar las queries del layout | todas | -5 a 10 round-trips a Turso por request en producción | S |
| 3 | Partir el CSS por app | todas | -70 a 80 KB gz de CSS que bloquea el render en cada página de la app | S |
| 4 | Renderizar el contenido de los bloques en SSR (Docs y Notes) | docs, notes | CLS 0,215 → ~0; LCP 1,85 s → ~1 s | S-M |
| 5 | Evitar el `router.refresh()` de la cookie `tz` en la primera visita | todas | -160 KB y un render del servidor en la primera visita | S |
| 6 | Editor de Board: onChange barato y precarga de Excalidraw | board | INP 320 → <150 ms; abrir pizarra sin esperar 587 KB | M |
| 7 | Chat: dejar de hacer polling cada 3 s | chat | -60 requests/min por pestaña abierta | M |
| 8 | Agents: índices para las stats y no cargarlas en el editor de Flow | agents, flow | Elimina 2 full scans por carga de Agents y del editor de Flow | S |
| 9 | Link: rollups diarios de clicks para analytics | link | Analytics O(días) en vez de O(clicks); redirect sin esperar el insert | M |
| 10 | Docs API y Notes: listas livianas y acotadas | docs, notes | `/api/docs/pages` 375 KB → ~10 KB; Notes deja de traer 500 notas completas | S |

### 1. Mensajes i18n por ruta

`i18n/request.ts:7-29` carga los 22 namespaces (568 KB de JSON en `es`) y
`app/[locale]/layout.tsx:75,95` los pasa enteros a
`<NextIntlClientProvider messages={messages}>`. Cada HTML lleva unos 158 KB
gz de mensajes; el documento entero pesa entre 160 y 200 KB gz. La bio
pública, el booking y el centro de ayuda bajan los textos de CRM, Flow y
Legal.

**Fix:**

- En el layout raíz, pasar `pick(messages, ['common', ...])`.
- Cada layout de app (`app/[locale]/app/<app>/layout.tsx`) envuelve con un
  provider anidado que suma solo su namespace.
- Las páginas públicas suman el suyo (`feedbackBoard`, `calendar`, `link`).
- Los server components siguen leyendo todo con `getTranslations`.

Es el cambio que más baja FCP en 4G, porque el HTML es el primer recurso que
bloquea.

### 2. Sesión deduplicada y layout más barato

`getCurrentUser` (`lib/session.ts:54-71`) no está envuelto en React
`cache()`. En una request corre tres veces: en `components/Header.tsx:8`, en
el `requireUser` de `app/[locale]/app/layout.tsx:47` y en el `requireUser` de
la página. Cada llamada hace `getServerSession`, `getUserByEmail` y
`resolveWorkspace`, que suman hasta 4 queries. En `DEMO_MODE` además escribe
`UPDATE users SET seeded_at…` cada vez (`lib/seed.ts:181`). El layout suma
`countDueTasks`, unos 12 `getTranslations` seguidos (`layout.tsx:50-62`) y
`signVisitorIdentity`.

Con SQLite local no se nota (TTFB de 20 a 40 ms), pero en Turso cada query es
un RTT.

**Fix:**

- Envolver `getCurrentUser` en `cache()`.
- Correr en paralelo con `Promise.all` las lecturas del layout.
- En `getDemoUser`, marcar en memoria que ya se sembró.

### 3. CSS por app

`app/[locale]/app/layout.tsx:12-27` importa el CSS de todas las apps:

- `crm.css` (3.235 líneas)
- `track.css` (2.671)
- `docs.css`
- `flow.css` y `@xyflow/react/dist/style.css`
- el resto de las apps

`app/[locale]/layout.tsx:18` suma `board-public.css` en todas las páginas,
incluidas las públicas. Son 15 hojas y 96 KB gz que bloquean el render en
cada página de la app.

**Fix:** mover cada import al layout de su app (`app/[locale]/app/crm/layout.tsx`,
etc.), dejar en el layout común solo `app.css`/`color.css`, e importar el CSS
de xyflow solo en el editor de Flow.

### 4. Bloques de Docs y Notes renderizados en el servidor

`components/docs/DocsBlockEditor.tsx:97-107` escribe `el.innerHTML =
block.content` en un `useLayoutEffect`. El HTML del servidor trae los
`contentEditable` vacíos y el texto aparece recién al hidratar, después de
bajar y ejecutar 259 KB de JS.

Medido:

- LCP de 1,85 s (contra ~0,9 s del resto).
- CLS de 0,167 en un solo shift a los ~2 s, cuando 5 bloques crecen de 34 a
  90 px.

Notes usa el mismo editor (`components/notes/NoteEditorPane.tsx:5`) y vuelve
a pedir la lista al montar (`components/notes/NotesApp.tsx:178,201`), lo que
le da CLS 0,133.

**Fix:**

- Primer render con `dangerouslySetInnerHTML={{ __html: block.content }}` y
  `suppressContentEditableWarning`. El efecto sigue sincronizando solo cuando
  el contenido cambia por fuera del tipeo.
- En Notes, usar los datos del server component como estado inicial en vez
  de refetchear.
- Reservar el alto de `#side-branch` (`components/app/AppSidebar.tsx:352`).

### 5. Cookie de zona horaria sin refresh completo

En la primera visita a la app, `components/app/TimezoneCookie.tsx:46` llama a
`router.refresh()` y vuelve a bajar el árbol RSC completo (~159 KB, medido).

**Fix:**

- Refrescar solo si la página muestra fechas que dependen de "hoy".
- O renderizar esas fechas en el cliente.
- O mandar la zona en el primer request (un script inline en `<head>` que
  escribe la cookie antes del primer fetch de RSC, o el login).

Con el fix 1 el costo baja solo, porque el refresh deja de arrastrar los
mensajes.

### 6. Editor de Board

Abrir una pizarra baja 587 KB de JS (ver bundle). `onChange`
(`components/board/BoardEditor.tsx:403-422`) calcula `signature()` sobre
todos los elementos y llama a `setState('dirty')` en cada cambio de
Excalidraw, incluidos los cambios de `appState`, como elegir una
herramienta. Con CPU 4x, apretar `r` dio INP de 136 a 320 ms.

**Fix:**

- Ignorar los cambios que son solo de `appState`.
- No hacer `setState` si ya está en `dirty`.
- Calcular la firma con el `sceneVersion` de Excalidraw
  (`getSceneVersion`) en vez de recorrer los elementos.
- Precargar `ExcalidrawCanvas` con un `import()` al hacer hover o focus en la
  tarjeta de `BoardList`.
- `app/[locale]/app/board/[id]/page.tsx` pide `getBoard` dos veces (en
  `generateMetadata` y en la página): pasarlo por `cache()`.

### 7. Chat sin polling agresivo

- `components/chat/InboxShell.tsx:121,139-171` pide conversaciones y tags al
  montar y repite cada 10 s.
- `components/chat/ConversationClient.tsx:280-291` pide mensajes completos,
  typing y la conversación cada 3 s: unas 60 requests por minuto por pestaña.
- `listChatConversations` (`lib/chat-data.ts:911-928`) corre 2 o 3
  subqueries correlacionadas por fila.

Con Turso, cada pestaña abierta es carga constante.

**Fix:**

- Usar `?since=<updated_at>` para traer solo lo nuevo, o SSE.
- Pausar el polling con `document.hidden`.
- Guardar `last_message_body` desnormalizado en `chat_conversations`.

### 8. Stats de Agents con índice

`listAgents` (`lib/agents.ts:157-176`) agrega `agent_conversations` con
`WHERE user_id = ? AND created_at >= ?` y `agent_feedback` con `WHERE
user_id = ?`. Los dos solo tienen índices por `agent_id`
(`lib/schema/migrations.ts:761,804`). `EXPLAIN QUERY PLAN` da `SCAN
agent_conversations USING INDEX idx_agent_conversations_agent` y `SCAN
agent_feedback`, es decir, dos full scans que crecen con cada conversación.
El editor de Flow (`app/[locale]/app/flow/[id]/page.tsx:27-30`) carga
`listAgents` completo, con estas stats, solo para el selector de agentes.

**Fix:**

- Migración con índices `agent_conversations(user_id, created_at)` y
  `agent_feedback(user_id, agent_id)`.
- Una variante `listAgentOptions` (id, nombre, emoji) para los selectores.
- `listAgents` ordena por `created_at` pero el índice es `(user_id,
  updated_at)`, lo que genera un temp B-tree.

### 9. Analytics de Link con rollups

`/api/links/analytics` tarda 23 ms con 6.000 clicks. El plan hace join de
`links` con `clicks` y un `TEMP B-TREE FOR GROUP BY`, así que crece lineal
con los clicks. Dub resuelve esto con un store de eventos aparte. Acá alcanza
con:

- una tabla `link_clicks_daily(link_id, day, country, device, referrer,
  count)` que se actualiza en el mismo batch de `recordClick`
  (`lib/track.ts:145`) o en el cron por minuto;
- que analytics lea de ahí;
- en el redirect, mover el `INSERT INTO clicks` a `after()` para no esperar
  el RTT a Turso antes del 302.

### 10. Listas livianas en Docs API y Notes

- `GET /api/docs/pages` usa `listDocPages` (`lib/docs.ts:250-256`), que
  devuelve `SELECT *` con el `content` de todas las páginas y sin límite: 375
  KB para 31 páginas. Ya existe `listDocPageSummaries` (`lib/docs.ts:263`).
  Usarla en el endpoint y paginar.
- `listNotes` (`lib/notes.ts:282-284`) trae hasta 500 filas con `n.*` (blocks
  y `body_text` completos) para mostrar un snippet. Seleccionar columnas
  y un `substr(body_text, 1, 200)`, y paginar o virtualizar `NotesApp`.

### Otros hallazgos (menor impacto)

- **Sin `ANALYZE`:** no hay `sqlite_stat1` y el planner elige índices raros.
  Ordenar contactos por nombre usa `idx_crm_contacts_score`, y el `COUNT` de
  links usa `idx_links_user_creator`. Un `PRAGMA optimize` en el cron horario
  ayuda a que Turso elija bien cuando las tablas crecen.
- **Ordenamientos sin índice:** todos generan `TEMP B-TREE`, lo que hoy no
  pesa pero va a pesar con 50 mil filas:
  - contactos por nombre y por email (`COLLATE NOCASE`, `lib/crm.ts:575-578`);
  - links por clicks (`lib/links.ts:204`);
  - Docs por `position` (`lib/docs.ts:253`).
- **N+1 queries:**
  - `listDashboardsWithWidgets` (`lib/crm-dashboards.ts:83`): una query por
    dashboard;
  - `listLists` (`lib/crm.ts:2646`): un COUNT por lista;
  - `listAccessibleSubpages` (`lib/docs.ts:833`): `getDocAccess` por fila;
  - la lista de bookings de Cal (`lib/calendar.ts:1752`): `getEventTypeById`
    por booking.
- **Prefetch de detalles:** la lista de contactos hace prefetch de las
  páginas de detalle visibles (de 5 a 9 requests RSC). Está bien para la
  navegación, pero suma requests en la primera carga (82 en total).
- **Imágenes:** hay `<img>` sin `next/image` en 19 archivos, entre ellos
  `AppSidebar`, `BoardList`, `PublicBookingPage`, la bio y el booking. Hoy no
  pesan porque no hay imágenes grandes sembradas.
- **Lo que está bien:**
  - Excalidraw ya se carga con `next/dynamic` y su WASM de 722 KB gz no baja
    al abrir.
  - El middleware no toca la base.
  - Las fuentes usan `next/font`.
  - Todas las listas, salvo Chat, son server components con paginación.
