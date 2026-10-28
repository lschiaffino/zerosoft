# Benchmark: Flow vs Zapier y n8n

Fecha: 2026-10-22. Incumbentes: Zapier (referencia para equipos chicos no técnicos) y n8n
(referencia para equipos técnicos y self-host). Método: capacidades públicas de cada uno
(docs, precios, changelog 2025-2026, ver Fuentes), código de Flow en `lib/flow*.ts` y
`components/flow/`, y una pasada en el navegador sobre un build de producción local
(`next start` con DEMO_MODE sobre `main`, Playwright). Los tiempos no se miden: la máquina de prueba estaba saturada.

**Paridad global: 50 %** (promedio ponderado de las áreas, ver tabla de puntajes).

Leyenda: **tiene** · **parcial** · **falta** · **mejor** (lo hacemos mejor que el incumbente).

## Resumen

Flow ya cubre el núcleo de un n8n chico: canvas con nodos, un trigger por flow (evento interno,
webhook, horario, Stripe, manual), If / Switch / Filter / Loop / Merge, código JS, tablas de datos,
subflows, esperas con reanudación, aprobaciones por email o Slack, manejo de errores por nodo,
flow de errores, auto-replay, versiones con diff y restauración, y prueba de un paso con datos
fijados. Lo que lo separa de Zapier es el catálogo: 8 integraciones externas contra 9.000+ apps,
credenciales pegadas a mano en lugar de OAuth, y nada de IA para armar flows. Frente a n8n faltan
export/import en JSON, borrador vs publicado, MCP y una API pública de flows.

Donde ganamos: los ~50 eventos de las otras apps de zerosoft (CRM, Cal, Chat, Track, Robots,
Notes, Board, Agents) llegan como triggers sin conectar nada, y los nodos `app.*` escriben en esas
apps sin credenciales. En Zapier eso son Zaps con dos apps de terceros y tareas cobradas por paso.

## Capacidades por área

### 1. Edición y modelo de datos (7/10)

| Capacidad | Zapier | n8n | Flow | Nota |
|---|---|---|---|---|
| Canvas visual con nodos y conexiones | editor lineal + vista visual | sí | **tiene** | React Flow, paleta con búsqueda y arrastre |
| Triggers de apps externas (polling / instantáneos) | 9.000+ apps | 2.400+ | **parcial** | webhook genérico y Stripe; no hay polling de apps (Sheets, Gmail, RSS) |
| Triggers internos de la suite | n/a | n/a | **mejor** | 49 eventos de CRM, Cal, Chat, Track, Robots, Notes, Board, Agents, tareas |
| If / Switch / Filter | Paths, Filter | IF, Switch, Filter | **tiene** | 13 operadores, all/any |
| Loop sobre items | Looping | Loop Over Items | **parcial** | máximo 50 items por loop; sin Delay ni Approval adentro |
| Merge / agregados | Digest, Formatter | Merge, Aggregate | **tiene** | merge y aggregate (count, sum, avg, unique, join…) |
| Formatter de fechas y texto | Formatter | expresiones | **tiene** | filtros `date`, `add_time`, `tz`, `replace`, `split`, `json` en las plantillas |
| Código | JS / Python | JS / Python | **parcial** | solo JS (`data.code`, 10 s) |
| Tablas de datos | Zapier Tables (AI fields) | Data tables | **tiene** | find / insert / upsert / delete, UI de filas |
| Subflows | Sub-Zap | Execute Workflow | **tiene** | `logic.run_flow` con inputs |
| Manejo de errores por paso | error paths | retry / continue on fail | **tiene** | stop / continue / rama de error + reintentos |
| Flow de errores global | n/a | Error Trigger | **tiene** | "Flow de errores" en ajustes |
| Versiones y rollback | versiones por publicación | historia, diff, nombre | **tiene** | diff de grafo y restaurar |
| Borrador vs publicado | sí | sí (2.0) | **falta** | guardar cambia lo que corre en producción |
| Variables globales | sí (Pro) | sí (Pro) | **falta** | se suplen con una tabla de datos |

### 2. Colaboración (3/10)

