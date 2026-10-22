# Benchmark: Chat vs Intercom (Messenger + Inbox), con Crisp como referencia para equipos chicos

Fecha: 2026-10-22. Base: `main` en `644c85b`.

## Cómo se hizo

- **Competidor:** páginas públicas de precios, producto, centro de ayuda y changelog de Intercom (marzo a octubre de 2026) y de Crisp. Las fuentes están al final. Contexto: Intercom pasó a llamarse Fin en mayo de 2026 y el helpdesk conserva el nombre Intercom. Salesforce anunció la compra en junio.
- **Nuestra app:** lectura del código (`lib/chat-*.ts`, `components/chat/*`, `app/api/chat/**`, `app/api/v1/chat/**`, `app/api/chat/widget.js`) y recorrido con Playwright contra un build de producción en DEMO_MODE:
  - crear un widget con `C`;
  - recorrer las pestañas del widget, las reglas, las respuestas guardadas y el SLA;
  - embeber el widget en una página anfitriona y mandar un mensaje como visitante;
  - encontrarlo en la bandeja con `/`, responder con una respuesta guardada (`/atajo`), dejar una nota interna y resolver;
  - ver la respuesta y la encuesta CSAT del lado del visitante;
  - descargar el transcript;
  - probar la selección múltiple, Personas, Reportes y Ajustes;
  - abrir la bandeja a 390 px en modo oscuro.
- **Limitaciones:**
  - La máquina estaba saturada con 17 builds en paralelo y el recorrido corrió contra un servidor compartido (puerto 3270), así que este informe no da números de velocidad.
  - Sin clave del AI Gateway, el bot AI cae al bot por palabras clave. El camino con modelo se evaluó leyendo el código y los tests (`tests/unit/chat-bot-ai.test.ts`, `chat-api-agent-approvals.test.ts`).
- `docs/feature-map.md` está desactualizado en Chat. Desde entonces se construyeron:
  - API pública y webhooks;
  - selección múltiple, merge, export de transcript;
  - atributos de conversación, edición y borrado de notas;
  - estado ausente;
  - verificación de identidad;
  - widget localizado y contexto del visitante;
  - aviso por email al visitante offline.

## Capacidades por área

Leyenda: **tiene**, **parcial**, **falta**, **mejor** (mejor que el incumbente).

### 1. Núcleo: bandeja, conversaciones y modelo de datos (6/10)

| Capacidad (Intercom) | zerosoft | Nota |
|---|---|---|
| Messenger web embebible | tiene | `widget.js`, un script con color, posición, bienvenida, idioma en/es/pt, adjuntos y pestaña Ayuda |
| Bandeja compartida con estados abierto / pendiente / pospuesto / resuelto | tiene | Más prioridad y filtros Míos / Sin asignar / De cualquiera |
| Prioridad de 5 niveles | parcial | Hay prioridad, con menos niveles |
| Tags | tiene | Normalizados, con conteo por workspace |
| Atributos de conversación (requeridos al resolver) | tiene | Texto, número, select, booleano |
| Atributos de persona y empresa | parcial | Visitante con email, nombre, notas y contexto de página. No hay empresas. El CRM cubre parte con el vínculo a contacto |
| Merge de conversaciones duplicadas | tiene | |
| Tickets (cliente, back-office, tracker) | falta | No se puede crear un issue de Track desde una conversación ni agrupar muchas conversaciones bajo un problema |
| Portal del cliente / historial de conversaciones del visitante | falta | Al resolver, el widget vacía el hilo (ver Bugs). Ya está en el backlog |
| Formulario previo al chat | tiene | |
| CSAT al resolver | tiene | 1 a 5 con comentario, se ve en el widget |
| Horario de atención y mensaje de ausencia | tiene | |
| Verificación de identidad (HMAC) | tiene | Mismo esquema que el `user_hash` de Intercom |

