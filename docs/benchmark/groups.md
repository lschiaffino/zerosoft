# Benchmark: Groups vs Periskope (WhatsApp para equipos, con foco en grupos)

Fecha: 2026-10-22. Base: `main` en `1689419`. Referencia: Periskope Starter (USD 25 por licencia al mes) y Pro (USD 35 por licencia al mes, precios mensuales desde el 1/9/2026).

## Cómo se hizo

- **Competidor:** sitio, precios, docs completos (`docs.periskope.app`, incluida la referencia de API, webhooks y MCP), blog de lanzamientos (2024 a 2026), ficha en el marketplace de HubSpot y reseñas de G2. Las fuentes están al final.
  - Periskope no publica un changelog aparte: las novedades salen como "Launch Week" en el blog.
  - Capterra y Product Hunt no tienen ficha de Periskope (los resultados eran de "Periscope", otro producto).
  - G2 devolvió 403 al leerlo directo. Las críticas se tomaron del resumen de pros y contras que muestra el buscador.
- **Nuestra app:** Groups todavía no existe en el código. No hay `app/[locale]/app/groups` ni `lib/groups-*.ts`. Lo que hay de WhatsApp en la suite:
  - links `wa.me` con resultado en el CRM (`components/crm/PhoneTouch.tsx`, `lib/crm-calls.ts`);
  - timeline de contacto y empresa en el CRM (`components/crm/Timeline.tsx`);
  - disparadores y acciones en Flow, agentes con herramientas en Agents, issues en Track.
- **Limitaciones:** no hay recorrido en navegador porque no hay app que recorrer. Las columnas "zerosoft" marcan **falta** salvo cuando otra app de la suite ya cubre la capacidad. La columna "Plan" dice qué haría Groups para igualar o superar.

## Capacidades por área

Leyenda: **tiene**, **parcial**, **falta**, **mejor** (mejor que el incumbente).

### 1. Conexión de números (0/10)

| Capacidad (Periskope) | zerosoft | Nota |
|---|---|---|
| Conectar un número por QR como dispositivo vinculado | falta | Periskope sincroniza todos los chats y grupos del número al vincularlo |
| Varios números en una sola bandeja (dice "más de 1000") | falta | Cada chat muestra qué número de la org participa. Si hay varios, se elige desde cuál responder |
| Reiniciar, resincronizar y borrar un número | falta | También por API (`/phones`) |
| Guía de calentamiento de números nuevos y buenas prácticas anti ban | falta | |
| Números de la API oficial de WhatsApp (WABA) | falta | Periskope **no los acepta**. Es un hueco de ellos: Groups puede ofrecer las dos vías |

### 2. Bandeja compartida (0/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Chats 1:1 y grupos en la misma lista | falta | |
| Ver y responder sin acceso al teléfono | falta | El mensaje sale desde el número de la org. Adentro se ve el email de quien lo mandó |
| Asignar chat a una persona | falta | Manual o por regla (round-robin) |
| Notas privadas con @menciones | falta | Pestaña "Private Note" al lado de la de WhatsApp |
| Respuestas rápidas con `/comando` | falta | Solo texto. Las docs no mencionan variables ni adjuntos |
| Mensajes programados y recurrentes por chat | falta | Diario, semanal o mensual, con fecha de fin. Página de logs |
| Fijar, archivar, marcar leído o no leído | falta | También en masa |
| Reaccionar, reenviar, editar, borrar y fijar mensajes | falta | Todo disponible por API |
| Llamadas de voz 1:1 con grabación, transcripción y resumen AI | falta | Experimental. Sin llamadas grupales ni video |
| Estado en línea y turnos por agente | falta | |
| Traducción de mensajes | falta | |

