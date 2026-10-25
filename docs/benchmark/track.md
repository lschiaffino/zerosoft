# Benchmark: Track vs Linear (y Jira / GitHub Projects)

Fecha: 2026-10-22.

Cómo se hizo:

- **Linear hoy:** pricing, docs y changelog públicos (fuentes al final). Jira y GitHub Projects solo donde suman algo que Linear no tiene (automatización con reglas, campos propios).
- **Track hoy:** lectura del código (`app/api/track/*`, `components/track/*`, `lib/track*.ts`, migraciones) y una pasada en el navegador con Playwright contra el servidor de producción compartido (`next start`, DEMO_MODE, build de `main`), en 1440×900 claro y oscuro y en 390×844. Datos creados con prefijo "Track bench" en el proyecto `TRACKBENCH`.
- **Velocidad:** la máquina tenía más de 15 builds en paralelo, así que no se reportan tiempos. Solo se anota si la interfaz responde de forma optimista o espera al servidor.

## Resumen

| Área | Nota (0-10) |
|---|---|
| Modelo de datos y edición de issues | 7 |
| Vistas, filtros y navegación | 7 |
| Colaboración y notificaciones | 6 |
| Planificación (cycles, milestones, roadmap, triage) | 5 |
| Automatización | 6 |
| Integraciones y API | 2 |
| Admin y permisos | 3 |
| Analítica y reportes | 2 |
| Mobile y offline | 3 |
| IA | 1 |
| Importar y exportar | 0 |
| Rendimiento y confiabilidad | 5 |
| Pulido de UX y teclado | 6 |

**Paridad general: 44 %** (promedio ponderado; pesan doble núcleo de issues, vistas, colaboración, planificación, integraciones, import y teclado, que es lo que un equipo chico usa todos los días).

Para el trabajo diario de un equipo de 3 a 10 personas (crear, priorizar, mover y cerrar issues dentro de un cycle) Track está cerca: el loop principal se hace con la misma cantidad de clics que en Linear y el `C` + `!high @tomorrow` es igual de rápido. Lo que falta está alrededor del loop: entrar (no hay importador), ver cambios de otros sin recargar, conectar Slack y la API, y mirar números de cycles y proyectos.

## Capacidades por área

Leyenda: **tiene** / **parcial** / **falta** / **mejor** (mejor que el incumbente).

### Modelo de datos y edición

| Capacidad (Linear) | Track | Nota |
|---|---|---|
| Issues con estado, prioridad, asignado, labels, estimación, fechas | tiene | Prioridad sin "No priority" (urgent/high/medium/low). Fecha de inicio solo se edita arrastrando en Gantt, no está en el panel de propiedades |
| Sub-issues, relaciones blocks / related / duplicate | tiene | |
| Descripción y comentarios en Markdown | parcial | Editor con pestañas Write/Preview y toolbar (títulos, listas, checkboxes renderizan bien). Linear es WYSIWYG con pegado de imágenes, callouts y menciones a issues |
| Adjuntos | tiene | Hasta 10 MB |
| Templates de issue | tiene | Por proyecto |
| Issues recurrentes | tiene | Diario, semanal, mensual, anual |
| Workflow de estados editable | tiene | Por proyecto, con categorías |
| Projects de Linear (entidad con lead, fecha objetivo, estado, health, updates) | tiene | Se llaman **planes** (Track › Planes): lead, miembros, varios equipos, seis estados, fechas, descripción, milestones propios y progreso por issues o estimación. En Track "proyecto" sigue siendo el *team* de Linear (2026-10-25) |
| Initiatives / sub-initiatives | tiene | Responsable, estado, fecha, planes y sub-iniciativas con progreso sumado; la salud sale de sus planes (sin updates propios) (2026-10-25) |
| Campos propios (GitHub Projects: texto, número, select, iteración; Jira) | falta | |
| Borrar, duplicar o copiar link de un issue desde su página | falta | El menú "…" solo trae "Copy branch name". Borrar existe solo desde la barra de selección masiva de la lista |
| Customer requests (issue ↔ cliente con revenue) | tiene | (T3, 2026-10-25) Desde el issue, la ficha del CRM o `POST /api/v1/track/requests`; cita, importante, Track › Clientes y orden por clientes o ingresos de deals ganados. Chat y Groups sin botón propio (API o Flow) |