### 2. Colaboración (5/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Asignar a una persona | tiene | Selector en el encabezado de la conversación |
| Notas internas con @menciones | tiene | La mención notifica. Las notas se editan y se borran |
| Editar y borrar mensajes propios | tiene | El visitante ve "editado" |
| Estado ausente que saca del round-robin | tiene | |
| Equipos y bandejas por equipo | falta | Solo se asigna a personas. No hay "Soporte N2" ni "Ventas" |
| Detección de colisión (quién está mirando o escribiendo) | falta | Dos personas pueden contestar lo mismo |
| Seguir una conversación sin ser asignado | falta | Intercom lo lanzó el 21/10/2026 |
| Vistas guardadas en la barra lateral | falta | |

### 3. Automatización (6/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Reglas de asignación | tiene | Por palabra clave, por franja horaria, por defecto y round-robin, ordenables |
| SLA por prioridad, con avisos de vencimiento | tiene | En Intercom el SLA es del plan Expert ($132/seat) |
| Macros (respuesta + acciones) | tiene | Una respuesta guardada puede cambiar el estado, asignar, posponer y poner tags |
| Variables en respuestas (`{{name}}`) | falta | `{{name}}` se envía literal (probado) |
| Workflows visuales | parcial | Flow tiene disparadores del ciclo de vida del chat. No hay un builder dentro de Chat |
| Ruteo por habilidades | falta | |
| Bot que deriva a un humano | tiene | AI con Docs y respuestas guardadas, o un agente de Agents con herramientas |

### 4. Canales, integraciones y API (3/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Chat web | tiene | |
| Email entrante en la bandeja | falta | Ya hay un aviso saliente por email al visitante offline. Responder ese email no vuelve a la conversación. El backlog cubre la parte entrante |
| WhatsApp, Instagram, Messenger, SMS | falta | Intercom los tiene en todos los planes y Crisp desde Essentials ($95/mes) |
| Teléfono y voz | falta | |
| API REST | tiene | `/api/v1/chat/conversations` con listar, ver, responder, asignar, resolver y reabrir |
| Webhooks | parcial | Tres eventos: `chat.message.created`, `chat.conversation.assigned`, `chat.conversation.resolved`. Faltan conversación creada, tag y CSAT |
| Integración con el CRM | **mejor** | Crea el contacto y registra la conversación en la línea de tiempo, nativo y sin app de terceros |
| Integración con Cal, Track y Flow | parcial | Va por Agents y Flow. No hay acciones directas desde la conversación |
| Tienda de apps (450+ en Intercom) | falta | |

### 5. Administración y permisos (4/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Workspace de equipo | tiene | Todo el team ve todos los widgets |
| Roles y permisos por bandeja | falta | |
| Multimarca (varios widgets) | parcial | Hay varios widgets con nombre y color. No hay centro de ayuda por marca |
| SSO | parcial | Es del login de la suite, fuera de Chat |

### 6. Reportes (4/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Conversaciones, primera respuesta, resolución y CSAT por rango y por agente | tiene | Con CSV |
| Bot contra humano, tasa de resolución del bot | falta | La primera respuesta del bot no cuenta (se ve un guion) y no hay una métrica de deflexión |
| Por tag, por widget, horas pico | falta | |
| Cumplimiento de SLA | falta | Los vencimientos se ven en la bandeja, sin histórico |
| Reportes personalizados | falta | |

### 7. Mobile y offline (3/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Bandeja web a 390 px | tiene | Sin scroll horizontal y bien en modo oscuro (probado) |
| Apps nativas para agentes | falta | Intercom y Crisp tienen iOS y Android. Crisp además tiene escritorio |
| Push al agente | falta | No hay service worker ni Web Push |
| SDK mobile del Messenger | falta | |
| Aviso por email al visitante que se fue | tiene | `offline_email_minutes` por widget |

### 8. AI (5/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Agente AI que responde con tu contenido | tiene | Bot AI (Docs + respuestas guardadas, BM25) o un agente de Agents con herramientas y aprobación humana |
| Fallback sin AI | **mejor** | Bot por palabras clave. Intercom no tiene un camino sin Fin |
| Copilot / redactar, resumir, reformular y traducir para el agente | falta | Ya está en el backlog |
| Traducción en tiempo real | falta | |
| Insights AI (temas, CX score) | parcial | Agents tiene temas por palabra clave. Chat no tiene ninguno |