### 3. Gestión de grupos (0/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Crear grupo (UI y API) | falta | `POST /chats/create` |
| Plantillas de grupo con participantes predefinidos | falta | Lanzado en mayo de 2025 |
| Crear muchos grupos de una vez (CSV) | falta | Periskope no lo documenta. Se resuelve con API o workflows |
| Agregar miembros a muchos grupos a la vez | falta | Máximo 2.000 miembros por grupo. Avisa que agregar muchos desconocidos rápido puede banear el número |
| Quitar miembros en masa | falta | Hasta 200 por vez. El dueño del grupo no se puede quitar |
| Promover y degradar admins en masa | falta | Requiere que el número conectado sea admin |
| Ajustes del grupo: nombre, descripción, foto, solo admins editan, solo admins escriben, solo admins agregan, aprobación de ingreso, mensajes temporales | falta | `POST /chats/{chat_id}/settings` |
| Link de invitación y regenerarlo | falta | Recomendado sobre agregar por número, porque la privacidad de WhatsApp bloquea altas directas |
| Aceptar invitación y salir de un grupo | falta | Por API |
| Refrescar nombre, miembros e ícono desde WhatsApp | falta | |
| Logs de las acciones en masa con estado en vivo | falta | |
| Analíticas por grupo | falta | Filtro por chat o grupo en las métricas de equipo |

### 4. Organización: etiquetas, propiedades y contactos (1/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Etiquetas con color en chats, contactos y tickets | falta | Las etiquetas también definen quién ve cada chat (ver Permisos) |
| Filtros por etiqueta y listas guardadas de chats | falta | Las listas guardadas se usan como audiencia de envíos masivos |
| Propiedades propias en chats y grupos | falta | Texto, fecha, archivo, select, multi-select y dropdown dependiente de hasta 3 niveles |
| Propiedades propias en tickets, con obligatorias al cerrar | falta | |
| Subir etiquetas y propiedades en masa | falta | |
| Contactos: crear, editar, etiquetar, verificar si un número tiene WhatsApp | parcial | El CRM tiene contactos y empresas con campos propios. Falta el vínculo con el chat |
| Contactos internos (no se marcan ni los atiende la AI) | falta | |

### 5. Tickets y tareas (0/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Ticket desde un mensaje (clic derecho) | falta | Toma el texto y queda ligado al chat |
| Ticket por reacción con emoji | falta | Regla "New Reaction Added": crea ticket o adjunta el mensaje al último ticket abierto |
| Ticket automático por regla o por AI | falta | |
| Estados Open, In Progress, Closed | falta | |
| Prioridad Low / Medium / High / Urgent, vencimiento, asignado, etiquetas | falta | Track ya tiene issues con estado, prioridad y asignado: se puede reusar |
| Tareas y recordatorios desde el chat | falta | |
| Historial de auditoría por ticket | falta | |

### 6. Mensajes sin responder, SLA y alertas (0/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| La AI marca como "flagged" las preguntas de contactos externos | falta | Usa Google Vertex para separar preguntas de comentarios. Se puede ajustar con reglas en texto |
| Se desmarca al responder, al crear ticket o a mano | falta | Dos modos: una respuesta desmarca todo el chat, o solo el mensaje respondido |
| Primera respuesta medida solo si se responde desde Periskope | falta | Lo que se responde desde el teléfono no cuenta |
| Email cuando se vence un SLA | falta | Plantilla de regla. Las docs no hablan de horario laboral para pausar el SLA |
| Reenviar mensajes de contactos clave a una persona | falta | |

### 7. Envíos masivos (0/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Envío a grupos, chats o contactos | falta | Destinatarios por búsqueda, CSV o lista guardada |
| Texto, imagen, video, documento, encuestas y variables | falta | |
| Programar y repetir envíos | falta | |
| Demora configurable entre mensajes | falta | Para bajar el riesgo de ban |
| Varios números de salida o "cualquier número" | falta | Marca "faulty chat" si ningún número llega al contacto |
| Plantillas de mensaje | falta | |
| Logs en vivo por mensaje | falta | |
| Créditos de envío masivo | falta | 3.000 por licencia al mes en todos los planes |

