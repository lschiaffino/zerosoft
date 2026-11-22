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
| Workflows | 50 limitados Starter / 300 Pro | tiene | contactos, empresas y deals; triggers de registro, propiedad cambiada, email, reunión, formulario, cotización, score; filtros de inscripción y reinscripción; esperas; un si/no; webhooks firmados (W1, 2026-11-22); inscripción por criterios, inscribir los que ya cumplen, sacar a mano y registro por acción (W3, 2026-11-22) |
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
| Reportes personalizados entre objetos | 100 Starter / 500 Pro | tiene | constructor con objetos asociados, campos propios, dos agrupaciones y cinco visualizaciones; sin propiedades calculadas |
| Forecast | Starter/Pro, jerarquías en Pro | tiene | categorías por deal, meta, envío por vendedor con historial, vista por equipo de ventas |
| Metas y cuotas | limitadas Starter / plantillas Pro | tiene | mensuales o trimestrales por responsable |
| Deal journey analytics | Pro | tiene | conversión, tiempo por etapa y caída desde el historial de etapas |

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

- **HubSpot por API** con una service key (Development › Keys › Service keys) o con el token de una private app heredada que ya exista; HubSpot dejó de permitir crear private apps nuevas el 2026-10-26 (2026-09-28 en cuentas nuevas) y las existentes siguen andando (https://developers.hubspot.com/changelog/legacy-private-app-creation-sunset, https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys). Al conectar se valida la clave y se muestra la cuenta, el tipo de clave y los permisos que tiene y le faltan (scopes de solo lectura: `crm.objects.contacts.read`, `crm.objects.companies.read`, `crm.objects.deals.read`, `crm.objects.owners.read`, `crm.schemas.contacts.read`, `crm.schemas.companies.read`, `crm.schemas.deals.read` y `sales-email-read` para los emails). Trae owners (por email, los que no coinciden van al owner por defecto y se listan), propiedades propias como custom fields con su tipo, pipelines y etapas con probabilidad y ganado/perdido, empresas con su madre, contactos con lifecycle, lead status y fuente, deals con etapa, monto, moneda y cierre, asociaciones con primaria y notas, llamadas, reuniones, tareas y emails en el timeline con su fecha y owner. Listados con cursor `after`, asociaciones por lote (v4) y 100 pedidos cada 10 s con backoff en 429.
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

## Mapa fila por fila contra HubSpot (2026-11-19)

Fuente de `content/feature-parity/crm.ts`. Reemplaza la lectura optimista de las tablas de arriba: cada fila es lo bastante fina como para que "have" quiera decir que alguien que viene de HubSpot no nota la diferencia en el uso diario.

- **Cómo se verificó:** nuestro lado, leyendo el código de main (archivo y línea en cada fila). No se corrió la app en esta pasada: nada de esta tabla se vio funcionando en el navegador. Las filas marcadas "carried over" conservan el estado de la tabla anterior sin volver a revisarse. El lado de HubSpot sale de su base de conocimiento y su documentación para desarrolladores, leídas el 2026-11-19; "sin URL confirmada" quiere decir que la afirmación sale de conocimiento del producto y no de una página leída ese día.
- **Estados:** have 67, partial 56, missing 30, better 4 (total 157). Al 2026-11-21 (después del bloque A2): have 72, partial 52, missing 30, better 4 (total 158). Después del bloque D2 (2026-11-21): have 74, partial 53, missing 27, better 4 (total 158). Después del bloque D3 (2026-11-21): sin cambios de estado (labels de asociación y permisos por campo siguen en partial, con menos faltantes). Después del bloque A3 (2026-11-22): have 80, partial 49, missing 25, better 4 (total 158); work-queue, tasks-index y task-reminders pasan a have. "Distinto a propósito" se anota al lado del estado.
- **Se nota:** cuánto lo siente un vendedor o admin que migra (H alto, M medio, L bajo). **Tamaño:** S días, M una semana, L varias.

### Objetos y registros

| Fila | HubSpot | zerosoft hoy (código) | Estado | Se nota | Tamaño |
|---|---|---|---|---|---|
| `core-records` | Contacts, companies and deals are the standard objects every account starts with. https://knowledge.hubspot.com/records/understand-objects | lib/crm.ts:827 createContact, :1362 createCompany, :1932 createDeal; tables in lib/schema/baseline.ts:69-149 | have | - | - |
| `tickets-object` | Tickets are a standard CRM object with a support pipeline (New, Waiting on contact, Waiting on us, Closed), a board and associations. https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines | No ticket table among the CRM tables (lib/crm-schema.ts, lib/schema/baseline.ts:69-380). Tickets exist only inside Lines (app/api/v1/groups/tickets) | missing | M | L |
| `lead-object` | Leads are a separate object worked from the Sales Workspace, with stages and conversion to a deal. https://knowledge.hubspot.com/records/manage-leads | lib/crm-leads.ts:399 convertLead; carried over from the previous table, not re-verified in this pass | have | - | - |
| `products-line-items` | Product library (name, SKU, price per currency, unit cost, term, billing frequency, folders) and line items with fixed or percent discounts. https://knowledge.hubspot.com/products/create-and-manage-products | lib/schema/types.ts:748-779: name, SKU, description, price, one currency, monthly or yearly, tax and percent discount | partial | L | S |
| `quotes` | Quotes built from a deal and its line items, shared by link, with templates. https://knowledge.hubspot.com/quotes/compare-legacy-quotes-and-quotes | components/crm/QuoteDocument.tsx, lib/crm-quote-sign.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `quote-esign-payment` | E-signature and payment collection on quotes. https://knowledge.hubspot.com/quotes/compare-legacy-quotes-and-quotes | lib/crm-quote-sign.ts, lib/crm-quote-pay.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `custom-objects` | Custom objects (Enterprise) get properties, pipelines, associations, lists, workflows and reports like standard objects. https://knowledge.hubspot.com/records/understand-objects | lib/crm-objects.ts; existing detail already says workflows and reports only run on contacts, companies and deals | partial | L | L |
| `record-id` | Each record has a numeric Record ID shown as a property, usable as a column, in exports and as the unique key when importing updates. https://knowledge.hubspot.com/records/deduplication-of-records | UUID primary keys (lib/crm.ts:832); no id column in components/crm/ContactsTable.tsx:71-84; import dedupes by email or domain only (lib/crm-import.ts:439, :514) | partial | L | S |
| `contact-email-unique` | HubSpot deduplicates contacts by email: creating a contact with an email that exists is blocked in the form and updates the existing record in imports, forms and the API. https://knowledge.hubspot.com/records/deduplication-of-records | lib/crm-contact-email.ts holds the rule: createContact and updateContact (lib/crm.ts) write with a NOT EXISTS on lower(trim(email)) and throw ContactEmailTakenError; the form, quick create and inline edit show the existing contact; session and v1 routes answer 409 contact_email_taken; Cal, chat, imports, robots and flows use the match; a CRM form updates it only with "update existing" on. No unique index yet (production may hold old duplicates): Contacts › Duplicates lists them for a manual merge. Built 2026-11-19, tests in tests/unit/crm-contact-email.test.ts | have | - | - |
| `contact-multiple-emails` | A contact can hold a primary email plus additional emails; all of them match incoming mail, forms and dedupe. https://knowledge.hubspot.com/records/add-multiple-email-addresses-to-a-contact | One email column per contact (lib/schema/baseline.ts:74) | missing | M | M |
| `company-domain-dedupe` | Companies deduplicate by Company domain name; the create form warns when the domain exists. https://knowledge.hubspot.com/records/deduplication-of-records | components/crm/DomainPrefill.tsx:94-141 warns about an existing company for the domain; import dedupes by domain (lib/crm-import.ts:514). Read in code, not seen running | have | - | - |
| `auto-create-company` | With the setting on, HubSpot creates a company from the contact email domain and associates it automatically. Sin URL confirmada | lib/crm.ts:816-837 findCompanyByDomain links only; no create | partial | M | S |
| `merge-duplicates` | Merge two contacts or two companies; a duplicates tool suggests pairs. https://knowledge.hubspot.com/records/merge-records | lib/crm.ts:987 mergeContacts, lib/crm-company-merge.ts, components/crm/DuplicatesPanel.tsx; carried over from the previous table, not re-verified in this pass | have | - | - |
| `merge-deals` | Deals (and tickets) can be merged from the record Actions menu. https://knowledge.hubspot.com/records/merge-records | Merge routes exist for contacts and companies only (app/api/crm/contacts/merge, app/api/crm/companies/merge); none under app/api/crm/deals | missing | L | S |
| `company-hierarchy` | Parent and child companies. https://knowledge.hubspot.com/properties/hubspot-crm-default-company-properties | lib/crm-assoc.ts setParentCompany; carried over from the previous table, not re-verified in this pass | have | - | - |
| `multi-currency` | Company currency plus additional currencies with exchange rates set by an admin. https://knowledge.hubspot.com/object-settings/add-and-edit-your-account-currencies | lib/crm-currency.ts, components/crm/CurrencySettings.tsx; carried over from the previous table, not re-verified in this pass | have | - | - |
| `trash-restore` | Recycle bin restores deleted contacts, companies, deals, tickets, tasks and other records for 90 days. https://knowledge.hubspot.com/records/restore-deleted-records | lib/crm-trash.ts:43 TRASH_ENTITIES = contact, company, deal, activity | partial | L | S |
| `permanent-delete` | A permanent (GDPR) delete removes the record and its history instead of sending it to the recycle bin. https://knowledge.hubspot.com/privacy-and-consent/how-do-i-perform-a-gdpr-delete-in-hubspot | lib/crm-trash.ts:403 purgeTrash removes trashed records on demand. Read in code, not seen running | have | - | - |
| `tags` | No native tags on records (teams use a multi-checkbox property). https://knowledge.hubspot.com/properties/property-field-types-in-hubspot | lib/crm-tags.ts; carried over from the previous table, not re-verified in this pass | better | - | - |
| `record-files` | Attachments on records and activities. https://knowledge.hubspot.com/records/work-with-records | lib/crm-files.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `company-enrichment` | Company data filled from the domain (HubSpot Insights, Breeze Intelligence for more). Sin URL confirmada | lib/crm-enrich.ts; carried over from the previous table, not re-verified in this pass | have | - | - |

### Propiedades

| Fila | HubSpot | zerosoft hoy (código) | Estado | Se nota | Tamaño |
|---|---|---|---|---|---|
| `default-contact-properties` | Contacts ship with about 200 default properties, including Mobile phone number, Street address, State/Region, Postal code, Time zone, LinkedIn URL, Number of times contacted and the Became a ... date for each lifecycle stage. https://knowledge.hubspot.com/properties/hubspots-default-contact-properties | lib/schema/baseline.ts:69-87, lib/crm.ts:756-787 ContactInput, lib/crm-activity-dates.ts:1-12 | partial | H | M |
| `default-company-properties` | Companies ship with Company name, Company domain name, Industry (a fixed dropdown), Type, Number of employees, Annual revenue, address fields, Time zone, Company owner and more. https://knowledge.hubspot.com/properties/hubspot-crm-default-company-properties | lib/schema/baseline.ts:92-106, lib/crm.ts:1314-1360 CompanyInput (industry is plain text) | partial | M | S |
| `default-deal-properties` | Deals ship with Deal name, Amount, Close date, Deal stage, Pipeline, Deal owner, Deal type, Priority, Next step, Closed won reason, Closed lost reason, Forecast category and more. https://knowledge.hubspot.com/properties/hubspots-default-deal-properties | lib/schema/baseline.ts:130-149 plus forecast_category; deal_type, next_step and won_reason (D2, 2026-11-21: lib/schema/migration-files/20261121_1825_crm_property_groups_unique_deal_props.ts, lib/crm.ts DealInput and DEAL_COLS, DEAL_TYPES in lib/crm-constants.ts) on the record, the filters, the API and the property history; since D3b also on the create form, bulk edit and the CSV import (HubSpot export columns Deal Type, Next step, Closed won reason). tests/unit/crm-d2-data-model.test.ts, tests/e2e/crm-d2-properties.spec.ts | have | - | - |
| `lifecycle-stages-editable` | Eight default lifecycle stages (Subscriber, Lead, Marketing qualified lead, Sales qualified lead, Opportunity, Customer, Evangelist, Other); admins can add and edit stages. https://knowledge.hubspot.com/records/use-lifecycle-stages | lib/crm-constants.ts:5-13 LIFECYCLE_STAGES is a const list | partial | M | S |
| `lifecycle-auto-sync` | By default the associated contact and company move to Opportunity when a deal is created and to Customer when it is won; the setting can be turned off. https://knowledge.hubspot.com/records/use-lifecycle-stages | No write to lifecycle_stage outside create, update and import (grep over lib/crm.ts, lib/crm-stage-move.ts, lib/crm-hooks.ts) | missing | M | S |
| `lead-status-editable` | Lead status is an editable dropdown with eight defaults: New, Open, In progress, Open deal, Unqualified, Attempted to contact, Connected, Bad timing. https://knowledge.hubspot.com/records/use-lifecycle-stages | lib/crm-constants.ts:14-22 LEAD_STATUSES is a const list | partial | H | S |
| `standard-property-options` | Admins edit the options of default dropdowns (Lead status, Deal type, Industry, Priority...) and can relabel most default properties. https://knowledge.hubspot.com/properties/create-and-edit-properties | Sources, priorities, lifecycle and lead status are const lists (lib/crm-constants.ts:5-28); only custom fields have editable options (lib/crm.ts:3171) | missing | M | M |
| `custom-fields` | Custom properties with field types: single-line and multi-line text, rich text, number, dropdown, radio, multiple checkboxes, single checkbox, date, date and time, file, HubSpot user, phone, URL, email, calculation, rollup and property sync. https://knowledge.hubspot.com/properties/property-field-types-in-hubspot | lib/schema/types.ts:366-368 CRM_CUSTOM_FIELD_TYPES (10 types) | partial | M | M |
| `property-groups` | Every property belongs to a group (Contact information, Deal information, custom groups) that organises the settings page and the record. https://knowledge.hubspot.com/properties/organize-and-export-properties | crm_custom_fields.group_name (D2, 2026-11-21); edited in components/crm/CustomFieldsPanel.tsx with suggestions; the record shows one card per group (customFieldSections in components/crm/customPropFields.ts). Built-in properties keep fixed cards; no rename or reorder of groups and no group filter in settings | partial | L | S |
| `property-description` | A property has a description that shows as a tooltip on the record and in forms. https://knowledge.hubspot.com/properties/create-and-edit-properties | crm_custom_fields.description (D2, 2026-11-21), shown under the name on the record (PropertiesPanel `help`). Built-in properties have no description | have (distinto a propósito: ayuda visible debajo del nombre en vez de tooltip, se lee también en mobile) | - | - |
| `property-unique` | Up to 10 properties per object can require unique values and then work as an import and API key. https://knowledge.hubspot.com/records/deduplication-of-records | crm_custom_fields.is_unique (D2, 2026-11-21), lib/crm-unique.ts: text, number, URL and phone on contacts, companies and deals; only owners and admins turn it on, and only without existing duplicates. Checked in create and update (record, API v1, bulk edit, CSV import); the error does not name the other record; public forms drop the value silently. Not used as an import or API match key; no limit of 10 | partial | L | S |
| `property-required-on-create` | Admins customise the Create record form of each object: which properties appear, their order and which are required. https://knowledge.hubspot.com/object-settings/set-up-fields-seen-when-manually-creating-records | D3b, 2026-11-21: crm_create_forms (lib/schema/migration-files/20261121_2130_crm_create_forms.ts), lib/crm-create-form.ts and lib/crm-create-form-shared.ts, Settings > Data panel components/crm/CreateFormPanel.tsx, fields rendered by components/crm/CreateFormFields.tsx in CrmQuickCreate, ContactForm, CompanyForm, DealFullForm, DealForm and CompanyQuickCreate; required enforced in the session POST routes for requests from those forms (`createForm: true`, app/api/crm/{contacts,companies,deals}/route.ts); saving a contact from a chat and the MCP create without it. Members get only the custom properties they can edit. API v1, import, public forms and sync do not enforce it: HubSpot scopes the setting to records created manually in HubSpot. Base properties stay fixed at the top; yes/no properties cannot be required. tests/unit/crm-d3b-create-form.test.ts, tests/e2e/crm-d3b-create-form.spec.ts | have | - | - |
| `calculated-properties` | Calculation properties compute from other properties (formulas, time between dates) and rollups aggregate associated records (count, sum, min, max). https://knowledge.hubspot.com/properties/property-field-types-in-hubspot | No calculated type in lib/schema/types.ts:366 | missing | M | M |
| `conditional-property-logic` | A dropdown value can reveal and require other properties on the create form and the record. https://knowledge.hubspot.com/properties/set-up-conditional-logic-for-enumeration-properties | Not present: fields render from a flat list (components/crm/PropertiesPanel.tsx:46-60) | missing | L | M |
| `property-settings-page` | Settings › Properties lists every default and custom property of an object with search, filters by group, type and creator, usage, archive and restore, and export. https://knowledge.hubspot.com/properties/create-and-edit-properties | components/crm/CustomFieldsPanel.tsx; lib/crm.ts:3119-3200. Read in code, not seen running | partial | M | S |
| `property-history` | Each property keeps its change history (value, source, date, user), opened from the property on the record. https://knowledge.hubspot.com/records/view-record-property-history | lib/crm.ts logPropertyEvents, components/crm/HistoryPanel.tsx (opened from the record More menu, one list for all properties). D2 (2026-11-21): app/api/crm/history/route.ts now applies the record visibility (404), drops custom properties hidden by field permissions and blanks the name of a linked company the viewer cannot see | have (distinto a propósito: history is one list per record in the More menu instead of a link on each property) | L | - |
| `record-owner` | Each record has an owner property and can have additional custom HubSpot user properties. https://knowledge.hubspot.com/user-management/hubspot-user-permissions-guide | owner_id on contacts, companies and deals (lib/schema/baseline.ts:72, :95, :133); custom type user (lib/schema/types.ts:367) | have | - | - |

### Asociaciones

| Fila | HubSpot | zerosoft hoy (código) | Estado | Se nota | Tamaño |
|---|---|---|---|---|---|
| `association-labels` | Association labels describe the relationship between any two records (Decision maker, Billing contact...); admins create single and paired labels per object pair. https://knowledge.hubspot.com/object-settings/create-and-use-association-labels | D3 (2026-11-21): lib/crm-assoc-labels.ts and app/api/crm/association-labels/route.ts, workspace labels for contact to company and deal to contact (owner/admin create, rename, delete; deleting clears them from links); components/crm/AssociationLabelsPanel.tsx in Settings › Data; set on the association cards of the contact, company and deal records and through POST /api/crm/associations. Still missing: paired labels, several labels per link, labels on deal to company and on custom objects | partial | M | S |
| `primary-company` | A contact or deal with several companies has one marked Primary. https://knowledge.hubspot.com/records/associate-records | lib/crm-assoc.ts:1-14 (one primary per contact and per deal, mirrored to crm_contacts.company_id) | have | - | - |
| `activity-multi-association` | An activity can be associated with many contacts, companies, deals and tickets; logging on a contact also associates its primary company and up to five recent open deals. https://knowledge.hubspot.com/connected-email/log-email-in-your-crm-with-the-bcc-or-forwarding-address | crm_activities has single contact_id, company_id and deal_id columns (lib/schema/baseline.ts:172-174); the timeline card edits the three; company and deal timelines roll up associated activity (lib/crm-timeline.ts) | partial | H | M |
| `association-cards` | Association cards on the right sidebar list related records with Add (existing or new) and remove. https://knowledge.hubspot.com/records/associate-records | components/crm/RecordCard.tsx wraps components/crm/AssociationPanel.tsx in the right column (components/crm/RecordColumns.tsx): count, Add, collapse remembered per person. tests/e2e/crm-record-layout.spec.ts | have | - | - |
| `custom-object-associations` | Any standard or custom object can be associated with any other, with configurable limits. https://knowledge.hubspot.com/records/associate-records | lib/crm-objects.ts crm_object_links; lib/crm-assoc.ts:27 AssocObject = contact, company, deal. Read in code, not seen running | partial | L | M |

### Ficha del registro y timeline

| Fila | HubSpot | zerosoft hoy (código) | Estado | Se nota | Tamaño |
|---|---|---|---|---|---|
| `record-three-columns` | Every record has a left sidebar (actions and About this record properties), a middle column (Overview and Activities tabs) and a right sidebar (association cards and tools). https://knowledge.hubspot.com/records/work-with-records | components/crm/RecordColumns.tsx and styles/crm-record-layout.css: three columns from 1240px, one column with four tabs below; contacts, companies and deals (leads and custom objects keep components/crm/recordTab.ts). tests/e2e/crm-record-layout.spec.ts | have | - | - |
| `record-sidebar-inline-edit` | The About card in the left sidebar edits any property in place, saved on blur, always visible next to the timeline. https://knowledge.hubspot.com/records/work-with-records | components/crm/PropertiesPanel.tsx inline edit inside the left column cards (components/crm/RecordColumns.tsx), next to the timeline. tests/e2e/crm-record-layout.spec.ts | have | - | - |
| `record-action-row` | A row of icons under the record name: Note, Email, Call, Task, Meeting, More. https://knowledge.hubspot.com/records/work-with-records | components/crm/Timeline.tsx:86, :408-440 composer by activity type; header buttons at app/[locale]/app/crm/contacts/[id]/page.tsx:164-192 | have (distinto a propósito: the composer sits on top of the timeline instead of an icon row under the name) | L | - |
| `record-overview-tab` | The Overview tab shows data highlights, recent communications and association tables; Activities is the second tab. https://knowledge.hubspot.com/records/work-with-records | The record opens on Overview: next task, highlights, recent communications and a short list per association (RecordRecentCommunications and RecordAssociationSummary in components/crm/RecordColumns.tsx; default tab in components/crm/recordLayout.ts). The lists are read-only; editing is in the right column cards. tests/e2e/crm-record-layout.spec.ts | have | - | - |
| `activity-timeline` | Activity timeline with notes, emails, calls, tasks and meetings created from the record. https://knowledge.hubspot.com/records/filter-activities-on-a-record-timeline | components/crm/Timeline.tsx (A2, 2026-11-21): tabs Activity, Notes, Emails, Calls, Tasks, Meetings with counts; groups Pinned, Upcoming, This month and by month (components/crm/timelineModel.ts); cards with type icon, author, relative date, associated records and a menu (pin, edit, associations, delete); HubSpot buttons per tab (Create note, Create email, Log email, Log call, Create task, Log meeting) with date, outcome and direction. Data from lib/crm-timeline.ts. tests/e2e/crm-timeline.spec.ts | have | - | - |
| `timeline-filters` | Filter activity (checklist of activity types), filter by users and teams, search activities, collapse or expand all. https://knowledge.hubspot.com/records/filter-activities-on-a-record-timeline | components/crm/Timeline.tsx and components/crm/TimelineMenu.tsx: type checklist (remembered), users menu, search across activities, emails and WhatsApp messages, Collapse all / Expand all. No filter by sales team. tests/unit/crm-timeline-model.test.ts, tests/e2e/crm-timeline.spec.ts | have | - | - |
| `timeline-full-history` | The timeline loads older activity as you scroll, grouped by month, with no cap. https://knowledge.hubspot.com/records/filter-activities-on-a-record-timeline | lib/crm-timeline.ts listRecordActivities pages 100 at a time; GET /api/crm/timeline backs Load more activity, no cap. Emails still show the latest 100 messages (lib/crm-email.ts listEmailThreads) | partial | M | S |
| `timeline-associated-activity` | Company and deal records show activity from associated records, with a filter to hide it. https://knowledge.hubspot.com/records/filter-activities-on-a-record-timeline | lib/crm-timeline.ts listRecordActivities: company = its contacts and deals, deal = its contacts and company, marked as associated, behind activityScopeSql and the Lines chat-task rule; switch in Filter activity. tests/unit/crm-timeline.test.ts, tests/e2e/crm-timeline.spec.ts | have | - | - |
| `pinned-activity` | One activity per record can be pinned to the top of the timeline. https://knowledge.hubspot.com/records/filter-activities-on-a-record-timeline | lib/crm-timeline.ts pinOnRecord: one pinned per record, only the record's own activities; POST /api/crm/timeline. tests/unit/crm-timeline.test.ts | have | - | - |
| `rich-text-notes` | Notes have a rich text editor with formatting, links, images, snippets and attachments. https://knowledge.hubspot.com/records/manually-log-activities-on-records | Notes are plain text with @mentions (components/crm/MentionTextarea.tsx, components/crm/Timeline.tsx:84); files attach separately | missing | M | S |
| `activity-comments` | Teammates comment on any timeline activity and @mention each other. https://knowledge.hubspot.com/records/comment-on-an-activity | No comment table or UI for activities (components/crm/Timeline.tsx) | missing | L | S |
| `log-other-channels` | Log SMS, WhatsApp message, LinkedIn message and Postal mail as their own activity types. https://knowledge.hubspot.com/records/manually-log-activities-on-records | lib/crm-constants.ts:24 ACTIVITY_TYPES (5); channel whatsapp on calls; Lines chats linked to a contact or company as a WhatsApp tab in the timeline (lib/crm-timeline.ts listRecordChats, Lines visibility). No SMS, LinkedIn or postal mail | partial | L | S |
| `timeline-property-changes` | The timeline can also show lifecycle stage changes, deal stage changes, form submissions, list memberships and sequence enrolments, each a filter option. https://knowledge.hubspot.com/records/filter-activities-on-a-record-timeline | components/crm/HistoryPanel.tsx; app/[locale]/app/crm/contacts/[id]/page.tsx:199-216 | partial | L | S |
| `record-customization` | Admins customise the left sidebar, middle column and right sidebar of each object, with default and team-specific views and conditional sections. https://knowledge.hubspot.com/object-settings/customize-records | Sections are fixed in code (PropSection in components/crm/PropertiesPanel.tsx:46-49) | missing | M | M |
| `record-preview` | Preview opens a record in a right panel from index pages and association cards. https://knowledge.hubspot.com/object-settings/customize-record-previews | components/crm/RecordPreview.tsx used by ContactsTable.tsx:500, CompaniesTable.tsx:377, DealsTable.tsx:398 (not from the deal board) | have | - | - |
| `record-follow` | Users follow records they do not own to get notified about their activity. https://knowledge.hubspot.com/records/follow-a-record | No follower table for CRM records (lib/crm-schema.ts) | missing | L | S |
| `deal-stage-on-record` | The deal record shows its stage and lets you change it in place. https://knowledge.hubspot.com/records/work-with-records | components/crm/DealStagePanel.tsx. Read in code, not seen running | have | - | - |
| `list-membership-on-record` | A card on the record shows the lists (segments) the record belongs to. Sin URL confirmada | app/[locale]/app/crm/contacts/[id]/page.tsx:625-640 | have | - | - |

### Listados, vistas y filtros

| Fila | HubSpot | zerosoft hoy (código) | Estado | Se nota | Tamaño |
|---|---|---|---|---|---|
| `index-table` | Each object has an index page with a table, search, sortable columns and 25, 50 or 100 rows per page. https://knowledge.hubspot.com/records/view-and-filter-records | components/crm/ContactsTable.tsx, CompaniesTable.tsx, DealsTable.tsx; lib/crm-http.ts:47-51 page size 25, up to 100 | have | - | - |
| `saved-views` | Saved views keep filters, columns and sort; they can be updated, cloned, pinned as tabs and set as default. https://knowledge.hubspot.com/records/create-and-manage-saved-views | B2 (2026-11-22): lib/crm-views.ts, lib/crm-views-shared.ts (default views All, My, Unassigned, Open deals; state merge with the URL); components/crm/ViewTabs.tsx (tabs, pin, reorder, close, More, save, save as, rename, delete); app/[locale]/app/crm/views/page.tsx (All views, search, creator and sharing filters); Cmd+K in lib/app-search.ts; the deal board applies the view (lib/crm.ts listDealsForBoard). No per-person default view other than the first tab | have | - | - |
| `view-columns` | Edit columns picks any property as a column, in any order, resizable, saved per view. https://knowledge.hubspot.com/records/create-and-manage-saved-views | B2: components/crm/EditColumns.tsx (choose, reorder by drag or buttons, freeze the first column; only the fields the person can see); saved with the view as `cols` and `freeze`, browser storage without a saved view. The name column is always first; no resize | partial | L | S |
| `view-sharing` | A view is shared as Private, My team or Everyone. https://knowledge.hubspot.com/records/create-and-manage-saved-views | B2: crm_saved_views.person_id, visibility, team_id (lib/schema/migration-files/20261122_0206_crm_saved_views_sharing.ts); canSeeView and canEditView in lib/crm-views-shared.ts (private only for its creator, admins included; team for its sales team and admins; shared views edited by the creator or an admin); redactViewQuery strips rules, sort and columns on fields hidden to the viewer; tests/unit/crm-b2-saved-views.test.ts | have | - | - |
| `filter-operators` | Operators depend on the property type: is any of, is none of, contains, is known, is unknown, is between, is more or less than X days ago, rolling date ranges and more. https://knowledge.hubspot.com/segments/determine-filter-criteria | lib/crm-filter-model.ts FILTER_OPS; lib/crm-filters.ts compileRule (one compiler for lists, counts, export and API). History operators (has ever been, updated in last N days) not built | have | - | - |
| `filter-groups` | Advanced filters combine AND rules inside a group and OR between groups. https://knowledge.hubspot.com/segments/determine-filter-criteria | components/crm/AdvancedFilters.tsx on contacts, companies and deals (table and, since B2, the deal board); lib/crm-filters.ts compileFilterModel: AND inside a group, OR between up to 5 groups. Dynamic lists still use one flat list with all or any | have | - | - |
| `filter-associated` | Advanced filters can use properties of associated objects (contacts whose company industry is X, deals whose contact is in a list). https://knowledge.hubspot.com/segments/determine-filter-criteria | Primary company name on contacts and deals (lib/crm.ts CONTACT_ADV_FIELDS, DEAL_ADV_FIELDS companyName), plus tags, static lists, scores and a fixed set of activity fields. No other property of an associated record | partial | M | M |
| `quick-filters` | Quick filters (owner, create date, last activity date, lead status) sit above the table. https://knowledge.hubspot.com/segments/determine-filter-criteria | components/crm/ContactsFilters.tsx; lib/crm.ts:519-527 ContactFilter (lifecycle, lead status, source, company, owner, created range) | have | - | - |
| `inline-edit` | Cells in the index table are edited in place. https://knowledge.hubspot.com/records/bulk-edit-records | components/crm/InlineEditCell.tsx, ContactsTable.tsx:266-344 | have | - | - |
| `bulk-actions` | Select rows or all records in the view, then Assign, Edit any property, Delete, Create tasks, Add to list, Enroll in sequence. https://knowledge.hubspot.com/records/bulk-edit-records | lib/crm-bulk-fields.ts:10-14 BULK_FIELDS; components/crm/ContactsTable.tsx:120-137 enroll; no select-all-matching found in ContactsTable.tsx or BulkEditControls.tsx | partial | M | S |
| `deals-board` | Board view of deals by stage with drag and drop. https://knowledge.hubspot.com/records/manage-records-in-board-view | components/crm/DealsBoard.tsx; carried over from the previous table, not re-verified in this pass | have | - | - |
| `board-card-customization` | Admins and users choose which properties show on board cards, plus tags and inactivity. https://knowledge.hubspot.com/object-settings/select-properties-to-show-on-records-in-board-view | Card content is fixed: name, amount, company or contact, close date, owner and score (components/crm/DealsBoard.tsx:640-670) | missing | L | S |
| `board-totals` | Board columns show the count, total amount and weighted amount of the stage. https://knowledge.hubspot.com/records/manage-records-in-board-view | components/crm/DealsBoard.tsx:43 (totals in base currency; no weighted figure in the file) | partial | L | S |
| `quick-create` | Create records from anywhere and global search. https://knowledge.hubspot.com/help-and-resources/a-guide-to-hubspots-navigation | components/crm/CrmQuickCreate.tsx, lib/crm.ts:3602 searchAll; carried over from the previous table, not re-verified in this pass | have | - | - |

### Listas y segmentos

| Fila | HubSpot | zerosoft hoy (código) | Estado | Se nota | Tamaño |
|---|---|---|---|---|---|
| `contact-lists` | Active and static lists (now called segments) for contacts, companies, deals and custom objects. https://knowledge.hubspot.com/segments/create-active-or-static-lists | crm_list_members references contacts only (lib/schema/baseline.ts:227-231); lib/crm.ts:2832-3040 | partial | M | M |
| `list-usage` | Lists feed filters, workflow enrolment and bulk actions. https://knowledge.hubspot.com/segments/create-active-or-static-lists | lib/crm.ts:219-225 list filter; workflow action add_to_list (lib/crm-workflows.ts:61) | have | - | - |
| `list-folders` | Lists are organised in folders. https://knowledge.hubspot.com/segments/create-active-or-static-lists | crm_lists has no folder column (lib/schema/baseline.ts:217-225) | missing | L | S |

### Importar y exportar

| Fila | HubSpot | zerosoft hoy (código) | Estado | Se nota | Tamaño |
|---|---|---|---|---|---|
| `csv-import` | Import one or several objects from a file, map columns to properties, dedupe by email, domain or Record ID, and associate the objects of each row. https://knowledge.hubspot.com/import-and-export/import-objects | lib/crm-import.ts:97 one entity per import; :10 and :58-92 company and contact link columns; :439, :514 dedupe | partial | H | M |
| `import-xlsx` | Imports accept .csv, .xlsx and .xls. https://knowledge.hubspot.com/import-and-export/import-objects | components/crm/ImportPanel.tsx:251 accept=".csv,text/csv" | missing | M | S |
| `import-history` | The Imports page lists past imports with status, an error file to download, a view of the imported records and Delete import. https://knowledge.hubspot.com/import-and-export/view-and-analyze-previous-imports | lib/crm-import.ts:111-130 writes crm_imports; no list of them in components/crm/ImportPanel.tsx | partial | M | S |
| `export` | Export a view or all records to CSV, XLS or XLSX, choosing the view columns or all properties and including associations. https://knowledge.hubspot.com/import-and-export/export-records | app/api/crm/export/route.ts:46-68 fixed COLUMNS per entity, csv or json | partial | M | S |
| `api-migration` | Smart transfer and data sync bring records from other CRMs. https://knowledge.hubspot.com/integrations/connect-and-use-hubspot-data-sync | lib/crm-import-jobs.ts:1-24, lib/crm-import-hubspot.ts:1-16, lib/crm-import-pipedrive.ts | have | - | - |
| `other-crm-csv-presets` | Import maps columns by header name and by its own export format. https://knowledge.hubspot.com/import-and-export/import-objects | lib/crm-import.ts presets; carried over from the previous table, not re-verified in this pass | better | - | - |

### Pipeline y deals

| Fila | HubSpot | zerosoft hoy (código) | Estado | Se nota | Tamaño |
|---|---|---|---|---|---|
| `multiple-pipelines` | Several deal pipelines, each with its own stages and probabilities. https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines | lib/crm.ts:1483-1620; lib/schema/baseline.ts:111-128 | have | - | - |
| `stage-required-fields` | Required properties when a deal enters a stage. https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines | crm_stages.required_fields, lib/crm.ts:2097 dealMissingForStage; carried over from the previous table, not re-verified in this pass | have | - | - |
| `pipeline-rules` | Pipeline rules restrict skipping stages, moving backwards, creating deals outside the first stage and editing closed deals. https://knowledge.hubspot.com/object-settings/set-up-pipeline-rules | moveDeal checks required fields and approvals only (lib/crm.ts:2121-2236) | missing | L | S |
| `pipeline-access` | Access to each pipeline can be limited to chosen users and teams. https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines | crm_pipelines has id, name and position only (lib/schema/baseline.ts:111-117) | missing | L | S |
| `pipeline-stage-automation` | The Automate tab of a pipeline adds actions per stage (create task, send notification, update property). https://knowledge.hubspot.com/object-settings/set-up-pipeline-automations-for-objects | Workflow trigger deal_stage_changed with task, notify and update actions (lib/crm-workflows.ts:36-69) | have (distinto a propósito: set up in Workflows instead of a tab inside pipeline settings) | L | - |
| `deal-rotting` | Deals inactive for a number of days are flagged on the board. https://knowledge.hubspot.com/records/manage-records-in-board-view | crm_stages.rotting_days, lib/crm-rotting.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `won-lost-reasons` | Closed won and closed lost reasons. https://knowledge.hubspot.com/properties/hubspots-default-deal-properties | lib/crm-won-dialog.ts, crm_deals.lost_reason; carried over from the previous table, not re-verified in this pass | have | - | - |
| `deal-ai-insights` | AI deal score and insights. Sin URL confirmada | lib/crm-ai.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `deal-approvals-splits` | Deal approvals and deal splits. https://knowledge.hubspot.com/object-settings/set-up-pipeline-rules | lib/crm-approvals.ts, lib/crm-splits.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `board-keyboard` | Move deals between stages. https://knowledge.hubspot.com/records/manage-records-in-board-view | components/crm/DealsBoard.tsx; carried over from the previous table, not re-verified in this pass | have | - | - |

### Tareas, email, secuencias, reuniones y llamadas

| Fila | HubSpot | zerosoft hoy (código) | Estado | Se nota | Tamaño |
|---|---|---|---|---|---|
| `tasks` | Tasks with type (to-do, call, email), priority, due date, repeat and associated records. https://knowledge.hubspot.com/tasks/create-tasks | lib/crm.ts:2237-2262 ActivityInput; lib/crm-task-repeat.ts | have | - | - |
| `work-queue` | Task queues: named queues a rep fills and then works one task after another; any filtered task view can be started. https://knowledge.hubspot.com/tasks/create-tasks | lib/crm-task-queues.ts (A3, 2026-11-22): named queues, private or shared, crm_activities.queue_id; app/[locale]/app/crm/tasks/queue/page.tsx works a named queue (`?queue=`) or the filters of the view (lib/crm-tasks-index.ts taskFilterWhere, lib/crm-tasks-shared.ts queueParamsFor); components/crm/TaskQueuesManager.tsx. tests/unit/crm-a3-tasks.test.ts, tests/e2e/crm-a3-tasks.spec.ts | have | - | - |
| `tasks-index` | The Tasks index page is a table with default views (All, Due today, Overdue, Upcoming), filters, columns, saved views and bulk edit. https://knowledge.hubspot.com/tasks/create-tasks | components/crm/TasksView.tsx (A3, 2026-11-22): table with ViewTabs (saved views entity `tasks`, lib/crm-views-shared.ts), filters, sort, Edit columns, pager; app/api/crm/tasks/bulk/route.ts for bulk edit | have | - | - |
| `task-reminders` | Each task can carry a reminder (email at a chosen time) and users get a daily task digest. https://knowledge.hubspot.com/tasks/create-tasks | lib/crm-task-reminders.ts (A3, 2026-11-22): crm_activities.reminder_at, sent from app/api/cron/minute as a notification and an email to the assignee who can still see the task; lib/crm-task-digest.ts, opt-in daily email at 8 local time from app/api/cron/tick (crm_task_digests) | have | - | - |
| `email-templates-snippets` | Send 1:1 email from the record with templates and snippets. https://knowledge.hubspot.com/templates/create-and-send-templates | components/crm/TemplatesView.tsx, lib/crm-email.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `gmail-sync` | Connected personal inbox (Gmail) logs sent and received mail on the record. https://knowledge.hubspot.com/connected-email/connect-your-inbox-to-hubspot | lib/crm-email-sync.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `outlook-sync` | Connected personal inbox (Outlook, Microsoft 365). https://knowledge.hubspot.com/connected-email/connect-your-inbox-to-hubspot | lib/crm-outlook-sync.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `email-tracking` | Email open and click tracking with notifications. https://knowledge.hubspot.com/connected-email/log-email-in-your-crm-with-the-bcc-or-forwarding-address | lib/crm-email.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `email-bcc-logging` | Each account has a BCC address (logs outgoing mail) and a forwarding address (logs received mail) that work from any mail client. https://knowledge.hubspot.com/connected-email/log-email-in-your-crm-with-the-bcc-or-forwarding-address | No BCC or forwarding address in lib/crm-email.ts, lib/crm-email-sync.ts or lib/crm-extension.ts | missing | M | M |
| `email-never-log` | A never-log list (per user and per account) keeps mail with chosen addresses and domains out of the CRM. Sin URL confirmada | No exclusion list found in lib/crm-email-sync.ts, lib/crm-email-schema.ts or lib/crm-outlook-sync.ts (sync covers mail with workspace contacts) | missing | M | S |
| `inbox-extension` | Sales extension for Chrome (Gmail), Outlook add-in and Office 365 add-in: log and track from compose, contact sidebar, templates, sequences and meetings. https://knowledge.hubspot.com/connected-email/use-sales-tools-in-the-hubspot-sales-chrome-extension | lib/crm-extension.ts, app/api/v1/crm/extension/* | partial | M | M |
| `shared-inbox` | The conversations inbox (CRM › Inbox) brings team email, chat, forms, WhatsApp and calls into one shared inbox linked to records. https://knowledge.hubspot.com/inbox/set-up-the-conversations-inbox | CrmGroupsBlock on the contact page (app/[locale]/app/crm/contacts/[id]/page.tsx:377). Depth of the Inbox link not verified | partial (distinto a propósito: the inbox is its own app in the suite) | M | M |
| `sequences` | Sequences of automated emails and task reminders that stop on reply or booking. https://knowledge.hubspot.com/sequences/create-and-edit-sequences | lib/crm-sequences.ts:23 steps email, task, wait; :43 business days; bulk enroll at components/crm/ContactsTable.tsx:120 | have | - | - |
| `meeting-scheduling` | Scheduling pages (one-on-one, group, round robin). https://knowledge.hubspot.com/meetings-tool/create-and-edit-scheduling-pages | Cal app; carried over from the previous table, not re-verified in this pass | better | - | - |
| `calendar-sync` | With Google Calendar or Outlook Calendar connected, meetings created on a record go to the calendar with invites, and calendar events with contacts are logged on the record. https://knowledge.hubspot.com/integrations/use-hubspots-integration-with-google-calendar-or-outlook-calendar | lib/crm-integrations.ts:166 (Cal bookings), lib/crm-outlook-sync.ts; no Google Calendar read in lib/crm-email-sync.ts | partial | H | M |
| `call-whatsapp-logging` | Log a call with outcome and type. https://knowledge.hubspot.com/records/manually-log-activities-on-records | lib/crm-calls.ts:20-25 outcome lists | have | - | - |
| `browser-calling` | Calling from the browser with recording and transcripts. https://knowledge.hubspot.com/calling/use-the-calling-tool | lib/crm-voice.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `playbooks` | Playbooks (Professional): guided scripts whose answers update properties. https://knowledge.hubspot.com/playbooks/use-playbooks | lib/crm-playbooks.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `video-document-tracking` | Documents tool with tracked share links. https://knowledge.hubspot.com/documents/use-documents | lib/crm-media.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `sales-workspace` | The Sales Workspace gathers tasks, the schedule, leads, deals and a feed of prospect activity in one place. https://knowledge.hubspot.com/sales-workspace/manage-sales-activities-in-the-updated-sales-workspace | lib/crm.ts:3283-3460 getCrmOverview; lib/crm-work-queue.ts | partial | M | M |

### Automatización

| Fila | HubSpot | zerosoft hoy (código) | Estado | Se nota | Tamaño |
|---|---|---|---|---|---|
| `workflows` | Workflows for contacts, companies, deals, tickets and custom objects: enrolment by events or by filter criteria, re-enrolment, a visual canvas with actions, delays and branches. https://knowledge.hubspot.com/workflows/create-workflows | lib/crm-workflows.ts TRIGGER_TYPES (19, with criteria_met) and ACTION_TYPES (15); enrolment, delays and resume in runWorkflowsForEvent / executeRun / resumeWaitingWorkflowRuns; pure rules in lib/crm-workflow-rules.ts. No canvas, one if/else, no leads, tickets or custom objects | partial | H | L |
| `workflow-delays` | Delay actions wait a set time, until a date, a day and time, or until an event happens. https://knowledge.hubspot.com/workflows/choose-your-workflow-actions | `delay` action (minutes, hours, days, up to 30): the run is saved as `waiting` with resume_at and next_position, and the minute cron resumes it with a per-row claim (lib/crm-workflows.ts resumeWaitingWorkflowRuns). No wait until a date, a day and time or an event | partial | H | M |
| `workflow-filter-enrollment` | Enrolment triggers can be filter criteria (property values, list membership, activity) evaluated continuously, with optional re-enrolment and enrolling existing records. https://knowledge.hubspot.com/workflows/set-your-workflow-enrollment-triggers | crm_workflows.settings { reenroll, filters } (lib/crm-workflow-rules.ts); property-changed trigger with optional new value; enrolment in one compare-and-set INSERT (lib/crm-workflows.ts enroll): never while enrolled, once without re-enrolment, at most 10 a day with it. W3: trigger criteria_met (the filters are the criteria, checked on created/updated and deal stage changes; re-enrolment only after a criteria property changes, lib/crm-workflow-rules.ts criteriaChanged) and enrollExistingRecords (owner/admin route, at most 500 enrolled of 2000 checked per pass with a keyset cursor to continue, never a record that was enrolled before, at most 500 waiting per workspace, queued as waiting with start times spread 50 per minute). No list or activity criteria, no OR groups, a change in a related record doesn't re-check | partial | H | S |
| `workflow-company-objects` | Workflows exist per object: contact, company, deal, ticket, lead, custom object and more. https://knowledge.hubspot.com/workflows/create-workflows | company_created and company_updated fired from lib/crm.ts createCompany/updateCompany; trigger group Companies (lib/crm-workflow-catalog.ts). None for leads, tickets or custom objects | partial | M | M |
| `workflow-action-catalog` | Actions include Rotate record to owner, Create record, Edit record (incl. associated records), Add to and Remove from static list, Send internal notifications, branches with many paths. https://knowledge.hubspot.com/workflows/choose-your-workflow-actions | lib/crm-workflows.ts executeAction: rotate_owner (cursor with compare-and-set, skips out of office), create_deal, remove_from_list, notify_user to the record owner or chosen people (only if they see the record, hidden fields removed). Missing: create other records, copy to associated records, several branches | partial | M | M |
| `workflow-enroll-sequence` | Enroll in a sequence from a workflow. https://knowledge.hubspot.com/workflows/choose-your-workflow-actions | lib/crm-workflows.ts:65 enroll_in_sequence | have | - | - |
| `workflow-enrollment-history` | Each workflow and each record show enrolment history; records can be unenrolled. Sin URL confirmada | listWorkflowRunViews (workflow page, scoped to records the member sees, no action output; owners and admins get the per-action log from actionLog in lib/crm-workflow-rules.ts, without values) and listRecordEnrollments (Workflows card on contact, company and deal pages). W3: unenrollRun (status unenrolled, compare-and-set, the runner checks before each action) from the workflow history and the record card, owner/admin only. Scoped members don't see enrollments of workflows whose conditions look at another record | have | - | - |
| `workflow-on-off` | Turning a workflow off stops new enrolments; records can stay where they are and continue when it is turned on. Sin URL confirmada | resumeWaitingWorkflowRuns only resumes runs of enabled workflows; waiting runs keep next_position, branch and results | have | - | - |
| `lead-scoring` | Lead scoring with fit and engagement rules. Sin URL confirmada | lib/crm-scoring.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `round-robin` | Rotate records among owners. https://knowledge.hubspot.com/workflows/choose-your-workflow-actions | lib/crm-assignment.ts (from forms and sources) and the workflow action rotate_owner (lib/crm-workflows.ts) | have | - | - |
| `forms` | Forms that create contacts and route them. Sin URL confirmada | lib/crm-forms.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `ai-agents-in-workflows` | AI actions inside workflows. https://knowledge.hubspot.com/workflows/choose-your-workflow-actions | lib/crm-workflows.ts ai_step; carried over from the previous table, not re-verified in this pass | have | - | - |
| `notification-settings` | Each user sets notifications per topic and per channel (bell, email, desktop, mobile). https://knowledge.hubspot.com/user-management/how-to-set-up-user-notifications-in-hubspot | lib/crm-mention-notify.ts; no per-event preference found in lib/notifications.ts (grep only, not seen running) | partial | M | M |

### Reportes y analítica

| Fila | HubSpot | zerosoft hoy (código) | Estado | Se nota | Tamaño |
|---|---|---|---|---|---|
| `dashboards` | Dashboards made of reports, resized and rearranged. https://knowledge.hubspot.com/dashboards/manage-your-dashboards | lib/crm-dashboards.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `dashboard-sharing` | A dashboard is private, shared with everyone or with chosen users and teams, and can be emailed on a schedule. https://knowledge.hubspot.com/dashboards/manage-your-dashboards | No visibility or schedule columns in lib/crm-dashboards.ts and lib/crm-dashboards-schema.ts (grep only) | missing | L | S |
| `sales-analytics` | Sales analytics reports (deals created, won and lost, activities, funnel, velocity). https://knowledge.hubspot.com/reports/create-sales-reports-in-the-sales-analytics-suite | lib/crm-analytics.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `prebuilt-reports` | A report library with hundreds of ready reports by topic. Sin URL confirmada | lib/crm.ts:3463-3590 getCrmReports | partial | L | M |
| `custom-reports` | Custom report builder across objects. https://knowledge.hubspot.com/reports/create-reports-with-the-custom-report-builder | lib/crm-report-builder.ts, lib/crm-custom-reports.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `attribution-reports` | Attribution reports credit contact creation, deal creation and revenue to sources and interactions. https://knowledge.hubspot.com/reports/create-custom-reports | No attribution model in lib/crm-reports.ts, lib/crm-report-builder.ts or lib/crm-analytics.ts | missing | L | L |
| `forecast` | Forecast tool with categories and submissions. https://knowledge.hubspot.com/forecast/set-up-the-forecast-tool | lib/crm-forecast.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `quotas` | Goals per user and team. https://knowledge.hubspot.com/reports/create-sales-goals | lib/crm-quotas.ts; carried over from the previous table, not re-verified in this pass | have (distinto a propósito: called Quotas and set in Settings; HubSpot calls them Goals) | L | - |
| `deal-journey` | Deal funnel and journey reports. https://knowledge.hubspot.com/reports/create-sales-reports-in-the-sales-analytics-suite | lib/crm-stage-history.ts; carried over from the previous table, not re-verified in this pass | have | - | - |

### Administración y permisos

| Fila | HubSpot | zerosoft hoy (código) | Estado | Se nota | Tamaño |
|---|---|---|---|---|---|
| `teams-roles` | Users, teams and invitations. https://knowledge.hubspot.com/user-management/create-and-manage-teams | lib/roles.ts:11 four roles; crm_sales_teams (flat teams) | have | - | - |
| `record-visibility` | Permissions per object: view, edit and delete, each set to everything, team only, owned only or none, plus export, import and bulk delete, saved as permission sets. https://knowledge.hubspot.com/user-management/hubspot-user-permissions-guide | lib/crm-visibility.ts:19 one MEMBER_VISIBILITIES setting for the workspace; lib/roles.ts:11 | partial | H | L |
| `field-permissions` | Property permissions: view and edit access per property for users and teams (default properties included). https://knowledge.hubspot.com/properties/restrict-view-edit-access-for-properties | lib/crm-field-perms.ts. D3 (2026-11-21): the property list (GET /api/crm/custom-fields without an entity, Settings › Data) shows members only the definitions they have access to (visibleFieldDefinitions); built-in properties still cannot be restricted | partial | L | M |
| `team-hierarchy` | Teams can be nested (Enterprise) and a user has a main team plus extra teams. https://knowledge.hubspot.com/user-management/create-and-manage-teams | crm_sales_teams and crm_sales_team_members are flat (lib/crm-visibility.ts:60) | missing | L | S |
| `audit-log` | Account audit logs list who exported, deleted, imported or changed settings, with an export history page. https://knowledge.hubspot.com/account-management/view-and-export-account-activity-history | lib/crm.ts:433 property events; lib/crm-trash.ts; no CRM audit module among lib/*-audit.ts (board, chat, docs, groups, track) | partial | M | M |
| `data-quality` | The data quality command center reports duplicates, formatting issues, property insights and sync health. https://knowledge.hubspot.com/data-management/data-quality-command-center | lib/crm.ts:915 findDuplicateContacts, app/[locale]/app/crm/companies/duplicates/page.tsx | partial | L | M |

### Integraciones y API

| Fila | HubSpot | zerosoft hoy (código) | Estado | Se nota | Tamaño |
|---|---|---|---|---|---|
| `rest-api` | CRM API: objects, properties, associations, owners, pipelines, lists, search and batch endpoints. https://developers.hubspot.com/docs/api-reference/latest/crm/using-object-apis.md | app/api/v1/crm/{contacts,companies,deals,leads,objects,tasks,activities,products,quotes,pipelines,associations,tags,sequences,forms,email-templates} | partial | M | M |
| `outgoing-webhooks` | Webhook subscriptions for record creation, change, deletion and merge. https://developers.hubspot.com/docs/api-reference/latest/webhooks/guide.md | lib/webhooks.ts, lib/crm-hooks.ts; carried over from the previous table, not re-verified in this pass | have | - | - |
| `ui-extensions` | Apps add cards to record pages (UI extensions, CRM cards) and write custom events to the timeline. Sin URL confirmada | No extension point on record pages; the activities API writes the five built-in types only (app/api/v1/crm/activities) | missing | L | L |
| `app-marketplace` | App Marketplace with more than a thousand integrations. https://knowledge.hubspot.com/help-and-resources/a-guide-to-hubspots-navigation | lib/crm-apps.ts; carried over from the previous table, not re-verified in this pass | partial | L | L |
| `two-way-data-sync` | Data sync keeps HubSpot and another app in step in one or both directions, with field mappings, filters and conflict rules. https://knowledge.hubspot.com/integrations/connect-and-use-hubspot-data-sync | lib/crm-import-jobs.ts:16-24 (re-import updates through crm_external_ids); lib/groups-hubspot-sync.ts:1-25 syncs company properties for Lines only; lib/crm-hubspot-sync/ (S1: connection in CRM settings and a read-only preview; S2, lib/crm-hubspot-sync/inbound.ts: HubSpot → CRM import and incremental sync every minute with links, shadow and a per-field conflict rule; S3, lib/crm-hubspot-sync/outbound.ts: CRM → HubSpot write-back of properties, owner, pipeline and stage, new records and added associations through an outbox filled by triggers, off by default behind a preview, never deletes in HubSpot; missing: choosing the winning side, notes and tasks back to HubSpot, webhooks; checked against the fake portal only, 2026-11-21) | partial | H | L |
| `suite-integrations` | Built-in link with scheduling, chat, agents and automation. https://knowledge.hubspot.com/help-and-resources/a-guide-to-hubspots-navigation | lib/crm-integrations.ts; carried over from the previous table, not re-verified in this pass | better | - | - |

### Navegación, nombres y valores por defecto

| Fila | HubSpot | zerosoft hoy (código) | Estado | Se nota | Tamaño |
|---|---|---|---|---|---|
| `nav-structure` | The left navigation groups tools under CRM, Marketing, Content, Sales, Commerce, Service, Data Management, Automation and Reporting. https://knowledge.hubspot.com/help-and-resources/a-guide-to-hubspots-navigation | components/app/sidebar-nav.ts:579-629 | partial | M | S |
| `default-pipeline` | The default Sales pipeline has seven stages with preset probabilities. https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines | lib/seed.ts:20-22, :34-40 | partial | M | S |
| `default-columns` | Index pages open with a default set of columns per object. https://knowledge.hubspot.com/records/view-and-filter-records | components/crm/ContactsTable.tsx:71-84, DealsTable.tsx:78-92, CompaniesTable.tsx:60-74 (HubSpot defaults not verified against a live portal) | partial | L | S |
| `settings-structure` | Settings › Objects has a page per object with Setup, Associations, Pipelines, Lifecycle stage and Record customization tabs; Properties and Users & Teams are separate pages. https://knowledge.hubspot.com/object-settings/customize-records | lib/crm-settings-tabs.ts:6, :21-34 | partial | M | S |
| `naming-terms` | HubSpot vocabulary: properties, goals, recycle bin, task queues, segments, original source. https://knowledge.hubspot.com/help-and-resources/a-guide-to-hubspots-navigation | messages/en/crm.json keys settings.customFields, quotas, trash, queue, analytics, tags | partial | L | S |

### Mobile y offline

| Fila | HubSpot | zerosoft hoy (código) | Estado | Se nota | Tamaño |
|---|---|---|---|---|---|
| `native-mobile-app` | Native iOS and Android apps with offline access, business card scanner and caller ID. https://www.hubspot.com/products/mobile | PWA; carried over from the previous table, not re-verified in this pass | partial | M | L |
| `mobile-lists` | Records and the deal board on a phone. https://www.hubspot.com/products/mobile | tests/e2e/crm-mobile.spec.ts; carried over from the previous table, not re-verified in this pass | have | - | - |

### IA

| Fila | HubSpot | zerosoft hoy (código) | Estado | Se nota | Tamaño |
|---|---|---|---|---|---|
| `ai-email-draft` | AI email drafts. Sin URL confirmada | carried over from the previous table, not re-verified in this pass | have | - | - |
| `ai-record-summary` | AI record summaries. Sin URL confirmada | carried over from the previous table, not re-verified in this pass | have | - | - |
| `ai-assistant` | Assistant that queries and edits the CRM. Sin URL confirmada | carried over from the previous table, not re-verified in this pass | have | - | - |
| `ai-prospecting-agents` | Prospecting and data agents. Sin URL confirmada | carried over from the previous table, not re-verified in this pass | have | - | - |
| `meeting-call-summaries` | Notetaker with call and meeting summaries. Sin URL confirmada | carried over from the previous table, not re-verified in this pass | partial | L | M |

