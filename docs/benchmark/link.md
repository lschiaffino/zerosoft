# Benchmark: Link vs Dub (y Bitly)

Fecha: 2026-10-22. Incumbente principal: Dub. Referencia secundaria: Bitly.

## Actualización 2026-10-27 (tanda de paridad 123)

Lo que cambió desde el relevamiento de abajo. La fuente de verdad del estado por fila es `content/feature-parity/link.ts`.

| Capacidad | Antes | Ahora | Cómo |
|---|---|---|---|
| Leads y ventas por click | falta | tiene | `?zs_id=` en el destino, script `/link-tracking.js`, `/api/v1/links/track/lead` y `/track/sale`, embudo, ingresos y CSV |
| Stripe y Shopify | falta | tiene | Conexión de Stripe del workspace (Checkout y facturas recurrentes) y webhook de pago de Shopify firmado |
| Stream de eventos | parcial | tiene | Vista Eventos que se refresca cada 3 s, filtro por link y páginas anteriores |
| Registro de actividad | falta | tiene | Antes y después por link y para todo el workspace (admins) |
| Protección contra phishing | sin fila | tiene | Safe Browsing en destino, variantes, redirección al vencer y redirecciones del dominio; homógrafos IDN; revisión semanal |
| Deep linking diferido | parcial | tiene | `/api/v1/links/track/open` con la publishable key del workspace, mismas puertas que el redirect |
| Link cloaking | falta | tiene | Solo dominios propios; sin atribución de conversiones (cookies del iframe) |
| QR con marcos y plantillas | parcial | tiene | Marco con texto, plantillas compartidas renombrables, PNG por API con marco (sharp) |
| Atajos por fila | parcial | tiene | j/k, Enter, e, q, d, a, s, x y `?` |
| Slack | falta | tiene | Desde Link se conecta con los eventos de Link activados |
| Zapier, Make, Segment | falta | parcial | Segment nativo; Zapier y Make por catch hook, sin app publicada |
| Servidor MCP | falta | tiene | `/api/v1/links/mcp` con scopes y carpetas |
| IA | falta | parcial | Preguntas sobre analytics en la app; crear links con IA solo por MCP |
| Rebrandly y Short.io | falta | tiene | Por API key de cada uno |

Siguen faltando: Domain Connect, SSO SAML, SCIM, programa de partners, SDKs, CLI y extensión de Raycast. Redirect medido con curl contra `next start`: p50 3 ms con y sin conversiones.

## Cómo se hizo

- **Competidor:** precios, centro de ayuda, docs, integraciones y changelog de Dub; precios y anuncios de Bitly (ver Fuentes). El centro de soporte de Bitly devolvió 403, así que lo de Bitly sale de su página de precios y prensa. Lo no confirmado en una página oficial está marcado "sin verificar".
- **Nuestra app:** lectura del código en `main` (`lib/link*.ts`, `lib/links.ts`, `app/r/[slug]`, `app/api/links/*`, `app/api/v1/links/*`, `components/link/*`) y recorrido con Playwright contra el servidor de producción compartido (DEMO_MODE) en 1440×900, 390×844 y modo oscuro: alta rápida con C, redirección con parámetros, slug inexistente, detalle, analytics, bio, carpetas, dominios, alta masiva, importación, Cmd+K.
- **Velocidad:** la máquina estaba con 17 builds en paralelo, así que no se reportan tiempos.

## Resumen

**Paridad global: 72 %.**

El manejo de links está prácticamente a la par de Dub: slugs, dominios propios con verificación, carpetas con permisos, tags, vencimiento, contraseña, targeting por país y dispositivo, A/B, deep links, vista previa OG, UTM con plantillas, reenvío de parámetros, QR con marca, comentarios, duplicar, acciones masivas y redirección propia para links vencidos o inexistentes. Las analytics también están cerca (filtros, ciudad, referrer completo, páginas públicas de analytics, CSV).