| Capacidad | Zapier | n8n | Flow | Nota |
|---|---|---|---|---|
| Flows compartidos en el workspace | Team | proyectos | **tiene** | todos los flows son del workspace |
| Carpetas / proyectos | sí | proyectos | **falta** | lista plana |
| Roles por flow o proyecto | Team | admin / editor / viewer | **parcial** | solo admins editan; el resto ve |
| Bloqueo o aviso de edición concurrente | n/d | lock de un editor | **falta** | el último guardado gana |
| Notas o comentarios en el canvas | Canvas | sticky notes | **falta** | campo descripción por flow, nada en el canvas |
| Dueño del flow y quién lo cambió | historial de assets | sí | **parcial** | versiones sin autor visible |

### 3. Automatización y ejecución (8/10)

| Capacidad | Zapier | n8n | Flow | Nota |
|---|---|---|---|---|
| Horarios (intervalo, diario, cron con zona) | Schedule | Schedule Trigger | **tiene** | scheduler cada minuto, vista previa de cron |
| Webhooks entrantes con respuesta custom | Catch Hook | Webhook + Respond | **tiene** | GET/POST, auth por header o basic, nodo "Responder" |
| Delay / esperar hasta / reanudar por URL | Delay | Wait | **tiene** | duración, fecha, `resumeUrl` con timeout |
| Aprobación humana | Human in the Loop | Send and Wait | **tiene** | email + Slack, timeout con acción |
| Reintentos por paso | autoreplay | retry on fail | **tiene** | HTTP, Slack, Sheets, Robots |
| Replay de corridas fallidas | manual + auto | re-run | **tiene** | replay, rerun y auto-replay |
| Formularios / interfaces que disparan flows | Zapier Forms | Form Trigger | **falta** | solo el `form.submitted` de los formularios del CRM |
| Protección ante avalanchas (flood) | sí | colas | **falta** | no hay límite de corridas por flow |

### 4. Integraciones y API (3/10)

| Capacidad | Zapier | n8n | Flow | Nota |
|---|---|---|---|---|
| Catálogo de apps | 9.000+ | 2.400+ | **falta** | 8 externas: Slack, Sheets (append / read), Gmail, Stripe, Notion, Discord, Telegram, HTTP |
| Conexión OAuth en un clic | sí | sí (Cloud) | **falta** | credenciales pegadas (token, service account); idea en backlog |
| Request HTTP genérico | Webhooks / API Request | HTTP Request + cURL | **parcial** | métodos, headers, credencial; sin importar cURL ni paginar |
| Escribir en las otras apps de la suite | n/a | n/a | **mejor** | CRM (contacto, update, tarea, secuencia), Track, Link, Chat, Docs, Robots, Agents |
| Servidor MCP / flows como herramientas | Zapier MCP | MCP Server Trigger | **falta** | |
| API pública de flows y corridas | Workflow API | REST API | **falta** | `/api/v1` no expone flows |

### 5. Admin y permisos (3/10)

| Capacidad | Zapier | n8n | Flow | Nota |
|---|---|---|---|---|
| Roles | owner / admin / member | instancia + proyecto | **parcial** | roles del workspace; editar requiere admin |
| SSO / SAML | Team | Business | **falta** | depende de la plataforma, no de Flow |
| Audit log | 6-12 meses | Enterprise | **falta** | |
| Entornos (dev / prod) | n/a | Git + entornos | **falta** | |
| Restringir apps o acciones | Enterprise | n/d | **falta** | |
| Retención de corridas configurable | por plan | por plan | **tiene** | 7 a 365 días por workspace |

### 6. Analítica y reportes (4/10)

| Capacidad | Zapier | n8n | Flow | Nota |
|---|---|---|---|---|
| Historial de corridas con detalle por paso | Zap History | Executions | **tiene** | entrada y salida por paso |
| Buscar corridas por dato | n/d | Pro | **falta** | |
| Historial global de todos los flows | sí | sí | **falta** | solo por flow |
| Dashboard de uso / fallas / tiempo ahorrado | task usage | Insights | **falta** | |
| Alertas de falla | email | error workflow | **tiene** | email al dueño + resumen diario |
| Exportar historial | CSV / JSON | n/d | **falta** | |