### 8. Automatización (3/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Reglas con condiciones AND/OR anidadas (hasta 2 niveles) y acciones con demora | parcial | Flow tiene condiciones y esperas. Le faltan los disparadores de WhatsApp |
| 14 disparadores: chat creado, etiqueta de chat, reacción, mensaje recibido / editado / borrado / marcado / desmarcado, ticket creado / actualizado / etiquetado / cerrado, tarea creada / asignada | falta | Ver Fuentes (triggers) |
| 12 acciones: enviar, reenviar, marcar, desmarcar y borrar mensaje, crear / asignar / cerrar ticket, etiquetar ticket o chat, asignar chat, mandar email | parcial | Flow manda email y crea cosas en la suite. Faltan las acciones sobre WhatsApp |
| Respuestas automáticas por palabra clave y fuera de horario | falta | |
| Asignación automática round-robin | falta | Chat ya tiene round-robin en su bandeja web |
| Límite de reglas | **mejor** | Periskope Pro trae 2 reglas activas por licencia y cobra USD 50 al mes por 25 más. Flow no limita flujos |

### 9. AI (2/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Resumen del chat a pedido (por ejemplo, la última semana) | falta | |
| Redactar, pulir y traducir respuestas | falta | |
| Dictado por voz | falta | |
| Agente AI que responde con FAQs, documentos y fuentes externas | parcial | Agents responde con Docs y herramientas. Falta conectarlo a WhatsApp |
| Herramientas propias del agente (APIs) y conectores | parcial | Agents ya llama herramientas con aprobación humana |
| Autoentrenamiento con revisión de respuestas aprendidas | falta | |
| Deriva a una persona y se pausa cuando responde un humano | parcial | Existe en Chat y Agents, no en WhatsApp |
| Asistente de la org que actúa sobre todos los chats con una etiqueta | falta | |
| Créditos AI | **mejor** | Periskope da 5.000 por licencia al mes solo en Pro y vende 10.000 más a USD 25. Nosotros usamos la clave del AI Gateway de cada workspace |

### 10. Integraciones, API y MCP (2/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| HubSpot: vincular chat a contacto o empresa, loguear mensajes nuevos, tickets, mandar WhatsApp desde un workflow | parcial | Nuestro CRM es nativo: no hace falta integrar. Falta el vínculo chat ↔ registro. La ficha de HubSpot de Periskope tiene una sola reseña (1 estrella) que dice que no funcionaba |
| Zoho CRM, Zoho Desk, Freshdesk, Google Sheets, Zapier | falta | |
| Slack (avisos de tickets) | falta | |
| API REST con ~100 endpoints y SDK en TypeScript | falta | Ver la lista en la sección de API |
| Webhooks (20 eventos) | falta | |
| Servidor MCP con 56 herramientas | falta | |

### 11. Permisos y privacidad (2/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Roles Admin y Member | parcial | La suite tiene workspace de equipo. Falta el rol por app |
| Acceso por etiqueta: un Member ve solo los chats con sus etiquetas | falta | Es la forma de Periskope de tener chats "privados" por persona |
| Ocultar números de teléfono (masking) | falta | |
| Privacidad de media | falta | |
| Logs de auditoría por chat | falta | |
| GDPR e ISO 27001 | falta | Declarado por Periskope en su sitio |

### 12. Reportes (0/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Chats activos, mensajes entrantes y salientes, marcados, mediana de primera respuesta | falta | |
| Tickets abiertos, en curso, sin asignar, tiempo de resolución | falta | Gráficos de 7 días |
| Por agente: chats asignados, mensajes, tickets, respuestas a marcados, tiempo de respuesta, horas en línea | falta | |
| Filtros por fecha, etiqueta y grupo | falta | |
| Export de chats, mensajes, tickets y uso | falta | |

### 13. Mobile y escritorio (0/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| App mobile | falta | Relanzada en marzo de 2026 |
| Consola de escritorio rediseñada | falta | Marzo de 2026 |
| Extensión de Chrome | falta | No encontramos una de Periskope. Trabaja como app web propia |