La distancia está en lo que Dub vende hoy: conversiones (leads y ventas por link) y su programa de partners, más integraciones (Zapier, Segment, Stripe, Shopify), SDKs, servidor MCP, SSO y registro de actividad. Desde mediados de 2025 casi todo el changelog de Dub es Partners; las funciones de links están estables.

Donde estamos mejor: página link-in-bio (Dub no tiene; Bitly la cobra), sin límite de links ni de retención por plan, importación desde Bitly por token o CSV, comentarios y Cmd+K en toda la suite, y el CRM propio como destino natural de la atribución cuando exista.

## Puntaje por área

| Área | Puntaje | Comentario |
|---|---|---|
| Gestión de links | 9/10 | Falta deep linking diferido, link cloaking y configuración de DNS en un clic |
| Colaboración | 8/10 | Roles, carpetas con ver/editar, comentarios, filtro por creador |
| Conversiones y partners | 1/10 | Solo clicks; sin leads, ventas ni programa de afiliados (idea de conversiones ya en el backlog) |
| Integraciones y API | 5/10 | API v1 completa y webhooks con alcance; sin SDKs, Zapier, Segment, Stripe, Shopify, extensión ni MCP |
| Admin y permisos | 3/10 | Roles del workspace; sin SSO, SCIM ni registro de actividad |
| Analytics | 8/10 | Filtros, ciudad, QR aparte, páginas públicas, CSV; sin stream de eventos en tiempo real |
| Móvil | 4/10 | Lista correcta a 390 px; el detalle tiene scroll horizontal (bug); sin app ni extensión |
| IA | 1/10 | Bitly Assist (abril 2026) y MCP de Dub y Bitly; acá nada |
| Importar y exportar | 7/10 | Bitly por token o CSV, CSV de links y clicks; sin Rebrandly ni Short.io |
| UX y pulido | 7/10 | C, pegar una URL abre el alta, Cmd+K, acciones masivas; sin atajos por fila (e, x), "/" no enfoca la búsqueda, bio sin vista previa |

## Capacidades, una por una

Leyenda: **tiene**, **parcial**, **falta**, **mejor**.

### Gestión de links

| Capacidad | Dub | Link | Nota |
|---|---|---|---|
| Links cortos y slug propio con chequeo de disponibilidad | todos | tiene | |
| Dominios propios con verificación DNS | 100 / 250 / ilimitados | tiene | |
| Configuración de DNS en un clic (Domain Connect) | agosto 2026 | falta | |
| Dominio .link gratis | todos | falta | Fuera de alcance para self-host |
| Tags | ilimitados | tiene | |
| Carpetas con permisos por carpeta | 20 / 50 / ilimitadas | tiene | |
| Vencimiento, límite de clicks, contraseña | todos | tiene | Límite de clicks: Dub no lo documenta |
| Redirección propia para vencidos e inexistentes | todos | tiene | Sin configurar, el slug inexistente va a `/gone?reason=notfound` |
| Targeting por país y dispositivo | todos | tiene | |
| A/B entre destinos | todos | tiene | Hasta 5 variantes, pegajoso por visitante |
| Deep links iOS / Android | todos | parcial | Sin deep linking diferido (después de instalar la app) |
| Link cloaking (enmascarar el destino) | todos | falta | |
| Vista previa OG propia | todos | tiene | Se sirve a los bots de previews |
| UTM con plantillas del workspace | todos | tiene | |
| Reenvío de parámetros al destino | sin verificar | tiene | Probado: `?ref=tw&utm_campaign=x` llega al destino |
| QR con colores, forma y logo | todos | tiene | Escaneos contados aparte; sin marcos ni plantillas |
| Link-in-bio | no tiene (Bitly Pages, de pago) | **mejor** | Sin vista previa en vivo, sin temas, solo links cortos existentes |
| Comentarios internos y duplicar | todos | tiene | |