### 9. Centro de ayuda (6/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Centro de ayuda público con búsqueda y votos | tiene | Publicado desde Docs en `/h/<handle>` |
| Artículos dentro del widget | tiene | Pestaña Ayuda |
| Multilingüe y privado | falta | |
| Dominio propio en Cloud | falta | |

### 10. Proactivo y outbound (0/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Mensajes proactivos (por URL, tiempo en página o segmento) | falta | Intercom los incluye en todos los planes y Crisp tiene triggers desde Mini |
| Banners, tours, encuestas, posts, checklists | falta | |
| Campañas por email | falta | |

### 11. Importar y exportar (4/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Transcript en texto o JSON, con o sin notas, y por email al visitante | tiene | |
| CSV de reportes | tiene | |
| Importar desde Intercom o Crisp | falta | |
| Export masivo de conversaciones | parcial | Solo por API |

### 12. Tiempo real y fiabilidad (4/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Mensajes en tiempo real | parcial | Todo es polling: el widget cada 5 s, la conversación cada 3 s y la lista cada 10 s. Ya está en el backlog |
| Escribiendo y leído | tiene | |
| Rate limits en las rutas públicas | tiene | |

### 13. Pulido de UX (7/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| Atajos | tiene | `C` crea, `/` busca, `J`/`K` navega, Enter envía, Shift+Enter hace salto de línea y `/` en el compositor abre las respuestas |
| Cmd+K | parcial | Encuentra widgets. No encuentra conversaciones ni personas |
| Estados vacíos y de error | tiene | |
| Selección múltiple | tiene | Asignar, tag, posponer y resolver |
| Contexto del visitante | **mejor** | Página, referrer, navegador, idioma, form y contacto CRM en un panel. En Intercom el equivalente es un add-on o una app |

## Resumen de puntajes

| Área | Puntaje |
|---|---|
| Núcleo | 6 |
| Colaboración | 5 |
| Automatización | 6 |
| Canales, integraciones y API | 3 |
| Administración y permisos | 4 |
| Reportes | 4 |
| Mobile y offline | 3 |
| AI | 5 |
| Centro de ayuda | 6 |
| Proactivo y outbound | 0 |
| Importar y exportar | 4 |
| Tiempo real | 4 |
| UX | 7 |
| **Paridad global con Intercom** | **44%** (promedio simple) |

Frente a Crisp, lo que un equipo chico usa de verdad (bandeja compartida, widget, bot, base de conocimiento, triggers, omnicanal, apps mobile), la paridad estimada es de un 55%.

## Paridad de UX en el flujo principal

| Flujo | zerosoft | Intercom |
|---|---|---|
| Crear el widget y obtener el snippet | `C`, escribir el nombre, Enter: 3 pasos y el snippet queda arriba | Messenger ya existe al crear el workspace; instalarlo se hace desde Settings |
| Responder con una respuesta guardada | `/atajo`, Enter, Enter: 3 teclas | `#` o Cmd+K de macros: parecido |
| Nota interna | Clic en la pestaña "Nota interna", escribir, Enter | Cmd+Shift+N o la pestaña Note |
| Resolver | Un clic en "Resolver" en el encabezado | Cmd+Shift+Y |
| Pasar a la siguiente conversación | `J`/`K` | `J`/`K` y flechas |

**Lo que falta en el uso diario:**

- No hay atajo de teclado para resolver ni para cambiar a nota.
- El avatar del visitante anónimo es un "?".
- Las respuestas llegan con hasta 5 segundos de demora en el widget, por el polling.

## Top 10 gaps (impacto para un equipo chico que viene de Intercom)

