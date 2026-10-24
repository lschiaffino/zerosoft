# Benchmark: CRM vs HubSpot Sales Hub (Starter y Professional)

Fecha: 2026-10-22. Referencia principal: HubSpot Sales Hub Starter (USD 20 por asiento al mes, 7 con promo anual) y Professional (USD 100 por asiento al mes, más USD 1.500 de onboarding). Para experiencia de uso miramos también Pipedrive y Attio.

## Cómo se verificó

- **Competidor:** páginas públicas de precios y producto de HubSpot, su base de conocimiento y guías de terceros de 2026 (ver Fuentes). Donde la página de precios no deja claro el plan, lo marcamos como "no claro".
- **Nuestra app:** código en `app/[locale]/app/crm`, `app/api/crm`, `app/api/v1/crm`, `lib/crm-*.ts` y `components/crm`, más una pasada en navegador con Playwright (1440×900 y 390×844, claro y oscuro) contra el servidor de producción compartido (`next start`, DEMO_MODE, construido desde `main`). El build propio en el worktree no terminó por la carga de la máquina (17 builds a la vez), así que no reportamos tiempos de carga.
- Flujos recorridos: alta rápida de contacto con `C`, búsqueda con ⌘K, nota en el timeline, alta rápida de deal, arrastre en el board, edición en celda, filtros sin resultados, reportes, dashboards, las 17 pantallas del CRM en escritorio y en mobile. Ninguna pantalla tuvo scroll horizontal de página ni errores de consola.

## Capacidades por área

Leyenda: **tiene**, **parcial**, **falta**, **mejor** (le ganamos al incumbente).

### Modelo de datos y registros

| Capacidad | HubSpot | Nosotros | Nota |
|---|---|---|---|
| Contactos, empresas, deals | Starter | tiene | |
| Asociaciones con etiquetas y primaria | Starter (etiquetas en Pro) | tiene | etiquetas y primaria incluidas sin plan pago |
| Jerarquía de empresas con roll-up | Pro | tiene | |
| Campos propios (texto, número, select, multi-select, fecha, URL, teléfono, moneda, usuario) | Starter | tiene | |
| Objetos propios (custom objects) | Enterprise | tiene | propiedades propias, tabla con filtros, ficha con timeline, asociaciones con contactos/empresas/deals, import CSV, ⌘K, sidebar y API v1; workflows y reportes todavía no |
| Objeto Lead separado del contacto | Starter/Pro (Prospecting) | tiene | pipeline de leads editable, tabla y tablero, conversión a deal; lifecycle y lead status siguen en el contacto |
| Productos, líneas, cotizaciones públicas con aceptación | Starter/Pro (CPQ en Revenue Hub) | tiene | cotizaciones sin firma electrónica ni cobro |
| Multi-moneda | Pro | tiene | tipos de cambio manuales |
| Tags | no nativo (se usan propiedades) | mejor | |
| Papelera 90 días, merge de contactos y empresas | Starter | tiene | |
| Historial de propiedades | Starter | tiene | |

**Puntaje: 8/10.**

### Pipeline y deals

| Capacidad | HubSpot | Nosotros | Nota |
|---|---|---|---|
| Board por pipeline con arrastre | Starter | tiene | la zona de soltar es solo la lista de cards (ver Bugs) |
| Varios pipelines | 15 Starter / 100 Pro | tiene | sin límite |
| Propiedades obligatorias por etapa | Pro | tiene | |
| Deal estancado por etapa | Pro (Deal Insights) | tiene | |
| Motivo de ganado/perdido | Starter | tiene | |
| Deal score, Deal Plans, Deal Progression (IA) | Pro (beta) | falta | |
| Aprobaciones de pipeline, deal splits | Pro/Enterprise | tiene | reglas por etapa (siempre, monto o descuento), aviso y aprobar/rechazar; splits por % en reportes por persona, cuotas y forecast por owner |
| Mover etapa con teclado en el board | Starter | tiene | flechas entre cards, Shift + flecha cambia la etapa con aviso aria-live, M abre el menú de etapa |

**Puntaje: 7/10.**

### Ventas: email, secuencias, reuniones, llamadas