### 7. Móvil y offline (6/10)

| Capacidad | Zapier | n8n | Flow | Nota |
|---|---|---|---|---|
| Ver y activar flows en el teléfono | web | web | **tiene** | lista y editor sin scroll horizontal a 390 px, claro y oscuro |
| Editar en el teléfono | limitado | no | **parcial** | botón "Add step" y canvas con zoom; la configuración del nodo queda debajo del canvas |

### 8. IA (3/10)

| Capacidad | Zapier | n8n | Flow | Nota |
|---|---|---|---|---|
| Paso de texto con IA | AI by Zapier | nodos LLM | **tiene** | `ai.text` vía AI gateway |
| Agentes dentro del flow | Agents | AI Agent node | **tiene** | `ai.agent` usa los agentes de Agents |
| Armar flows desde una descripción | Copilot | AI Workflow Builder | **falta** | |
| Extraer / clasificar con salida estructurada | Formatter AI | Text Classifier, Info Extractor | **falta** | idea en backlog |
| Diagnóstico de errores con IA | AI troubleshooting | Assistant | **falta** | |

### 9. Importar, exportar y plantillas (3/10)

| Capacidad | Zapier | n8n | Flow | Nota |
|---|---|---|---|---|
| Plantillas | miles | 8.000+ | **parcial** | 16 plantillas propias de la suite |
| Exportar / importar flow en JSON | Team+ | todos los planes | **falta** | |
| Copiar y pegar nodos entre flows | n/d | sí | **falta** | |
| Duplicar flow | sí | sí | **falta** | la lista no tiene menú de acciones ni API de duplicado |

### 10. Rendimiento y confiabilidad (6/10)

| Capacidad | Zapier | n8n | Flow | Nota |
|---|---|---|---|---|
| Latencia del scheduler | 1-15 min de polling | inmediato | **tiene** | cron por minuto, webhooks al instante |
| Tamaño de flow | sin límite publicado | sin límite | **parcial** | 100 nodos, 300 aristas, 200 KB |
| Colas y concurrencia | por plan | queue mode | **parcial** | worker con reclamo por fila; sin cola visible |
| Timeout de código | 1 s - 2 min | 5-40 min | **parcial** | 10 s |

### 11. Pulido de UX (7/10)

| Capacidad | Zapier | n8n | Flow | Nota |
|---|---|---|---|---|
| Probar un paso con datos de ejemplo | Test step | ejecutar nodo + pin | **tiene** | StepTest con datos fijados |
| Selector de variables | sí | drag de campos | **tiene** | con ejemplos por evento sin corridas previas |
| Autoguardado | sí | sí (2.4) | **falta** | guardado manual (Cmd+S) con aviso al salir |
| Cmd+K dentro del editor | n/d | sí (2.44) | **falta** | Cmd+K global encuentra flows |
| Atajos de teclado en el canvas | n/d | muchos | **parcial** | Supr borra, Cmd+S guarda |

## Puntajes

| Área | Peso | Puntaje |
|---|---|---|
| Edición y modelo de datos | 15 % | 7 |
| Colaboración | 8 % | 3 |
| Automatización y ejecución | 15 % | 8 |
| Integraciones y API | 15 % | 3 |
| Admin y permisos | 6 % | 3 |
| Analítica y reportes | 8 % | 4 |
| Móvil y offline | 3 % | 6 |
| IA | 10 % | 3 |
| Importar, exportar y plantillas | 6 % | 3 |
| Rendimiento y confiabilidad | 6 % | 6 |
| Pulido de UX | 8 % | 7 |
| **Paridad global** | | **50 %** |

## Paridad de UX en los flujos principales

Probado en el navegador (`/en/app/flow`, flujos creados con prefijo "Flow bench"):