### Vistas, filtros y navegación

| Capacidad | Track | Nota |
|---|---|---|
| Lista, board, calendario, timeline | tiene | List, Board (drag entre columnas), Calendar, Gantt (drag de barras). Linear no tiene calendario: **mejor** en eso |
| Agrupar y ordenar | tiene | Agrupa por status, assignee, priority, cycle, label, project |
| Filtros | parcial | Status, prioridad, asignado, cycle, labels, vencimiento y búsqueda. Sin OR / negación, sin filtro por creador o fecha de creación |
| Vistas guardadas | parcial | Personales, una por defecto. Linear: vistas de equipo y de workspace, con dueño, favoritos y alertas a Slack |
| Vista de issues de todos los proyectos | tiene | Track › Issues y My tasks |
| Cmd+K encuentra issues | tiene | Busca por título e identificador (`TRACKBENCH-3`) desde cualquier app |
| Roadmap de proyectos / initiatives | tiene | Track › Roadmap: timeline por semanas, meses o trimestres, barras arrastrables, milestones, hoy, agrupar por iniciativa (2026-10-25) |

### Colaboración y notificaciones

| Capacidad | Track | Nota |
|---|---|---|
| Comentarios con @menciones, editar y borrar | tiene | |
| Suscribirse a un issue | tiene | |
| Inbox con filtros, snooze y recordatorios | tiene | Linear agregó una pestaña Priority en septiembre 2026 |
| Mails inmediatos o digest diario | tiene | |
| Actualización en tiempo real | falta | Probado: con la lista abierta, otro usuario renombra un issue y a los 15 s (y tras un evento de foco) la lista sigue mostrando el título viejo |
| Reacciones, hilos en comentarios | falta | |
| Project updates con health y recordatorios | tiene | Salud, texto, comentarios, historial, recordatorio al lead por cron y aviso a seguidores en el Inbox. Sin Slack (2026-10-25) |
| Notificaciones a Slack / Teams | falta | Solo armando un Flow con el nodo de Slack |

### Planificación

| Capacidad | Track | Nota |
|---|---|---|
| Cycles con cadencia automática y rollover | tiene | |
| Milestones con fecha y progreso | tiene | |
| Velocidad, burn-up, scope creep del cycle | tiene | Track › Cycles: burn-up, agregado y sacado, rollover, velocidad de 3 cycles y capacidad; los cycles vencidos se cierran solos (2026-10-25) |
| Triage (aceptar, rechazar, duplicado) | tiene | Entra lo creado por API, Chat, Flow, GitHub y Agents. (T3) Atajos 1/2/3/H como Linear, snooze y comentario al resolver |
| Reglas de triage, responsable de triage rotativo | tiene | (T3) Reglas en orden con condiciones (texto, origen, prioridad, label, cliente) y acciones (prioridad, asignado, labels, cycle, aceptar); rotación diaria o semanal que avisa o asigna. Sin mover de equipo ni PagerDuty |
| SLAs por prioridad | tiene | (T3) Por proyecto, urgente 24 h y alta 1 semana por defecto, contador en issue, listas y triage, avisos de en riesgo y vencido (cron con claim). Horas corridas |

### Automatización

| Capacidad | Track | Nota |
|---|---|---|
| Disparadores sobre issues | tiene | Flow recibe `issue.created`, `issue.updated`, `issue.status_changed` y puede crear o actualizar issues. Comparable a Jira Automation y más abierto que Linear |
| Automatización por PR (GitHub) | tiene | PR abierto → in progress, merge → done |
| Auto-close y auto-archive de issues viejos | tiene | Ajustes › Automatizaciones, por proyecto, con archivo para restaurar (2026-10-25) |
| Agentes que trabajan issues (Linear Agent, Loops, coding sessions) | tiene | (T3) Delegar a un agente de Agents o externo; sesión con thought/action/elicitation/response en el issue; webhook firmado y `/api/v1/track/agent-sessions` |

