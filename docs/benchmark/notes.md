# Benchmark: Notes vs Evernote (y Apple Notes / Bear para UX)

Fecha: 2026-10-22. Base: `main` en 644c85b.

Método: lista de capacidades de Evernote armada con su página de planes, centro de ayuda y notas
de versión de 2025-2026 (fuentes al final). Apple Notes y Bear entran como referencia de UX
(captura rápida, etiquetas, links entre notas). Del lado nuestro, lectura del código
(`components/notes`, `lib/notes*.ts`, `app/api/notes`) y una pasada en el navegador con
Playwright sobre un build de producción en DEMO_MODE (1440×900 claro y oscuro, 390×844 oscuro
con táctil). Como en `docs.md`, la pasada usó el build de producción de `main` (0793fba) porque
el del worktree no terminó con siete builds en paralelo, y los tiempos medidos no sirven como
medida de velocidad.

Nota sobre Evernote: en 2026 cambió los planes a Free, Starter, Advanced, Flexible y Unlimited.
La página de planes no muestra precios; los de abajo salen de un correo a clientes citado en
TidBITS y hay que tomarlos con cuidado. El centro de ayuda devolvió 403 a la lectura directa, así
que esas afirmaciones vienen de los extractos de búsqueda de esas páginas.

Escala: **tiene**, **parcial**, **falta**, **mejor** (igual que en `docs.md`).

## Resumen

| Área | Puntaje (0-10) | Comentario corto |
|---|---|---|
| Edición y modelo de datos | 6 | Mismo editor de bloques que Docs, libretas, etiquetas, fijadas. Sin pilas, sin PDF anotable, sin audio. |
| Colaboración | 6 | Compartir nota o libreta con compañeros (ver/editar) y link público de lectura. Sin tiempo real. |
| Automatización | 4 | Recordatorio por nota (in-app y mail), eventos de Flow, enviar a Track. Sin tareas con fecha, sin email-a-nota. |
| Integraciones y API | 3 | Bookmarklet de recorte de selección, Track, Flow. Sin extensión, sin API pública, sin calendario. |
| Admin y permisos | 4 | Notas privadas por persona, permisos por nota y libreta. Sin consola de admin propia de Notes. |
| Analítica | n/a | Evernote tampoco ofrece analítica de notas. No pesa. |
| Móvil y offline | 2 | Web adaptada a 390px. Sin app, sin offline, sin widgets ni captura rápida del sistema. |
| IA | 4 | "Ask your notes" responde con citas. Sin transcripción, sin búsqueda semántica, sin edición con IA. |
| Importar y exportar | 6 | Importa ENEX y Markdown (hasta 20 archivos de 4 MB). Exporta una nota a Markdown. |
| Búsqueda | 7 | Operadores tag:, notebook:, intitle:, created:, updated:, todo: y ⌘K global. Sin búsquedas guardadas ni OCR. |
| Pulido de UX | 7 | `N` crea, `/` busca, orden por fecha o título, estados vacíos claros, conflictos detectados. |

**Paridad global: 50%** (ponderado para una persona o equipo chico que usa Evernote como
segundo cerebro: edición 20%, búsqueda 15%, móvil/offline 15%, captura e integraciones 10%,
automatización 10%, colaboración 8%, import/export 8%, IA 6%, UX 6%, permisos 2%).

Dónde estamos **mejor** que Evernote:

- **Notas ilimitadas sin plan pago.** Evernote Free tiene 50 notas y 1 libreta; Starter, 1.000
  notas y 20 libretas ([planes](https://evernote.com/compare-plans)).
- **Convertir tareas de una nota en issues de Track** con link de vuelta. Evernote tiene tareas
  propias pero no un tracker de equipo.
- **Eventos de notas en Flow** (`note.created`, `note.tagged`, `note.trashed`). Evernote dejó
  esto en manos de Zapier.
- **Links entre notas con `[[` y backlinks**, como Bear. Evernote tiene links de nota pero no
  muestra backlinks.
- **El editor es el de Docs**: toggles, callouts, tablas, bases de datos simples, código.

## Capacidades

### Edición y modelo de datos

| Capacidad | Evernote | Notes | Estado |
|---|---|---|---|
| Libretas | Sí (1 en Free, 20 en Starter) | Sí, sin tope | mejor |
| Pilas (stacks) de libretas | Sí | No | falta |
| Etiquetas | Sí (20 en Free) | Sí, hasta 20 por nota; sin etiquetas anidadas como Bear | parcial |
| Fijar notas | Sí | Sí, vista "Pinned" | tiene |
| Texto enriquecido, listas, checklist, tablas, código | Sí | Sí | tiene |
| Tablas con orden, filtro y cálculos | Sí ([11.36](https://evernote.com/release-notes/11.36.3), [recap 2025](https://evernote.com/blog/2025-recap)) | Tabla simple; base de datos con 4 tipos sin filtro | parcial |
| Plantillas de nota | Sí | No en Notes (Docs sí tiene) | falta |
| Adjuntos (imagen, archivo) con arrastrar y pegar | Sí | Sí, hasta 10 MB por archivo | tiene |
| Anotar PDF e imágenes, unir y partir PDF | Sí ([release notes](https://releasebot.io/updates/evernote)) | No | falta |
| Grabar audio en la nota | Sí | No | falta |
| Escanear documentos con la cámara | Sí (móvil) | No | falta |
| Cifrar texto o bloquear nota | Sí (Mac/Windows) | No | falta |
| Modo foco | Sí (nov 2025) | No | falta |

### Colaboración

| Capacidad | Evernote | Notes | Estado |
|---|---|---|---|
| Compartir nota con permisos | Sí | Sí, compañeros con ver o editar | tiene |
| Compartir libreta | Sí | Sí, incluye notas futuras | tiene |
| Link público de lectura | Sí | Sí | tiene |
| Spaces de equipo | Sí | No (Docs cubre el wiki de equipo) | parcial |
| Pedir acceso desde un link | Sí (11.36) | No | falta |
| Edición simultánea | Sí | No: detecta el conflicto y deja elegir | parcial |

### Automatización

| Capacidad | Evernote | Notes | Estado |
|---|---|---|---|
| Recordatorio con fecha y hora | Sí | Sí, uno por nota, in-app y por mail | tiene |
| Tareas con fecha, recurrencia, asignación y vista central de tareas | Sí ([ayuda](https://help.evernote.com/hc/articles/1500003792141)) | Checklists sin fecha; "Send to Track" para tareas de equipo | parcial |
| Email a Evernote con `@libreta` y `#etiqueta` en el asunto | Sí ([ayuda](https://help.evernote.com/hc/articles/209005347)) | No | falta (en ideas.json) |
| Calendario conectado (nota desde un evento) | Sí, Google y Outlook | No (Cal no crea notas) | falta |
| Disparadores para flujos | Vía Zapier | Flow nativo | mejor |

### Integraciones y API

| Capacidad | Evernote | Notes | Estado |
|---|---|---|---|
| Web Clipper: artículo, artículo simplificado, página completa, marcador, captura | Sí ([ayuda](https://help.evernote.com/hc/articles/209125827)) | Bookmarklet que guarda título, URL y texto seleccionado | parcial (en ideas.json) |
| API pública y MCP | Sí (MCP desde 11.30, ago 2026) | No | falta |
| Slack, Google, Outlook | Sí | No | falta |
| Track (issues desde tareas) | No | Sí | mejor |

### Móvil y offline

| Capacidad | Evernote | Notes | Estado |
|---|---|---|---|
| Apps nativas iOS, Android, escritorio | Sí | No; web adaptada | parcial |
| Notas offline | Sí | No | falta (en ideas.json) |
| Widgets y captura rápida del sistema (Quick Note de Apple) | Sí | No | falta |
| Acciones en lote sobre varias notas | Sí (móvil, ago 2025) | No | falta |

### IA

| Capacidad | Evernote | Notes | Estado |
|---|---|---|---|
| Preguntar a tus notas con fuentes | AI Assistant (v11, ene 2026) | "Ask your notes" con las notas citadas | tiene |
| Búsqueda semántica | Sí | No (la pregunta usa búsqueda por palabras) | falta |
| Transcribir audio con hablantes | Sí | No | falta |
| Limpiar y editar texto con IA | AI Edit, AI Cleanup | No | falta |
| Buscar texto dentro de imágenes y PDF | Sí (OCR y captions automáticos) | No | falta |

### Importar y exportar

| Capacidad | Evernote | Notes | Estado |
|---|---|---|---|
| Importar ENEX | Sí | Sí, hasta 20 archivos de 4 MB y 500 notas por carga | tiene |
| Importar Markdown | Pegar Markdown | Archivos .md | mejor |
| Exportar nota | ENEX, HTML, PDF | Markdown | parcial |
| Exportar libreta o todo | ENEX/HTML desde escritorio | No | falta |
| Historial de versiones con restaurar | Sí | Sí | tiene |

### Búsqueda

| Capacidad | Evernote | Notes | Estado |
|---|---|---|---|
| Búsqueda de texto | Sí | Sí, con contador de resultados | tiene |
| Operadores (tag:, notebook:, intitle:, created:, updated:, todo:, `-`) | Sí ([ayuda](https://help.evernote.com/hc/articles/208313828)) | Sí, con ayuda en pantalla | tiene |
| Búsquedas guardadas (Smart Folders en Apple Notes) | Sí | No | falta |
| Notas en la búsqueda global ⌘K | n/a | Sí | tiene |
| Resaltar la coincidencia en la nota | Sí (mejorado en 11.31) | No se resalta al abrir el resultado | falta |

### Pulido de UX

| Capacidad | Evernote | Notes | Estado |
|---|---|---|---|
| Crear nota con un atajo | Sí | `N` | tiene |
| Atajo para buscar | Sí | `/` | tiene |
| Ordenar la lista | Sí | Última edición, creación, título | tiene |
| Home configurable con widgets | Sí | No | falta |
| Papelera con vaciar | Sí | Sí | tiene |
| Detección de conflictos entre pestañas | Sync | Sí, con "Keep mine" o "Load the latest" | tiene |

## Paridad de UX en los flujos principales

| Flujo | Evernote / Apple Notes | Notes (medido en el navegador) | Nota |
|---|---|---|---|
| Nota nueva | ⌘N | `N` crea la nota y pone el foco en el título; Enter pasa al cuerpo | Paridad. Apple Notes además tiene Quick Note desde cualquier app |
| Checklist | Botón o atajo | `[] ` al principio de la línea | Paridad |
| Etiquetar | Campo de etiquetas | Campo "Add tag" arriba del título; Enter crea `#home` y aparece en el sidebar con su contador | Paridad |
| Link a otra nota | Copiar link interno (Evernote), `>>` (Apple Notes) | `[[` abre la lista de notas con "Create note …"; Enter inserta el link y la otra nota muestra "Linked from" | Mejor que Evernote, igual que Bear |
| Buscar | Barra con sugerencias | `/` enfoca; "budget" encontró la nota por el cuerpo; `tag:home` y `todo:false` filtran bien; botón `?` explica los operadores | Paridad en operadores; faltan búsquedas guardadas |
| ⌘K global | n/a | Encuentra la nota por título desde cualquier app | Mejor (suite) |
| Libretas | Crear en el sidebar | "+" en Notebooks, Enter crea; contador por libreta | Paridad |
| Fijar, papelera | Sí | Ícono de pin y de papelera en la barra; la nota sale de la lista al instante | Paridad |
| Compartir | Link o personas | Popover con "Create link" (lectura pública) y Teammates (ver/editar) | Paridad |
| Recargar | n/a | Las dos notas, etiqueta y fijada siguen ahí | Paridad |
| Móvil 390 px | App nativa | Lista a pantalla completa, tocar abre la nota con "‹ Notes" para volver; sin scroll horizontal | Usable; sin offline ni captura rápida |
| Estado vacío | Ilustración | "No notes yet" con "Clip a web page"; panel derecho con `[n] new note · [/] search` | Claro |

## Top 10 brechas para un equipo chico que viene de Evernote

| # | Brecha | Por qué hace volver | Esfuerzo | En ideas.json |
|---|---|---|---|---|
| 1 | Offline y app instalable (PWA) | Quien usa Evernote escribe en el subte y en el avión. Sin offline, la nota se pierde o no se escribe. | L | Sí |
| 2 | Clipper de artículo completo y marcadores | Recortar la web es la mitad del uso de Evernote. Hoy solo se guarda la selección. | M | Sí |
| 3 | Tareas con fecha dentro de la nota y una vista de tareas | Evernote mezcla notas y tareas desde 2022. Un recordatorio por nota no alcanza. | M | No |
| 4 | Email a Notes | Reenviar recibos y confirmaciones es un hábito diario. | M | Sí |
| 5 | Buscar dentro de imágenes y PDF (OCR) | Las notas viejas importadas de ENEX están llenas de escaneos que hoy no aparecen al buscar. | M | No |
| 6 | Búsquedas guardadas | Los usuarios fuertes de Evernote viven en búsquedas guardadas con operadores. Ya tenemos los operadores. | S | No |
| 7 | Exportar una libreta o todas las notas (ENEX/Markdown en zip) | Sin salida masiva, mudarse es un riesgo. | S | No |
| 8 | Pilas de libretas o libretas anidadas | Quien importa 30 libretas de Evernote necesita agruparlas. | S | No |
| 9 | Plantillas de nota | Reunión, diario, viaje: Evernote las ofrece en la creación. | S | No |
| 10 | Seleccionar varias notas para mover, etiquetar o borrar | Ordenar lo importado nota por nota es lento. | S | No |

## Bugs encontrados

1. **(menor) El snippet de ⌘K muestra "[ ]" crudo.** Pasos: crear una nota con dos to-do
   ("milk", "eggs") y buscarla en ⌘K. El resultado dice "milk [ ] eggs"; la lista de Notes
   dice "milk, eggs".
2. **(menor) En oscuro, el selector de orden "Last edited" pierde la flecha.** Pasos: abrir
   `/en/app/notes` con el sistema en oscuro a 1440 px. En claro se ve "Last edited ⌄"; en oscuro
   solo el texto, y no se nota que es un selector.

La pasada no encontró errores de consola ni excepciones en Notes.

## Fuentes

- Planes y límites: https://evernote.com/compare-plans
- Precios 2026 (correo a clientes citado): https://talk.tidbits.com/t/evernote-2026-price-tiers-floored-me/33792
- Novedades 2025: https://evernote.com/blog/2025-recap
- Notas de versión: https://evernote.com/release-notes, https://evernote.com/release-notes/11.36.3, https://releasebot.io/updates/evernote
- Lanzamiento de v11 con AI Assistant y búsqueda semántica: https://www.businesswire.com/news/home/20260119103272/en
- Tareas: https://help.evernote.com/hc/articles/1500003792141
- Email a Evernote: https://help.evernote.com/hc/articles/209005347
- Web Clipper: https://help.evernote.com/hc/articles/209125827
- Operadores de búsqueda: https://help.evernote.com/hc/articles/208313828
- Historial de notas: https://help.evernote.com/hc/articles/208313858
- Admin de Teams: https://help.evernote.com/hc/articles/209005357
- Apple Notes (Smart Folders, Quick Note, links `>>`, import/export): https://support.apple.com/guide/notes/use-smart-folders-apd58edc7964/mac, https://support.apple.com/guide/notes/create-a-quick-note-apdf028f7034/mac, https://support.apple.com/guide/notes/add-links-apde615d29c2/mac, https://support.apple.com/guide/notes/import-export-and-print-notes-not201900c07/mac
- Bear (links y backlinks, etiquetas anidadas, export): https://bear.app/faq/how-to-link-notes-together/, https://bear.app/faq/how-to-use-tags-in-bear/#nested-tags, https://bear.app/faq/export-your-notes/