| Flujo | Zapier / n8n | Flow | Nota |
|---|---|---|---|
| Primer flow desde plantilla | 2-3 clics | 1 clic ("Use template") abre el editor con los nodos | **paridad** |
| Agregar un paso | "+" entre pasos (Zapier), arrastrar (n8n) | clic en la paleta lo agrega conectado al último nodo; buscar con texto | **paridad** |
| Probar el flow | Test step / Execute | "Test run" con JSON de muestra; cada nodo muestra "Done" y hay link "View steps" | **paridad** |
| Guardar | autoguardado | botón Save o Cmd+S, estado "Saved" | más pasos que n8n 2.4 |
| Versiones | lista de versiones | v1, v2 con resumen del cambio ("Added: HTTP request · One new connection") y Restore | **mejor** que Zapier por el resumen legible |
| Encontrar un flow | búsqueda en la lista | Cmd+K global lo encuentra; la lista no tiene buscador ni filtros | parcial |
| Renombrar / borrar | menú en la lista | solo dentro del editor (título y "Delete flow" en ajustes) | más clics |
| Estado vacío | ejemplos y plantillas | tabla vacía + 16 plantillas en la misma página | **paridad** |
| 390 px y modo oscuro | n/d | sin scroll horizontal; el editor apila canvas y ajustes | **mejor** que n8n (no usable en teléfono) |
| Teclado | n/d | pestañas con flechas, Esc cierra el modal de prueba, Cmd+S | parcial (sin atajos de canvas) |

## Top 10 gaps (impacto para un equipo chico que viene de Zapier o n8n)

| # | Gap | Por qué se vuelven | Esfuerzo |
|---|---|---|---|
| 1 | Catálogo de apps chico y sin OAuth | el primer Zap que quieren migrar usa una app que no está, o piden un token de servicio que no saben sacar | L |
| 2 | Google Sheets completo (lookup, update, upsert, trigger de fila nueva) | es la app número uno en Zapier; hoy solo append y read | M |
| 3 | Armar flows describiéndolos (IA) | Zapier Copilot y el builder de n8n bajaron el tiempo al primer flow a minutos | M |
| 4 | Borrador vs publicado | editar un flow en producción rompe corridas a mitad de cambio | M |
| 5 | Export / import JSON y copiar nodos | n8n vive de compartir JSON; sin esto no se migra ni se versiona en git | S |
| 6 | Triggers por polling (RSS, IMAP, nuevas filas, HTTP que cambia) | muchas apps no tienen webhooks | M |
| 7 | Historial global de corridas con búsqueda y dashboard de uso | "¿qué falló anoche?" sin abrir flow por flow | M |
| 8 | Formularios hospedados que disparan flows | Zapier Forms y el Form Trigger de n8n cubren encuestas y pedidos internos | M |
| 9 | Carpetas y notas en el canvas | con 30+ flows la lista plana no escala | S |
| 10 | MCP y API pública de flows | equipos que usan Claude o Cursor quieren llamar flows como herramientas | M |

## Bugs encontrados

Ninguno bloqueante en Flow. Dos detalles de UX que no llegan a bug:

1. La lista de flows no tiene menú por fila (renombrar, duplicar, borrar): hay que entrar al
   editor. Repro: `/en/app/flow` con un flow creado, no hay "⋯" en la fila.
2. "Delete flow" usa `window.confirm` nativo en lugar del diálogo de la app (QuickModal) que usan
   las otras apps. Repro: abrir un flow, "Delete flow" en el panel de ajustes.

## Fuentes