| Capacidad | HubSpot | Nosotros | Nota |
|---|---|---|---|
| Email 1:1 desde el registro, plantillas, snippets | Starter | tiene | "Draft with AI" incluido |
| Sync de Gmail | Starter | tiene | requiere app de Google verificada para usuarios no de prueba |
| Sync de Outlook / Microsoft 365 | Starter | falta | |
| Tracking de aperturas y clics | Starter | tiene | con filtros de bots y proxies |
| Secuencias | Starter (500 envíos/día) y Pro | tiene | pasos cada hora (cron), salida al responder, reservar o desuscribirse |
| Agenda de reuniones | Starter (1 link con marca) / Pro | mejor | Cal completo integrado, sin marca |
| Llamadas desde el navegador con grabación y transcripción | Starter 500 min / Pro 3.000 min | falta | solo registramos llamadas y WhatsApp desde links `tel:`/`wa.me` con resultado |
| Cola de trabajo diario (Prospecting / Sales Workspace) | Starter/Pro | tiene | Tareas › Empezar cola: vencidas y de hoy (con pasos de secuencia) de a una, completar, saltear, posponer y atajos |
| Extensión de Gmail/Outlook/Chrome | Starter | falta | |
| Playbooks y guiones de llamada | 5 Starter / 5.000 Pro | tiene | guion en Markdown y preguntas que escriben propiedades; desde el registro o al registrar una llamada |
| Notetaker y resumen de reuniones | Pro | falta | |
| Video 1:1, seguimiento de documentos | Starter/Pro | falta | |

**Puntaje: 6/10.**

### Automatización

| Capacidad | HubSpot | Nosotros | Nota |
|---|---|---|---|
| Workflows | 50 limitados Starter / 300 Pro | tiene | triggers de registro, email, reunión, formulario, cotización, score; ramas si/no; demoras vía Flow |
| Inscribir en secuencia desde workflow | Pro | tiene | |
| Lead scoring | 5 scores Starter / 10 Pro | tiene | hasta 10 scores con tramos, decaimiento y recálculo nocturno; filtros y workflows por score |
| Asignación round-robin | Pro | tiene | con fuera de oficina |
| Formularios con ruteo | Starter/Pro | tiene | sin pasos múltiples, condiciones ni CAPTCHA |
| Agentes de IA en workflows | Pro (Agent Builder) | parcial | existe en la suite (Agents, Flow), no como paso nativo del workflow del CRM |

**Puntaje: 8/10.**

### Integraciones y API

| Capacidad | HubSpot | Nosotros | Nota |
|---|---|---|---|
| API REST con scopes | Starter | tiene | `/api/v1/crm/*` con OpenAPI |
| Webhooks salientes | Pro (vía workflows) | tiene | `contact.*`, `deal.*` (creado, actualizado, etapa, ganado, perdido); sin eventos de empresa, tarea o actividad |
| Integración nativa con agenda, chat, agentes, automatización | por marketplace o Hubs | mejor | Cal, Chat, Agents y Flow alimentan el CRM sin configurar |
| Marketplace (Slack, Zoom, Stripe, etc.) | Starter | falta | se cubre en parte con Flow |

**Puntaje: 6/10.**

### Administración y permisos

| Capacidad | HubSpot | Nosotros | Nota |
|---|---|---|---|
| Equipos, roles, invitaciones | Starter | tiene | |
| Visibilidad: todo / propios / del equipo | Pro | tiene | aplicada a listas, API, reportes, exportación |
| Permisos por campo | Enterprise | tiene | campos propios de solo lectura u ocultos por rol member o equipo de ventas, en UI, import y API v1 |
| SSO | Enterprise | no medido | fuera de alcance de esta comparación |

**Puntaje: 7/10.**

### Reportes y analítica

| Capacidad | HubSpot | Nosotros | Nota |
|---|---|---|---|
| Dashboards | 10 Starter / 30 Pro | tiene | widgets arrastrables y redimensionables |
| Reportes predefinidos (embudo, fuentes, actividad, conversión) | Starter | tiene | |
| Reportes personalizados entre objetos | 100 Starter / 500 Pro | parcial | filtros y agrupación sobre informes fijos; no hay constructor libre |
| Forecast | Starter/Pro, jerarquías en Pro | parcial | forecast ponderado por probabilidad; sin categorías ni envío de forecast por vendedor |
| Metas y cuotas | limitadas Starter / plantillas Pro | tiene | mensuales o trimestrales por responsable |
| Deal journey analytics | Pro | falta | |

**Puntaje: 6/10.**

### Mobile y offline

| Capacidad | HubSpot | Nosotros | Nota |
|---|---|---|---|
| App mobile nativa (iOS/Android) | todos los planes | falta | |
| Listas usables a 390 px | sí | parcial | sin scroll horizontal de página, pero las tablas se cortan (en Contactos se ven Nombre y Email; Teléfono queda fuera) |
| Board a 390 px | sí | parcial | una columna y media visible, scroll lateral |
| Offline | parcial en la app | falta | |

**Puntaje: 3/10.**

### IA

| Capacidad | HubSpot | Nosotros | Nota |
|---|---|---|---|
| Borrador de email | Starter | tiene | solo con IA habilitada |
| Resumen de registro (contacto, empresa, deal) | Starter+ (Breeze) | falta | idea abierta en el backlog |
| Asistente que consulta y edita el CRM | Breeze Assistant | falta | |
| Prospecting Agent, Data Agent | Pro | falta | |
| Resumen de llamadas y reuniones | Pro | falta | |