### Colaboración y admin

| Capacidad | Dub | Link | Nota |
|---|---|---|---|
| Workspaces y roles | todos (Viewer y Billing desde enero 2026) | tiene | Roles compartidos con la suite |
| Permisos por carpeta | todos | tiene | |
| SSO SAML | Enterprise | falta | |
| SCIM | Enterprise (sin verificar) | falta | |
| Registro de actividad | Enterprise | falta | |

### Conversiones

| Capacidad | Dub | Link | Nota |
|---|---|---|---|
| Leads y ventas por click (SDK, `/track/lead`, `/track/sale`) | todos | falta | Idea ya en el backlog |
| Stripe / Shopify para ventas | todos | falta | |
| Programa de partners y afiliados | todos (más en Advanced) | falta | Producto entero; fuera del top 10 para un equipo chico |

### Integraciones y API

| Capacidad | Dub | Link | Nota |
|---|---|---|---|
| API REST | todos | tiene | `/api/v1/links`, stats y analytics; OpenAPI publicado |
| SDKs (TS, Python, Ruby, PHP, Go) | todos | falta | |
| Webhooks con alcance por link o carpeta | todos | tiene | |
| Zapier, Make, Segment | todos | falta | |
| Slack (avisos) | todos | falta | |
| Extensión de Chrome / Raycast | Raycast sí, Chrome sin verificar | falta | |
| Servidor MCP | sí | falta | Bitly también tiene desde marzo 2026 (sin verificar) |
| CLI | sí | falta | |

### Analytics

| Capacidad | Dub | Link | Nota |
|---|---|---|---|
| Clicks por día, referrers, países, ciudades, dispositivos, navegadores, SO | todos | tiene | |
| Filtros por tag, dominio, link, país, dispositivo y zona horaria | todos | tiene | |
| Página pública de analytics por link o tag | todos | tiene | |
| Export CSV | todos | tiene | Workspace y por link |
| Stream de eventos en tiempo real | todos | parcial | Hay log de clicks paginado, sin actualización en vivo |
| Retención | 3 años / 5 años / ilimitada | **mejor** | Sin límite por plan |

### Móvil, IA, importar

| Capacidad | Dub | Link | Nota |
|---|---|---|---|
| App móvil | no encontrada | falta | |
| IA para crear y analizar links | Bitly Assist (abril 2026) | falta | |
| Importar desde Bitly | sí | tiene | Por token de API o CSV |
| Importar desde Rebrandly y Short.io | sí | falta | |
| Alta masiva por CSV | sí | tiene | Hasta 200 por vez, dominio y slug por fila |

### UX y pulido

| Capacidad | Dub | Link | Nota |
|---|---|---|---|
| Crear con C | sí | tiene | También pegando una URL en la página |
| Atajos por fila (e editar, x borrar) | sí | falta | Solo acciones con mouse en la fila |
| Acciones masivas | sí | tiene | Archivar, tag, mover a carpeta, borrar |
| Cmd+K | sin verificar | **mejor** | Encuentra el link por slug |
| Claro, oscuro, 390 px | sí | parcial | Ver bug del detalle en móvil |

## Paridad de UX en los flujos principales

| Flujo | Dub | Link |
|---|---|---|
| Acortar y copiar | C, pegar URL, crear (copia automática) | C, pegar URL, "Create link"; copia y muestra aviso con "View link". Mismos pasos |
| Ver rendimiento de un link | Clic en la fila, panel de analytics | Clic en la fila, pestaña Overview con totales, gráfico, referrers y países; "See full analytics" |
| Editar | Panel lateral con atajos por campo | Pestaña Settings del detalle |
| Mover muchos links | Selección + barra masiva | Igual |

## Top 10 brechas (impacto para un equipo chico que viene de Dub)

