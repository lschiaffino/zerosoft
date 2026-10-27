# Benchmark: Docs vs Notion (y Confluence)

Fecha: 2026-10-22. Base: `main` en 644c85b.

Método: lista de capacidades de Notion armada con su ayuda, precios y notas de versión de
2025-2026 (fuentes al final). Confluence entra solo donde cambia la comparación. Del lado
nuestro, lectura del código (`components/docs`, `lib/docs*.ts`, `app/api/docs`) y una pasada en
el navegador con Playwright sobre un build de producción en DEMO_MODE (1440×900 claro y oscuro,
390×844 oscuro). El build del worktree no terminó porque la máquina corría siete builds en
paralelo, así que la pasada se hizo con `next start` sobre el build de producción de `main`
(0793fba, un commit después de la base; ese commit solo toca diálogos de CRM). Por la misma
carga, los tiempos medidos (2,9 s para abrir Docs, 2,3 s para cambiar de nota) no sirven como
medida de velocidad. `docs/feature-map.md` y `research/ideas.json` se usaron como punto de partida, no como
prueba.

Escala: **tiene** = funciona de punta a punta; **parcial** = existe pero con menos alcance que
Notion; **falta** = Notion lo tiene y nosotros no; **mejor** = hacemos algo que Notion no hace o
lo hace peor.

## Resumen

| Área | Puntaje (0-10) | Comentario corto |
|---|---|---|
| Edición y modelo de datos | 6 | Bloques completos para escribir. Las bases de datos son una tabla con 4 tipos de columna. |
| Colaboración | 4 | Comentarios con hilos, menciones y notificaciones. Sin edición en tiempo real ni presencia. |
| Automatización | 6 | Eventos de página y de bases hacia Flow y webhooks, y pasos de Flow que crean y editan páginas y filas (tanda D4). |
| Integraciones y API | 7 | Board embebido, Chat usa las páginas como fuente, API pública, webhooks y servidor MCP de Docs, bases sincronizadas (tanda D4). |
| Admin y permisos | 4 | Compartir por equipo o persona con ver/editar y herencia. Sin bloqueo de página, sin auditoría. |
| Analítica | 1 | Solo votos "¿Te sirvió?" en el centro de ayuda. Sin vistas por página. |
| Móvil y offline | 3 | La web se adapta a 390px. Sin app, sin offline. |
| IA | 7 | IA en el editor, preguntas sobre el workspace, notas de reunión y agentes que editan páginas (tanda D4). |
| Importar y exportar | 4 | Importa .md y .docx a una página y pega Markdown/HTML. Exporta una página a Markdown o PDF. |
| Rendimiento y confiabilidad | 6 | Autoguardado, historial de 50 versiones, aviso de conflicto 409. Ver nota de velocidad abajo. |
| Pulido de UX | 7 | `/`, atajos Markdown, ⌘P, ⌘K, `C`, arrastre en el árbol, plantillas, papelera. |

**Paridad global: 45%**. Es el promedio de las áreas ponderado según cuánto pesa cada una para
un equipo chico que usa Notion como wiki y documentos:

| Área | Peso |
|---|---|
| Edición | 25% |
| Colaboración | 20% |
| UX | 10% |
| Import/export | 10% |
| Permisos | 10% |
| Rendimiento | 5% |
| IA | 5% |
| Móvil | 5% |
| Automatización | 4% |
| Integraciones | 3% |
| Analítica | 3% |

Dónde estamos **mejor** que Notion:

- **Centro de ayuda público incluido.** Publicar una página la pone en `/h/<handle>` con
  colecciones, búsqueda BM25 y votos por artículo. En Notion eso es Notion Sites, y el dominio
  propio cuesta USD 8-10 por mes aparte ([precios](https://www.notion.com/pricing)).
- **Las páginas alimentan al bot de Chat** con un interruptor por página ("AI can use it"). En
  Notion la IA para clientes externos no viene integrada.
- **Board embebido** como bloque (`/board`), enlazado a la app Board.
- **Historial de versiones sin límite de días**: guardamos las últimas 50 por página en todos los
  planes. Notion da 7 días en Free y 30 en Plus.
- **Precio**: Docs viene con el resto de las apps; Notion Business cuesta USD 20 por usuario por
  mes.

## Capacidades

### Edición y modelo de datos

| Capacidad | Notion | Docs | Estado |
|---|---|---|---|
| Bloques de texto, títulos H1-H3, listas, to-do, cita, código, divisor | Sí | Sí | tiene |
| Toggle, toggle headings, callout, anidado con Tab | Sí | Sí | tiene |
| Atajos Markdown al escribir (`#`, `-`, `[]`) | Sí | Sí | tiene |
| Tabla simple | Sí | Sí | tiene |
| Imagen y archivo con subida, pegar y arrastrar | Sí (5 MB Free, 5 GB pagos) | Sí, hasta 10 MB por archivo | parcial |
| Columnas (layout de 2-5 columnas) | Sí | No | falta (en ideas.json) |
| Embeds de terceros (YouTube, Figma, Loom, 500+) y bookmarks con vista previa | Sí | Solo Board embebido | falta (en ideas.json) |
| Bloques sincronizados | Sí ([ayuda](https://www.notion.com/help/synced-blocks)) | No | falta |
| Ecuaciones, tabla de contenidos, botón, breadcrumbs como bloque | Sí | No (el TOC existe solo en el centro de ayuda) | falta |
| Base de datos: tipos de propiedad | ~20 (persona, checkbox, URL, relación, rollup, fórmula, estado...) | 4 (texto, número, select, fecha) | parcial |
| Base de datos: vistas | Tabla, board, timeline, calendario, lista, galería, gráfico, formulario, mapa | Tabla y galería | parcial |
| Base de datos: filtros, orden, agrupar | Sí | No | falta (en ideas.json) |
| Base de datos a página completa, filas que abren como página | Sí | No | falta |
| Relaciones y rollups entre bases | Sí | No | falta |
| Menciones de página `[[` y de persona `@` | Sí | Sí | tiene |
| Menciones de fecha y recordatorios (`@hoy`, `@remind`) | Sí ([ayuda](https://www.notion.com/help/comments-mentions-and-reminders)) | No | falta |
| Backlinks ("Linked from") | Sí | Sí | tiene |
| Ícono y portada | Sí, portada con subida | Ícono emoji; portada por URL o 4 presets | parcial |
| Selección múltiple de bloques y acciones en lote | Sí | Sí | tiene |
| Deshacer/rehacer propio del editor | Sí | Sí | tiene |
| Wiki con páginas verificadas y vencimiento | Sí ([ayuda](https://www.notion.com/help/wikis-and-verified-pages)) | Verificar por 7 a 365 días o sin vencimiento, con dueño; aviso al vencer (app y email) y lista de la wiki en el inicio | tiene |

### Colaboración

| Capacidad | Notion | Docs | Estado |
|---|---|---|---|
| Edición simultánea en tiempo real con cursores | Sí, tecla por tecla | Cursores y selecciones en vivo; los cambios se fusionan cada 1,5 s por bloque y por tramo (polling, sin websockets). Si dos escriben sobre las mismas palabras gana lo propio | parcial |
| Presencia (avatares de quién está viendo) | Sí | Sí, con salto al bloque de cada persona | tiene |
| Comentarios de página y por bloque, resolver/reabrir | Sí | Sí | tiene |
| Respuestas, @menciones en comentarios, notificaciones | Sí | Sí | tiene |
| Comentario sobre un texto seleccionado (inline) | Sí | Sí: resaltado, hilo, ⌘⇧M, pestañas Abiertos/Resueltos | tiene |
| Sugerencias de edición (modo sugerir, aceptar/rechazar) | Sí ([ayuda](https://www.notion.com/help/suggested-edits)) | Sí, en bloques de texto, de a una o todas, con aviso al dueño | tiene |
| Invitados externos a una página | Sí (10 en Free, ilimitados en pagos) | Por email, sin cuenta, con rol; solo esa página y sus subpáginas | tiene |
| Bandeja de notificaciones | Sí | Sí (campana global de la app) | tiene |

### Automatización

| Capacidad | Notion | Docs | Estado |
|---|---|---|---|
| Automatizaciones de base de datos (al agregar, al editar, programadas) | Sí ([ayuda](https://www.notion.com/help/database-automations)) | No | falta |
| Botones (insertar bloques, crear páginas, webhook) | Sí ([ayuda](https://www.notion.com/help/buttons)) | No | falta |
| Eventos hacia un motor de flujos | Webhooks de la API | Flow y webhooks: página creada, editada (agrupada por página), a la papelera y comentada; fila nueva y propiedad cambiada (tanda D4) | tiene |
| Acción "crear/editar página" desde un flujo | Sí (API y automatizaciones) | Pasos "Docs: crear o editar página" (plantilla con variables, subpágina, agregar, reemplazar, renombrar, papelera) y "Docs: agregar o actualizar fila" | tiene |

### Integraciones y API

| Capacidad | Notion | Docs | Estado |
|---|---|---|---|
| API pública REST con tokens | Sí | `/api/v1/docs`: páginas, bloques, bases, filas, búsqueda y comentarios con scopes docs:read y docs:write | tiene |
| Webhooks de la API | Sí ([referencia](https://developers.notion.com/reference/webhooks)) | Webhooks salientes firmados (HMAC) con reintentos para los seis eventos de Docs | tiene |
| Servidor MCP para agentes externos | Sí ([v3.8](https://www.notion.com/releases/2026-10-13)) | `/api/v1/docs/mcp` con 12 herramientas (buscar, leer, crear y editar páginas y filas, comentarios) | tiene |
| Bases sincronizadas con GitHub/Jira/Salesforce | Sí (v3.8) | GitHub (issues o PRs), Jira (JQL), Salesforce (5 objetos) y CRM de zerosoft, solo lectura, refresco por cron con claim; Jira y Salesforce sin probar contra las APIs reales, tokens pegados a mano | parcial |
| Integración con otras apps de la suite | Notion Mail y Calendar | Board embebido; Chat y Agents leen páginas | mejor (en la suite) |

### Admin y permisos

| Capacidad | Notion | Docs | Estado |
|---|---|---|---|
| Compartir por persona o equipo con roles | Sí (ver, comentar, editar, acceso total) | Sí, los cuatro | tiene |
| Herencia de permisos a subpáginas | Sí | Sí, con opción de cortar la herencia | tiene |
| Página bloqueada (lock page) | Sí | Sí, también "desbloquear solo para mí" | tiene |
| Permisos de solo lectura para miembros del workspace | Sí | Sí: rol de los miembros en Ajustes y por página o teamspace | tiene |
| Teamspaces privados | Sí (Business) | Abiertos, cerrados y privados, con sección en el sidebar, uno por defecto con todos, y fuera de la IA salvo que se habilite | tiene |
| SSO SAML, SCIM | Business/Enterprise | Fuera de alcance de este benchmark (nivel cuenta) | n/a |
| Registro de auditoría | Enterprise ([ayuda](https://www.notion.com/help/audit-log)) | Sí, con filtros y CSV, un año | tiene |
| Desactivar export y publicación | Enterprise | Sí, y también los invitados | tiene |

### Analítica

| Capacidad | Notion | Docs | Estado |
|---|---|---|---|
| Vistas por página (totales, únicas, quién la vio) | Sí ([ayuda](https://www.notion.com/help/page-analytics)) | No | falta |
| Analítica del sitio publicado | Google Analytics en Sites pagos | Votos "¿Te sirvió?" por artículo | parcial |
| Búsquedas sin resultado en el centro de ayuda | No | No | n/a |

### Móvil y offline

| Capacidad | Notion | Docs | Estado |
|---|---|---|---|
| App nativa iOS/Android | Sí | No; web adaptada (árbol plegable bajo "Pages (n)") | parcial |
| Modo offline | Sí, en apps de escritorio y móvil ([v2.53](https://www.notion.com/releases/2025-08-19)) | No | falta |

### IA

| Capacidad | Notion | Docs | Estado |
|---|---|---|---|
| IA en el editor (resumir, mejorar, traducir, continuar) | Sí | Espacio en línea vacía, "Preguntarle a la IA" en la selección y /ai, con vista previa y aceptar o descartar | tiene |
| Preguntas sobre todo el workspace (Q&A) | Sí | Panel "Preguntarle a la IA" (banda, sidebar y ⌘K) con citas a las páginas que la persona puede abrir | tiene |
| Notas de reunión con IA (`/meet`) | Sí ([v2.51](https://www.notion.com/releases/2025-05-13)) | Bloque /reunión: micrófono y audio de la pestaña (o transcripción pegada), resumen, decisiones y tareas a Track o al CRM | tiene |
| Agentes que editan páginas | Sí (Notion 3.0 y Custom Agents) | Agents lee, edita y crea páginas y filas en las páginas que elige su dueño, con aprobación opcional | tiene |
| Autocompletar propiedades con IA | Sí ([ayuda](https://www.notion.com/help/autofill)) | No | falta |
| Bot para clientes que responde con las páginas | No incluido | Sí (Chat con "AI can use it") | mejor |

### Importar y exportar

| Capacidad | Notion | Docs | Estado |
|---|---|---|---|
| Importar .md y .docx | Sí | Sí, a una página, hasta 4 MB | tiene |
| Pegar Markdown/HTML como bloques | Sí | Sí | tiene |
| Importar desde Notion, Confluence, Google Docs, Evernote | Sí ([ayuda](https://www.notion.com/help/import-data-into-notion)) | No | falta |
| Importar CSV como base de datos | Sí | No | falta |
| Exportar una página a Markdown | Sí | Sí | tiene |
| Exportar a PDF | Sí, con tamaño de papel | Con el diálogo de impresión del navegador | parcial |
| Exportar HTML, exportar subpáginas, exportar todo el workspace | Sí ([ayuda](https://www.notion.com/help/export-your-content)) | No | falta |
| Exportar base de datos a CSV | Sí | No | falta |

### Rendimiento y confiabilidad

| Capacidad | Notion | Docs | Estado |
|---|---|---|---|
| Autoguardado | Continuo | 600 ms después de la última edición, con estado visible | tiene |
| Historial de versiones con restaurar | 7/30/90 días según plan; ilimitado en Enterprise | Últimas 50 versiones, snapshot cada 5 min como mucho | tiene |
| Ver qué cambió entre versiones | Sí | Sí, por bloque y por palabra, y contra la actual | tiene |
| Conflictos entre dos editores | Se fusionan | Se fusionan por bloque y por tramo; mismas palabras: gana lo propio | tiene |

### Pulido de UX

| Capacidad | Notion | Docs | Estado |
|---|---|---|---|
| Menú `/` | Sí | Sí, 20 comandos con filtro | tiene |
| Buscador de páginas ⌘P y paleta ⌘K | Sí | Sí, busca título y contenido | tiene |
| Crear página con un atajo | Sí | `C` en el listado | tiene |
| Árbol con arrastrar para anidar y reordenar | Sí | Sí, con alternativa de teclado | tiene |
| Favoritos en el sidebar | Sí | No | falta |
| Plantillas | Galería pública más plantillas propias | 4 integradas más plantillas del workspace | parcial |
| Papelera con restaurar | Sí (30 días) | Sí, sin vencimiento | tiene |
| Ancho completo y texto chico | Sí, se guardan por página | Sí, se guardan por página (`small_text`, `full_width`; el feature-map todavía dice que no) | tiene |
| Dominio propio para lo publicado | Add-on pago | No en Cloud | falta |

## Paridad de UX en los flujos principales

| Flujo | Notion | Docs (medido en el navegador) | Nota |
|---|---|---|---|
| Crear una página y escribir | ⌘N o "+", 1 paso | `C` en el listado (o "New page"): abre la página nueva con el foco en el título. 1 tecla | Paridad. Antes de hidratar la página, `C` no hace nada; en una máquina cargada eso dura 2-3 s. |
| Dar formato al escribir | `#`, `-`, `[]`, `/` | Igual: `# `, `- ` y `[] ` se convierten al vuelo. `/` abre 20 comandos agrupados, con atajo visible al lado | Paridad |
| Insertar una base de datos | `/database` | `/database` inserta una tabla con Name, Status (Todo/Doing/Done) y Due, y un selector Table/Gallery | La tabla se corta a la derecha en 1440 px y en 390 px (scroll interno); no hay filtro ni orden |
| Guardar | Continuo | "Saving…" y luego "Saved" en la barra; al recargar está todo | Paridad |
| Título en el sidebar | En vivo | En vivo después de guardar | Paridad |
| Buscar una página | ⌘P / ⌘K | ⌘P busca título y contenido; ⌘K global encuentra la página; estado vacío "No pages match your search." | Paridad |
| Compartir | Botón Share, invitar por mail | Diálogo con invitar (email, miembro o equipo), rol, acceso del workspace, publicar al centro de ayuda y "Advanced" (uso por la IA de Chat) | Bien. Falta el rol "puede comentar" |
| Dos personas editando | Se fusiona en vivo | La segunda pestaña muestra "Someone else edited this page…" con "Load the new version" y "Overwrite with my changes" | Brecha principal (ver bug 1 sobre cómo se ve) |
| Borrar | "···" > Delete | "···" > Move to trash: va al inicio y la papelera muestra el contador. Sin diálogo de confirmación, se deshace desde la papelera | Paridad |
| Móvil 390 px | App nativa | Sin scroll horizontal; árbol plegado bajo "Pages (n)"; barra con Comments y Share | Usable; la tabla de la base de datos queda cortada |
| Oscuro | Sí | Landing y editor se ven bien en oscuro | Paridad |

## Top 10 brechas para un equipo chico que viene de Notion

Ordenadas por cuánto pesan en la decisión de volver a Notion.

| # | Brecha | Por qué hace volver | Esfuerzo | En ideas.json |
|---|---|---|---|---|
| 1 | Edición en tiempo real y presencia | Dos personas en la misma página reciben un 409. En una reunión eso pasa a los cinco minutos. | L | Sí |
| 2 | Bases de datos con filtro, orden, agrupar, board y calendario | Los equipos chicos usan Notion para trackers. Una tabla sin filtro no reemplaza eso. | L | Sí |
| 3 | Importar un workspace de Notion (zip de Markdown/CSV) con jerarquía | Sin esto, migrar es copiar y pegar página por página. | M | No |
| 4 | Más tipos de propiedad (persona, checkbox, URL, estado) y filas que abren como página | Sin persona ni checkbox no se puede armar un tracker de tareas. | M | No |
| 5 | IA en el editor | Notion la incluye en Business; la gente la usa todos los días. | M | Sí |
| 6 | Embeds, bookmarks y columnas | Las páginas de proyecto de Notion están llenas de Figma, Loom y videos. | M | Sí |
| 7 | Comentarios sobre texto seleccionado y modo sugerir | Revisar un documento sin poder marcar una frase es lento. | M | No |
| 8 | Exportar subpáginas y el workspace entero (Markdown/HTML en zip) | Es la garantía de salida que pide cualquier equipo antes de mudarse. | S | No |
| 9 | Favoritos y bloqueo de página | Atajos chicos que se extrañan desde el primer día. | S | No |
| 10 | Menciones de fecha y recordatorios en una página | Sostiene los to-do con fecha dentro de una página. | S | No |

Estado al 2026-10-27 (tanda D5): importar desde Notion (Markdown/CSV o HTML),
Confluence, Google Docs, Word y Evernote, exportar Markdown/HTML/PDF de una
página, sus subpáginas o el workspace, dominio propio, SEO, analítica del
sitio y por página, duplicar páginas publicadas, cajón y barra táctil en el
celular y edición sin conexión están construidos (ver
`content/feature-parity/docs.ts`). Quedan en parcial la fusión tecla por
tecla de la edición simultánea y las bases sincronizadas con Jira/Salesforce
sin probar contra las APIs reales.

## Bugs encontrados

1. **El aviso de conflicto (y el de papelera) ocupa un tercio de la pantalla en páginas cortas.**
   Pasos: abrir la misma página en dos pestañas, escribir en la primera, esperar a "Saved",
   escribir en la segunda. El aviso rosa "Someone else edited this page…" mide unos 275 px de
   alto en 1440×900 y empuja el editor hacia abajo. Causa probable: `.docs-editor-wrap` es un
   grid con `min-height: 100%` y sin `grid-template-rows`, así que la fila del `.docs-banner`
   se estira para llenar el alto libre (`styles/docs.css`, líneas 352 y 463). Con
   `align-content: start` o `grid-template-rows: auto 1fr` se resolvería.
2. **(menor) El snippet de una nota en ⌘K muestra "[ ]" crudo.** Pasos: crear una nota con dos
   to-do ("milk", "eggs"), abrir ⌘K y buscar su título. El resultado dice "milk [ ] eggs",
   mientras la lista de Notes dice "milk, eggs". Se repite en Notes; se anota acá porque ⌘K es
   compartido.

La pasada no encontró errores de consola ni excepciones en Docs.

## Fuentes

- Precios y límites por plan: https://www.notion.com/pricing
- Bloques sincronizados: https://www.notion.com/help/synced-blocks
- Embeds: https://www.notion.com/help/embed-and-connect-other-apps
- Bases de datos: https://www.notion.com/help/intro-to-databases
- Wikis y páginas verificadas: https://www.notion.com/help/wikis-and-verified-pages
- Sugerencias de edición: https://www.notion.com/help/suggested-edits
- Comentarios, menciones y recordatorios: https://www.notion.com/help/comments-mentions-and-reminders
- Automatizaciones de base de datos: https://www.notion.com/help/database-automations
- Botones: https://www.notion.com/help/buttons
- Webhooks de la API: https://developers.notion.com/reference/webhooks
- Registro de auditoría: https://www.notion.com/help/audit-log
- Analítica de páginas: https://www.notion.com/help/page-analytics
- Importar: https://www.notion.com/help/import-data-into-notion
- Exportar: https://www.notion.com/help/export-your-content
- Autofill con IA: https://www.notion.com/help/autofill
- Publicar en la web (Sites): https://www.notion.com/help/public-pages-and-web-publishing
- Notas de versión: https://www.notion.com/releases/2025-05-13 (Meeting Notes, Enterprise Search), https://www.notion.com/releases/2025-08-19 (offline, MCP), https://www.notion.com/releases/2025-09-18 (Notion 3.0 Agents), https://www.notion.com/releases/2026-02-24 (Custom Agents), https://www.notion.com/releases/2026-08-28 (agentes que sugieren ediciones), https://www.notion.com/releases/2026-10-13 (v3.8: MCP, permisos por columna, bases sincronizadas, historial de bases), https://www.notion.com/releases/2026-10-19 (agentes con computadora propia)
- Confluence: Rovo https://support.atlassian.com/rovo/docs/what-is-rovo/, comentarios en línea https://support.atlassian.com/confluence-cloud/docs/comment-on-pages-and-blog-posts/, plan Standard (permisos de espacio y página, insights) https://support.atlassian.com/confluence-cloud/docs/confluence-standard/