**Puntaje: 2/10.**

### Importar y exportar

| Capacidad | HubSpot | Nosotros | Nota |
|---|---|---|---|
| Importar CSV con mapeo, responsables y asociaciones | Starter | tiene | con preset listo para exports de HubSpot |
| Exportar CSV/JSON | Starter | tiene | |
| Migración directa por API desde HubSpot/Pipedrive | migración asistida en Pro | tiene | ver "Mejora: importar desde otro CRM" abajo |
| Presets de CSV de otros CRMs | solo su propio formato | mejor | HubSpot, Salesforce, Zoho, Pipedrive, Attio y Close |

**Puntaje: 9/10 (antes 8).**

#### Mejora: importar desde otro CRM (2026-10-22)

- **HubSpot por API** con un token de Private App (scopes de solo lectura: `crm.objects.contacts.read`, `crm.objects.companies.read`, `crm.objects.deals.read`, `crm.objects.owners.read`, `crm.schemas.contacts.read`, `crm.schemas.companies.read`, `crm.schemas.deals.read` y `sales-email-read` para los emails). Trae owners (por email, los que no coinciden van al owner por defecto y se listan), propiedades propias como custom fields con su tipo, pipelines y etapas con probabilidad y ganado/perdido, empresas con su madre, contactos con lifecycle, lead status y fuente, deals con etapa, monto, moneda y cierre, asociaciones con primaria y notas, llamadas, reuniones, tareas y emails en el timeline con su fecha y owner. Listados con cursor `after`, asociaciones por lote (v4) y 100 pedidos cada 10 s con backoff en 429.
- **Pipedrive por API** con el token personal: personas, organizaciones, deals (ganado/perdido como etapas Won/Lost), pipelines y etapas, campos propios, notas y actividades.
- **Job con vista previa**: conteos, muestra, revisión de campos y pipelines y tabla de owners antes de escribir nada; después corre por tramos desde `/api/cron/minute` (y desde la pantalla abierta) guardando el cursor por página, así una cuenta de 50k contactos no choca con los 300 s. El progreso vive en el servidor y vuelve al recargar. Se puede cancelar.
- **Reimportar no duplica**: cada registro guarda su id externo (`crm_external_ids`); sin id previo, contactos por email y empresas por dominio se completan con las reglas del merge.
- **Seguridad**: solo admins; el token se guarda cifrado (`lib/secret-box`) mientras corre y se borra al terminar, fallar o cancelar; nunca va en URLs ni en errores.
- Entradas: Ajustes › Importar y exportar, estados vacíos de contactos y empresas, overview vacío y ⌘K.
- Falta: tags y listas de HubSpot (opcionales, no se traen) y los archivos adjuntos.

### Rendimiento y confiabilidad

No medimos tiempos: la máquina tenía 17 builds en paralelo. Las listas están paginadas del lado del servidor, los crons reclaman filas antes de procesar y no hubo errores de consola en ninguna de las 34 cargas. Las secuencias corren por hora, lo que es más lento que HubSpot (envío al minuto).

**Puntaje: 7/10 (sin medición de velocidad).**

### Pulido de UX

| Flujo | Nosotros | HubSpot |
|---|---|---|
| Crear contacto | `C` abre modal, Enter guarda, queda en la lista: 1 tecla + datos | botón "Create contact", panel lateral, 2 clics |
| Buscar | ⌘K encuentra el contacto recién creado al instante | barra de búsqueda global |
| Nota en el timeline | escribir + clic en "Add note"; ⌘Enter no envía | ⌘Enter no es estándar en HubSpot tampoco |
| Mover deal | arrastrar a la lista de cards de la columna | arrastrar a cualquier parte de la columna |
| Estado vacío con filtros | "Nothing matches these filters" con botón para limpiar | similar |
| Oscuro | correcto en board y registros | sin modo oscuro completo en todas las vistas |

Detalles: el composer del timeline tiene pestañas de tipo (Note, Task, Call…) y además un select de tipo debajo, que repite la misma elección. A 1440 px el board corta la columna "Won" y esconde "Lost" detrás del scroll lateral.

**Puntaje: 7/10.**

## Resumen de puntajes

| Área | Puntaje |
|---|---|
| Modelo de datos y registros | 8 |
| Pipeline y deals | 7 |
| Ventas: email, secuencias, reuniones, llamadas | 6 |
| Automatización | 8 |
| Integraciones y API | 6 |
| Administración y permisos | 7 |
| Reportes y analítica | 6 |
| Mobile y offline | 3 |
| IA | 2 |
| Importar y exportar | 9 |
| Rendimiento y confiabilidad | 7 |
| Pulido de UX | 7 |
| **Paridad general (promedio)** | **62 %** frente a Sales Hub Professional; cerca de **80 %** frente a Starter |