| # | Brecha | Por qué volverían a Dub | Esfuerzo |
|---|---|---|---|
| 1 | Conversiones: leads y ventas por link, con CRM (idea existente) | Es la razón principal por la que hoy se elige Dub | L |
| 2 | Integraciones Zapier / Make y Slack | Conectar links con el resto de las herramientas sin código | M |
| 3 | SDK TypeScript y servidor MCP | Equipos técnicos crean links desde su producto o desde un agente | M |
| 4 | Atajos por fila y "/" para buscar | Quien viene de Dub usa e y x todo el tiempo | S |
| 5 | Deep linking diferido | Apps móviles que migraron de Firebase Dynamic Links | L |
| 6 | Importar desde Rebrandly, Short.io y CSV genérico | Hoy solo Bitly; el resto recrea a mano | S |
| 7 | Bio con vista previa, temas y links externos | Si la bio es nuestra ventaja, tiene que verse terminada | M |
| 8 | Link cloaking | Mantener el dominio propio en la barra del navegador | S |
| 9 | Registro de actividad del workspace | Saber quién cambió el destino de un link que ya está impreso en un QR | M |
| 10 | Avisos en tiempo real (stream de clicks en vivo) | Lanzamientos y campañas que se miran en directo | S |

## Bugs encontrados

1. **Scroll horizontal en el detalle del link a 390 px.** Abrir un link con slug largo en `/en/app/links/<id>` en 390×844. El título (`localhost:3270/linkbenchvce1`) no se corta y la página mide 472 px de ancho; las pestañas "Comments" y "Settings" quedan cortadas.
2. **"/" no enfoca la búsqueda en la lista de links.** En `/en/app/links` apretar "/": el foco queda en el body. (Si la convención de la suite es otra, ignorar; Dub y Linear lo usan.)
3. **"?" no muestra los atajos.** En la lista de links no hay ayuda de teclado; el único atajo visible es [c] en el botón.

## Fuentes

- Dub precios: https://dub.co/pricing
- Dub prueba gratis y límites: https://dub.co/help/article/free-trial.md
- Dub changelog: https://dub.co/changelog
- Dub ayuda (índice): https://dub.co/help
- Dub integraciones: https://dub.co/integrations
- Dub producto Links: https://dub.co/links
- Dub carpetas y permisos: https://dub.co/help/article/folders-rbac.md
- Dub A/B: https://dub.co/help/article/ab-testing.md
- Dub deep links: https://dub.co/docs/concepts/deep-links/quickstart.md
- Dub previews: https://dub.co/help/article/custom-link-previews.md
- Dub plantillas UTM: https://dub.co/help/article/how-to-create-utm-templates.md
- Dub QR: https://dub.co/help/article/custom-qr-codes.md
- Dub comentarios: https://dub.co/help/article/link-comments
- Dub roles Viewer y Billing: https://dub.co/changelog/viewer-billing-roles
- Dub SSO y SCIM: https://dub.co/help/article/okta-saml.md, https://dub.co/help/article/okta-scim.md
- Dub SDKs: https://dub.co/docs/sdks/overview.md
- Dub webhooks: https://dub.co/docs/webhooks/event-types.md
- Dub conversiones: https://dub.co/help/article/dub-conversions.md, https://dub.co/docs/concepts/attribution.md
- Dub analytics compartidas y export: https://dub.co/help/article/share-analytics.md, https://dub.co/help/article/how-to-export-analytics.md
- Dub MCP: https://dub.co/docs/mcp-server.md
- Dub migraciones: https://dub.co/help/article/migrating-from-bitly.md, https://dub.co/help/article/migrating-from-rebrandly.md, https://dub.co/help/article/migrating-from-short.md
- Dub atajos: https://dub.co/changelog/keyboard-shortcuts
- Dub Domain Connect: https://dub.co/changelog/domain-connect
- Bitly precios: https://bitly.com/pages/pricing
- Bitly Assist: https://bitly.com/pages/resources/press/bitly-introduces-ai-powered-features/