## Resumen de puntajes

| Área | Puntaje |
|---|---|
| Conexión de números | 0 |
| Bandeja compartida | 0 |
| Gestión de grupos | 0 |
| Organización | 1 |
| Tickets y tareas | 0 |
| Sin responder y SLA | 0 |
| Envíos masivos | 0 |
| Automatización | 3 |
| AI | 2 |
| Integraciones, API y MCP | 2 |
| Permisos y privacidad | 2 |
| Reportes | 0 |
| Mobile y escritorio | 0 |
| **Paridad global con Periskope** | **8%** (promedio simple). Lo poco que suma viene de CRM, Flow, Agents y Track |

## Precios de Periskope

| | Starter | Pro | Enterprise |
|---|---|---|---|
| Precio mensual por licencia | USD 25 (antes 20) | USD 35 (antes 30) | A medida, mínimo 50 usuarios o teléfonos |
| Precio anual por licencia y mes | USD 15 | USD 25 | A medida |
| Teléfonos | El primero incluido, cada uno más cuesta una licencia | Igual | A medida |
| Créditos de envío masivo | 3.000 por licencia al mes | 3.000 | 3.000 |
| Créditos AI | No dice | 5.000 por licencia al mes | 5.000 |
| Reglas de automatización | No dice | 2 por licencia | No dice |

Extras: AI Pack USD 25 (10.000 créditos), Rules Pack USD 50 al mes (25 reglas), Bulk Message Pack USD 60 (10.000 envíos), onboarding guiado USD 200, Support Pack USD 300 (4 llamadas). La ficha de HubSpot menciona 14 días de prueba.

## API pública de Periskope

Base `https://api.periskope.app/v1`. Autenticación con la API key en `authorization` y el número que actúa en `x-phone`.

- **Chats:** listar, ver por id, mensajes del chat, notas privadas del chat, notificaciones del chat, listar todos los mensajes y todas las notificaciones, actualizar chat, actualizar etiquetas, marcar leído, cambiar acceso, logs de auditoría, ajustes de AI del chat.
- **Grupos:** crear grupo, nuevo link de invitación, agregar participante, quitar participante, promover a admin, degradar a miembro, ajustes del grupo, aceptar invitación, salir del grupo.
- **Mensajes:** enviar, enviar síncrono, broadcast, borrar broadcast, borrar, editar, reenviar, ver, reaccionar, fijar, estado de entrega, colas (listar, salud, purgar).
- **Programados:** listar, crear, ver, actualizar, borrar, listar ejecuciones.
- **Media:** migrar URL (una o en lote).
- **Contactos:** ver por id, listar, actualizar, actualizar etiquetas, crear, verificar si existe en WhatsApp.
- **Tickets:** ver, listar, crear, actualizar, logs de auditoría.
- **Propiedades propias:** listar, ver, crear, actualizar, actualizar opciones, borrar.
- **Tareas:** ver, listar, crear, actualizar.
- **Colas:** jobs, estado de broadcast, estado de cola, purgar.
- **Teléfonos:** ver, listar, QR, reset, reiniciar, resincronizar, actualizar, crear, borrar.
- **Notas privadas:** crear, ver, listar.
- **Reacciones:** listar.
- **Base de conocimiento:** listar, FAQ (ver, crear, actualizar, borrar), documento (ver, crear, borrar).
- **Miembros:** invitar, cambiar acceso, borrar.
- **AI:** disparar una respuesta AI.
- **Webhooks:** listar, crear, ver, actualizar, borrar. Eventos: `chat.created`, `chat.notification.created`, `chat.custom-properties.updated`, `message.created`, `message.updated`, `message.deleted`, `message.ack.updated`, `message.ticket.attached`, `message.flagged`, `message.unflagged`, `note.created`, `reaction.created`, `reaction.updated`, `ticket.created`, `ticket.updated`, `ticket.deleted`, `org.phone.updated`, `org.phone.connected`, `org.phone.disconnected`, `org.phone.qr`.