### Integraciones y API

| Capacidad | Track | Nota |
|---|---|---|
| API pública y webhooks de issues | falta | `/api/v1` no tiene recursos de Track y `issue.*` no está en `WEBHOOK_EVENTS`. Ya está en el backlog |
| GitHub | parcial | Webhook por workspace con secret, sin GitHub App instalable, sin GitLab |
| Slack (crear issue desde un mensaje, hilos sincronizados, notificaciones por canal) | falta | |
| Intercom, Zendesk, Sentry, Figma, MCP | falta | Chat de zerosoft ya crea issues, que cubre parte del caso Intercom |

### Admin y permisos

| Capacidad | Track | Nota |
|---|---|---|
| Miembros del workspace | tiene | |
| Proyectos privados, invitados, roles por proyecto | falta | Todo miembro ve y edita todo |
| SSO / SAML / SCIM, audit log, IP restrictions | falta | (Enterprise en Linear) |

### Analítica

| Capacidad | Track | Nota |
|---|---|---|
| Overview por proyecto | tiene | Cycle actual, vencidos, triage, abiertos |
| Insights (cycle time, lead time, burn-up, cortes y segmentos, CSV) | tiene | Track › Insights. Tiempos como barras de mediana (sin scatter) y sin triage time (2026-10-25) |
| Dashboards | tiene | Widgets de insights (gráfico, tabla, número), filtros del dashboard, personal o del workspace (2026-10-25) |

### Mobile y offline

| Capacidad | Track | Nota |
|---|---|---|
| Web a 390 px | tiene | Lista, issue y board sin scroll horizontal de página; el board scrollea por columnas |
| Apps nativas iOS / Android, push | falta | |
| Offline | falta | |

### IA

| Capacidad | Track | Nota |
|---|---|---|
| Sugerencias de triage (labels, asignado, duplicados) | tiene | (T3) Asignado, labels, prioridad y duplicados con su porqué; aceptar o descartar; modo sugerir, aplicar solo o apagado por proyecto |
| Resumen de hilos, issue desde texto libre | tiene | (T3) Resumen del issue y su discusión, borrador de update del proyecto, issue desde texto pegado |
| MCP para agentes externos | falta | |

### Importar y exportar

| Capacidad | Track | Nota |
|---|---|---|
| Importadores Jira, GitHub Issues, Asana, Shortcut, Linear | falta | |
| CSV de entrada o salida | falta | |

### Pulido de UX y teclado

| Capacidad | Track | Nota |
|---|---|---|
| `C` nuevo issue con contexto, "Create more", `!high @tomorrow` en el título | tiene | |
| `J`/`K`, `X`, `Enter`, `Esc`, `/` para buscar | tiene | |
| Atajos de propiedad (`S`, `P`, `A`, `L`), `G` + tecla para navegar, acciones en Cmd+K | falta | Probado: `P` con una fila activa no abre nada |
| Undo | falta | |
| Estados vacíos, carga y error | tiene | |
| Claro y oscuro | tiene | |

## Paridad de UX en los flujos principales

| Flujo | Linear | Track | Comentario |
|---|---|---|---|
| Crear un issue | `C`, título, `Cmd+Enter` | `C`, título, `Cmd+Enter` | Igual. El modal precarga proyecto y estado. Aparece en la lista sin recargar, pero al final aunque el orden sea "Newest" (ver bugs) |
| Cambiar estado o prioridad de un issue | Hover + `S` / `P` | Clic en la celda inline o en el panel | Un clic más y sin teclado |
| Mover varios issues | `X` + `Shift` + atajo | `X` + barra inferior con selects | Parecido |
| Encontrar un issue | Cmd+K | Cmd+K, por título o ID | Igual |
| Planear un cycle | Arrastrar al cycle, ver capacidad | Elegir cycle en el panel o en masa | Sin capacidad ni velocidad para decidir cuánto entra |
| Ver qué cambió hoy | Inbox, en vivo | Inbox, al recargar | |
| Arrancar con datos de otra herramienta | Importador guiado | A mano | Es el primer muro para cambiarse |