- Zapier precios y límites por plan: https://zapier.com/pricing
- Zapier gobierno, catálogo 9.000+ apps, restricciones: https://zapier.com/govern
- Zapier errores y rutas de error: https://help.zapier.com/hc/en-us/articles/8496037690637-How-to-troubleshoot-errors-in-Zap-workflows
- Zapier versiones: https://help.zapier.com/hc/en-us/articles/9693520498445-Create-Zap-versions
- Zapier Human in the Loop: https://help.zapier.com/hc/en-us/articles/38731463206029-Request-approval-to-keep-your-workflow-running-with-Human-in-the-Loop
- Zapier replay: https://zapier.com/blog/replay-full-zap-runs/
- Zapier MCP: https://zapier.com/mcp y https://docs.zapier.com/mcp/overview/how-servers-work
- Zapier export de historial: https://help.zapier.com/hc/en-us/articles/8496294549005-Export-your-Zap-history
- Zapier import/export de Zaps: https://help.zapier.com/hc/en-us/articles/8496308481933-Import-and-export-Zaps-in-your-Team-or-Enterprise-account
- Zapier flood protection: https://help.zapier.com/hc/en-us/articles/32466537676685-Adjust-flood-protection-limits-in-Zap-workflows
- Zapier Forms / Interfaces: https://help.zapier.com/hc/en-us/articles/15927500577037-Use-forms-in-Zapier-Interfaces
- n8n precios: https://n8n.io/pricing/
- n8n integraciones (2.405): https://n8n.io/integrations/
- n8n release notes 2.1 a 2.45 (data tables, autosave, diff, review, MCP, Cmd+K): https://docs.n8n.io/release-notes/
- n8n publicar vs guardar: https://docs.n8n.io/workflows/publish/
- n8n manejo de errores: https://docs.n8n.io/build/flow-logic/handle-errors-gracefully.md
- n8n Wait: https://docs.n8n.io/build/flow-logic/wait.md
- n8n compartir y lock de edición: https://docs.n8n.io/build/manage-workflows/share-with-others
- n8n MCP: https://docs.n8n.io/build/ways-of-building-workflows/connect-to-n8n-mcp-server.md
- n8n autosave: https://blog.n8n.io/announcing-autosave/
- n8n plantillas: https://n8n.io/workflows/

## Actualización 2026-10-27 (tanda de paridad)

Lo que cambió desde la revisión del 22/10 (las tablas de arriba quedan como estaban ese día; el
estado vigente por fila está en `content/feature-parity/flow.ts`):

| Capacidad | Antes | Ahora | Nota |
|---|---|---|---|
| Borrador vs publicado | falta | **tiene** | borrador por persona con autoguardado; publicar crea versión y pasa el flow a quien publica; "Probar" corre el borrador propio con el acceso propio |
| Autoguardado | falta | **tiene** | un segundo después del último cambio, como borrador |
| Dueño y quién lo cambió | parcial | **tiene** | cada versión muestra quién la publicó |
| Variables globales | falta | **tiene** | `{{vars.x}}` por persona (un flow lee las de quien lo publicó), a propósito: compartidas permitirían desviar el flow de otro |
| Carpetas | falta | **tiene** | con conteo, mover, renombrar, borrar y Cmd+K |
| Notas en el canvas | falta | **tiene** | cuatro colores, no se conectan |
| Triggers por polling | falta | **tiene** | RSS/Atom, URL JSON y filas nuevas de Sheets, cada 5 a 1.440 min, con línea de base |
| Formularios hospedados | parcial | **tiene** | página propia, validación, límite por IP, tiempo mínimo, trampa y Turnstile opcional, cupo propio |
| Protección ante avalanchas | parcial | **tiene** | límite por flow en 10 min móviles, retenidas para revisar |
| Google Sheets | parcial | **tiene** | buscar y actualizar filas, trigger de fila nueva |
| Request HTTP | parcial | **tiene** | import de cURL y paginación del mismo origen |
| Historial global, búsqueda, tablero, export | falta | **tiene** | `/app/flow/runs`; la búsqueda por dato solo en lo capturado por quien busca |
| IA: armar, extraer, diagnosticar | falta | **tiene** | por `lib/ai.ts`; el diagnóstico tapa valores con forma de secreto |
| Export/import JSON, copiar y pegar nodos | falta | **tiene** | referencias de otro workspace se vacían al importar |
| Colas y concurrencia | parcial | **tiene** | tope por flow y reparto por turnos entre flows |
| Buscar en la lista | parcial | **tiene** | buscador y filtros |

Siguen faltando: catálogo grande y OAuth en un clic, servidor MCP y API pública de flows, SSO,
audit log, restricciones de apps y roles por flow.

Puntajes estimados después de la tanda (mismo criterio que la tabla de arriba): Edición 9,
Colaboración 5, Automatización 10, Integraciones 4, Admin 3, Analítica 9, Móvil 6, IA 9,
Importar y plantillas 7, Rendimiento 8, UX 9.