## Lo que dicen las reseñas

Hay pocas reseñas públicas. G2 tiene 4 (promedio 4,8) y el marketplace de HubSpot una sola.

1. **Se satura con muchos números o grupos grandes.** La interfaz se siente cargada al manejar muchos números o grupos con mucha gente (G2).
2. **Curva de aprendizaje.** Lleva tiempo entender todas las opciones y ajustes, y cuesta navegarlo al principio (G2, dos reseñas).
3. **Reportes lentos o que hay que corregir a mano** (G2).
4. **Faltan ayudas dentro de la app** para el onboarding (G2). Periskope vende onboarding guiado y llamadas de soporte aparte.
5. **La integración con HubSpot falló** para el único usuario que la reseñó (HubSpot Marketplace, junio de 2025).

A esto se suma lo que Periskope dice en sus propias docs: el riesgo de ban por usar un cliente no oficial, agregar desconocidos a grupos o mandar masivos, y que lo respondido desde el teléfono no cuenta en la primera respuesta.

## Cómo lo vamos a hacer mejor

| # | Ventaja | Qué hace Periskope | Qué haría Groups |
|---|---|---|---|
| 1 | Grupo en el registro del CRM | Integración con HubSpot que loguea solo mensajes nuevos y tiene una reseña de 1 estrella | Cada grupo se vincula a una empresa o contacto del CRM. Los mensajes, tickets y resúmenes aparecen en su timeline, también el historial |
| 2 | Flow como motor de reglas | 14 disparadores y 12 acciones, 2 reglas por licencia en Pro | Los mismos eventos de WhatsApp como disparadores de Flow y acciones de grupo (crear, agregar, quitar, ajustes, enviar) dentro de cualquier flujo, sin tope de reglas |
| 3 | Agents en los grupos | Agente propio con FAQs y créditos AI por licencia | Un agente de Agents responde en el grupo con Docs y herramientas de la suite (Track, Cal, CRM), con aprobación humana cuando hace falta |
| 4 | Resumen AI del grupo | Resumen a pedido en el panel derecho | Resumen diario o semanal por grupo, con pendientes y preguntas sin responder, que también va al timeline del CRM |
| 5 | Bandeja de teclado al estilo Linear | Las reseñas hablan de interfaz cargada y curva de aprendizaje | `J`/`K`, `E` para resolver, `A` para asignar, `L` para etiquetar, `T` para ticket, Cmd+K para grupos, contactos y mensajes |
| 6 | Código abierto y self-host | SaaS cerrado | AGPL, se puede instalar en un servidor propio y los datos quedan del cliente |
| 7 | Elección de proveedor | Solo QR, rechaza la API oficial | Meta Cloud API oficial para 1:1 y plantillas, y un puente WAHA o Evolution API para los grupos, que la API oficial no cubre del todo. Se elige por número |
| 8 | Tickets en Track | Tickets propios con 3 estados | Un ticket de grupo es un issue de Track, con su ciclo, prioridades y board |

## Top 10 gaps para la primera versión

| # | Gap | Por qué importa | Esfuerzo |
|---|---|---|---|
| 1 | Conectar números (QR por WAHA/Evolution y Meta Cloud API) | Sin esto no hay producto | L |
| 2 | Bandeja compartida de chats y grupos con asignación y notas | Es la pantalla donde vive el equipo | L |
| 3 | Mensajes sin responder marcados y primera respuesta | Es la razón principal para comprar Periskope en grupos con clientes | M |
| 4 | Tickets desde mensaje y por emoji, como issue de Track | El flujo de soporte en grupos depende de esto | M |
| 5 | Acciones de grupo en masa (agregar, quitar, admins, ajustes, link) | Es lo que diferencia una herramienta de grupos de un inbox común | M |
| 6 | Vínculo grupo ↔ empresa del CRM con timeline | Nuestra ventaja más clara frente a Periskope | M |
| 7 | Envíos masivos programados a grupos con demora y logs | Muy usado por comunidades y equipos de cuentas | M |
| 8 | Etiquetas, propiedades propias y acceso por etiqueta | Ordenar cientos de grupos y limitar qué ve cada persona | M |
| 9 | Disparadores y acciones de WhatsApp en Flow | Reemplaza las reglas de Periskope | M |
| 10 | Reportes de respuesta y tickets por agente y por grupo | Lo piden los líderes de soporte y de cuentas | M |