Frente a Starter casi todo lo que un equipo chico usa a diario está: registros, board, secuencias, plantillas, tracking, formularios, workflows, cuotas, cotizaciones. Las diferencias que más pesan son mobile, IA, llamadas y Outlook.

## Top 10 gaps (impacto para un equipo chico que viene de HubSpot)

| # | Gap | Por qué se vuelven a HubSpot | Esfuerzo |
|---|---|---|---|
| 1 | Mobile: listas como cards, acciones rápidas (llamar, WhatsApp, nota) y app instalable | los vendedores cargan llamadas y notas desde el teléfono; hoy las tablas se cortan a 390 px | M |
| 2 | Email fuera de Gmail: Outlook/Microsoft 365 y un camino IMAP/SMTP | un equipo en Microsoft no puede sincronizar nada; con Gmail, hasta que Google verifique la app solo conectan usuarios de prueba | L |
| 3 | IA en el registro: resumen y preguntas sobre el CRM | HubSpot lo da desde Starter (idea ya abierta: "CRM: Add an AI summary card…") | M |
| 4 | Llamadas desde el navegador con grabación, transcripción y registro automático | Starter incluye 500 minutos; hoy solo registramos el resultado a mano | L |
| 5 | Cola de trabajo diaria (tareas y pasos de secuencia uno tras otro) | es la pantalla donde un SDR vive en HubSpot | M |
| 6 | Notetaker: resumen de reuniones de Cal en el timeline | Pro lo trae; ahorra la nota post-reunión | L |
| 7 | Forecast con categorías y envío por vendedor | el forecast ponderado no alcanza para la reunión semanal de pipeline | M |
| 8 | Extensión de Gmail/Chrome con el panel del contacto | registrar y ver contexto sin salir de la bandeja | M |
| 9 | Playbooks y guiones con captura de propiedades | calificación consistente en llamadas | M |
| 10 | Board: soltar en toda la columna y mover etapa con teclado | arrastrar a una columna vacía y soltar sobre "Add deal" no hace nada | S |

Fuera del top 10 pero visibles: objetos propios (Attio los tiene en el plan gratis), aprobaciones y splits de deals, constructor libre de reportes, eventos de webhook para empresas y tareas, firma electrónica y cobro en cotizaciones.

## Bugs encontrados

1. **Board: soltar fuera de la lista de cards cancela el movimiento sin aviso.**
   Pasos: Deals › Board. Arrastrar un deal hasta otra columna y soltarlo sobre el título de la columna, sobre "+ Add deal" o en el espacio vacío debajo. El deal vuelve a su columna original y no aparece mensaje. Solo funciona si se suelta exactamente sobre la zona "No deals" o entre cards. Causa: `updateDrag` en `components/crm/DealsBoard.tsx` solo acepta `.kb-cards` como destino.
2. **Timeline: ⌘Enter / Ctrl+Enter no guarda la nota.**
   Pasos: abrir un contacto, escribir en "Notes", presionar ⌘Enter. No pasa nada; hay que hacer clic en "Add note". `Timeline.tsx` y `MentionTextarea.tsx` no manejan `metaKey`/`ctrlKey`.
3. **Timeline: tipo de actividad duplicado.**
   Pasos: abrir un contacto. Arriba del composer están las pestañas Note/Task/Call/Meeting/Email y debajo un select "Note" con la misma elección. Las pestañas cambian el select, pero el select no cambia la pestaña (`Timeline.tsx`: el `onChange` del select solo llama a `setType`), así que se puede estar en la pestaña Task, elegir "Call" en el select y guardar una llamada que no aparece en la lista filtrada que se está mirando.

## Fuentes

- HubSpot, precios de Sales Hub Starter y Professional: https://www.hubspot.com/pricing/sales/starter
- HubSpot, página de producto de Sales Hub: https://www.hubspot.com/products/sales
- HubSpot Knowledge Base, resumen de registros: https://knowledge.hubspot.com/records/summarize-records
- HubSpot Knowledge Base, resúmenes de actividad: https://knowledge.hubspot.com/records/view-activity-summaries-on-records
- HubSpot Blog, precios de Sales Hub: https://blog.hubspot.com/sales/hubspot-sales-hub-pricing
- Vantagepoint, cambio del Sales Workspace en abril de 2026: https://vantagepoint.io/blog/hs/hubspot-sales-workspace-update-april-2026-preparation-guide
- CloudTalk, llamadas en HubSpot (2026): https://www.cloudtalk.io/blog/hubspot-calling-pricing/
- Attio, precios: https://attio.com/pricing
- Attio, notas de versión (Ask Attio, Research Agent, workflows con agentes): https://releasebot.io/updates/attio
- Pipedrive, precios 2026 (guía de terceros): https://zeeg.me/en/blog/post/pipedrive-pricing