| # | Gap | Por qué vuelven a Intercom | Esfuerzo | ¿En el backlog? |
|---|---|---|---|---|
| 1 | Email entrante en la bandeja (el visitante responde el email y la respuesta vuelve a la conversación) | La mitad del soporte de un equipo chico es email. Sin esto se necesita una segunda herramienta | M | sí (parte entrante) |
| 2 | Tiempo real y notificaciones del navegador con sonido | Con polling y sin sonido se pierden chats en vivo | M | sí |
| 3 | El visitante ve sus conversaciones anteriores y el hilo no se borra al resolver | Hoy, cuando el equipo resuelve, el visitante pierde la respuesta que estaba leyendo | S/M | sí, más el bug de abajo |
| 4 | WhatsApp e Instagram en la bandeja | En LatAm es el canal principal. Crisp lo da a $95/mes | L | nuevo |
| 5 | Mensajes proactivos por página, tiempo y visita | Es lo que convierte el chat en ventas: "¿Dudas con el precio?" en /pricing | M | nuevo |
| 6 | AI para agentes: resumir, reformular, traducir | Lo usan todos los días en Intercom (Copilot) | M | sí |
| 7 | Push al celular del agente (PWA con Web Push) | Sin app, nadie atiende fuera del escritorio | M | nuevo |
| 8 | Equipos y bandejas por equipo con ruteo | Desde 3 o 4 personas hace falta separar soporte y ventas | M | nuevo |
| 9 | Detección de colisión | Dos respuestas al mismo cliente se notan enseguida | S | nuevo |
| 10 | Variables en respuestas guardadas (`{{name}}`, `{{email}}`) | Las macros sin personalizar se notan robóticas | S | nuevo |

Fuera del top 10 pero en el JSON: crear un issue de Track desde la conversación, reportes del bot / por tag / por horas, vistas guardadas, Cmd+K para conversaciones y personas.

## Bugs encontrados

1. **El widget borra el hilo del visitante al resolver.**
   - Repro:
     1. El visitante escribe y el agente responde.
     2. Con el widget abierto, el agente resuelve.
     3. En el siguiente poll (5 s), el panel del visitante queda vacío y solo muestra la encuesta CSAT (captura `chat-14-visitor-csat.png`).
   - Causa: `GET /api/chat/messages` usa `getOpenConversationByVisitor` (`lib/chat-data.ts`, `getVisitorConversationWithMessages`), que no devuelve conversaciones resueltas. Entonces `threadChanged` vuelve a dibujar con `[]`.
   - Intercom deja la conversación visible con su respuesta.
2. **El bot por palabras clave elige respuestas por substring.**
   - `scoreCandidate` (`lib/chat-data.ts`) suma puntos si un token de 3 o más letras aparece en cualquier parte del título o el cuerpo. Por ejemplo, "pro" coincide con "problema" y "producto", y "plan" con "planilla".
   - Repro (deducido del código):
     1. Crear la respuesta guardada `problemas` con cuerpo "Lamentamos el problema".
     2. Activar el bot con la fuente de respuestas guardadas.
     3. Como visitante, escribir "¿cuánto cuesta el plan pro?".
     4. El bot contesta "Lamentamos el problema".
   - En la prueba, el bot contestó una respuesta guardada que no tenía nada que ver.
   - Solo afecta al bot sin AI (o cuando la AI falla), que es el camino de quien no tiene clave del AI Gateway.
3. **El reporte no cuenta la primera respuesta del bot.**
   - Repro: una conversación que respondió el bot y luego un humano. Reportes muestra un guion en Primera respuesta para "Sin asignar".
   - Puede ser intencional (mide humanos), pero no se aclara en la pantalla.

## Fuentes

- Precios de Intercom y Fin: https://www.intercom.com/pricing, https://fin.ai/pricing
- Producto helpdesk: https://www.intercom.com/helpdesk
- Changelog de Intercom (mar a oct 2026: seguir conversación, vistas, macros, prioridad, SLA, dictado, WhatsApp): https://www.intercom.com/changes/en/page/1
- Tickets: https://www.intercom.com/help/en/articles/6436600-tickets-explained, https://intercom.com/help/en/articles/8300306-how-to-manage-tracker-tickets
- API de tickets: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/tickets/ticket
- Cambio de nombre y compra: https://cxtoday.com/intercom-rebrands-to-fin, https://investor.salesforce.com/news/news-details/2026/Salesforce-Signs-Definitive-Agreement-to-Acquire-Fin/
- Precios de Crisp: https://crisp.chat/en/pricing/
- Crisp Hugo y MagicReply: https://help.crisp.chat/en/article/ai-agent-getting-started-with-hugo-w6gbux, https://help.crisp.chat/en/article/migrating-from-magicreply-chatbots-to-hugo-ai-agent-1nmrv5q
- Actualización de primavera 2026 de Crisp: https://crisp.chat/en/blog/march-2026-product-update/