## Top 10 gaps por impacto (equipo chico que viene de Linear)

| # | Gap | Por qué se vuelven a Linear | Esfuerzo | En backlog |
|---|---|---|---|---|
| 1 | Importador de Linear, Jira, GitHub Issues y CSV, más export CSV | Sin traer el histórico nadie se muda | M | nuevo |
| 2 | Tiempo real en listas, board e issue | Dos personas en el mismo board ven estados distintos y se pisan | M | nuevo |
| 3 | API pública y webhooks de issues | CI, scripts y otras herramientas no pueden escribir en Track | M | ya existe |
| 4 | Atajos de propiedad y acciones en Cmd+K | Quien usa Linear trabaja con teclado; acá cada cambio es un clic | M | ya existe |
| 5 | Slack: crear issue desde un mensaje, notificar a un canal, unfurl | La mitad de los issues nacen en Slack | M | nuevo |
| 6 | Projects con lead, fecha objetivo, health y updates, y roadmap entre proyectos | Los leads reportan estado de proyectos desde ahí | L | nuevo |
| 7 | Insights de cycles: velocidad, burn-up, cycle y lead time | Sin números no se planifica el próximo cycle | M | nuevo |
| 8 | Vistas compartidas con el equipo y alertas de vista | Cada uno arma sus filtros de cero | S | ya existe |
| 9 | Proyectos privados e invitados | Equipos con contratistas o clientes no pueden usarlo | M | nuevo |
| 10 | IA en triage: labels, asignado y duplicados sugeridos | Linear lo da en Business y reduce el triage a un clic | M | nuevo |

Otros gaps nuevos con menos impacto (también en `research/benchmark-ideas-track.json`): customer requests enlazadas al CRM, SLAs por prioridad, auto-close y auto-archive.

## Bugs encontrados

1. **El issue recién creado aparece al final con orden "Newest".**
   Repro: abrir un proyecto con issues en vista List, orden "Newest". Apretar `C`, escribir un título, `Cmd+Enter`. El issue nuevo aparece como última fila. Al recargar pasa al primer lugar.
2. **El botón de la vista activa queda en blanco al pasar el mouse.**
   Repro: en un proyecto, clic en "Board" (o "Gantt") y dejar el mouse encima. El botón activo tiene texto blanco (`rgb(255,255,255)`) y con hover el fondo pasa a `rgb(245,245,245)`, así que la etiqueta desaparece (visto en modo claro).
3. **No se puede borrar un issue desde su página.**
   Repro: abrir cualquier issue, menú "…": solo ofrece "Copy branch name". Para borrar hay que volver a la lista, seleccionarlo con `X` y usar "Delete" en la barra masiva. Tampoco hay "Copy link". Rompe la lista común de CLAUDE.md (se abre, se renombra y se borra).
4. **La fecha de inicio no se puede editar en el panel del issue.**
   Repro: crear un issue con `startDate` (API o drag en Gantt). En la página del issue, el panel de propiedades muestra Due pero no Start; solo se cambia arrastrando la barra en Gantt.
5. **Estado por defecto distinto según por dónde se crea.**
   Repro: crear un issue con `C` (queda en Todo) y otro con `POST /api/track/projects/:id/issues` sin `statusId` (queda en Backlog). Menor, pero confunde cuando entran issues por Flow o API sin triage.

## Fuentes

- Linear, pricing y lista de funciones por plan: https://linear.app/pricing
- Linear, changelog 2026: https://linear.app/changelog
- Linear, docs (índice): https://linear.app/docs
- Linear, custom views: https://linear.app/docs/custom-views
- Linear, project e initiative updates: https://linear.app/docs/initiative-and-project-updates
- Linear, importadores: https://linear.app/docs/import-issues
- Linear, Insights: https://linear.app/docs/insights
- Linear, Slack: https://linear.app/docs/slack
- Linear, customer requests: https://linear.app/docs/customer-requests
- GitHub Projects: https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects
- Jira Automation, triggers: https://support.atlassian.com/cloud-automation/docs/jira-automation-triggers/