Fuera del top 10: resumen AI del grupo, Agents en grupos, plantillas de grupo, mensajes recurrentes, masking de números, API y webhooks, MCP, llamadas, app mobile.

## Bugs encontrados

No aplica: Groups todavía no tiene código.

## Fuentes

- Sitio y funciones: https://periskope.app/
- Precios: https://periskope.app/pricing
- Cambio de precios desde el 1/9/2026: https://periskope.app/blog/upcoming-changes-to-periskope-pricing-effective
- Blog y Launch Weeks (2024 a 2026): https://periskope.app/blog
- Índice completo de docs: https://docs.periskope.app/llms.txt
- Conectar WhatsApp: https://docs.periskope.app/get-started/connect-whatsapp
- Bandeja multinúmero: https://docs.periskope.app/features/multi-number-inbox
- Roles y acceso: https://docs.periskope.app/features/team-access-roles
- Masking: https://docs.periskope.app/features/number-masking-privacy
- Etiquetas: https://docs.periskope.app/features/labels
- Propiedades propias: https://docs.periskope.app/features/custom-properties
- Respuestas rápidas: https://docs.periskope.app/features/quick-replies
- Notas privadas: https://docs.periskope.app/features/private-note
- Programados y recurrentes: https://docs.periskope.app/features/recurring-scheduled-messages
- Acciones en masa: https://docs.periskope.app/features/bulk-actions
- Acciones de grupo en masa: https://docs.periskope.app/features/member-management
- Plantillas de grupo: https://periskope.app/blog/whatsapp-group-creation-templates
- Envíos masivos: https://docs.periskope.app/features/bulk-message
- Llamadas: https://docs.periskope.app/features/calling
- Métricas: https://docs.periskope.app/features/workspace-metrics
- Tickets: https://docs.periskope.app/tickets/create-ticket
- Tickets por emoji: https://docs.periskope.app/tasks-and-reminders/emoji-ticketing
- Marcado con AI: https://docs.periskope.app/ai/flagging
- Resúmenes y respuestas AI: https://docs.periskope.app/ai/summaries
- Agente AI: https://docs.periskope.app/ai/agent/overview
- MCP: https://docs.periskope.app/ai/mcp
- Reglas de automatización: https://docs.periskope.app/integrations/automation-rules/components
- Escalamiento y SLA: https://docs.periskope.app/automated-escalation
- Workflows, disparadores y acciones: https://docs.periskope.app/integrations/workflows/triggers, https://docs.periskope.app/integrations/workflows/actions
- HubSpot: https://docs.periskope.app/integrations/hubspot, https://ecosystem.hubspot.com/marketplace/listing/periskope
- API: https://docs.periskope.app/api-reference/introduction, https://docs.periskope.app/api-reference/chat/update-group-settings
- Reseñas: https://www.g2.com/products/periskope/reviews

## Estado después de la primera versión (2026-10-23)

La primera versión de Groups ya está en el código (`app/[locale]/app/groups`, `lib/groups*.ts`, migración `070_groups`). La evaluación al día, fila por fila y con estados honestos, vive en `content/feature-parity/groups.ts` y se muestra en la página de producto. Las columnas de arriba quedan como la foto previa a construir.

Lo que quedó afuera de esta versión está en `research/ideas.json` (producto `groups`): asignación round-robin, acceso por etiqueta, mensajes recurrentes, plantillas de grupo, ajustes completos del grupo, @menciones en notas, marcado con AI, editar y reenviar mensajes, más eventos de webhook y endpoints de grupos, listas guardadas y ocultar teléfonos.
