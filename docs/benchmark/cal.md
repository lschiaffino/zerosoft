# Benchmark: Cal vs Calendly (y Cal.com)

Fecha: 2026-10-22. Incumbente principal: Calendly. Referencia secundaria: Cal.com.

## Cómo se hizo

- **Competidor:** páginas públicas de precios, centro de ayuda, blog de producto y notas de prensa de Calendly, más precios, docs y releases de Cal.com (ver Fuentes). Lo que no se pudo confirmar en una página oficial está marcado como "sin verificar".
- **Nuestra app:** lectura del código en `main` (`lib/calendar*.ts`, `app/api/calendar/*`, `app/[locale]/app/calendar/*`, `app/[locale]/book/*`) y un recorrido con Playwright contra el servidor de producción compartido (DEMO_MODE) en 1440×900, 390×844 y modo oscuro. Se creó un event type con la tecla C, se reservó desde la página pública como invitado, y se revisaron bookings, disponibilidad, routing forms, analytics, ajustes y Cmd+K.
- **Velocidad:** la máquina estaba con 17 builds en paralelo, así que no se reportan tiempos. Solo se anota la cantidad de pasos.

## Resumen

**Paridad global: 66 %** (promedio de las áreas ponderado por lo que pesa para un equipo chico que viene de Calendly).

Cal cubre bien el núcleo de agenda: casi todos los tipos de evento de Calendly (uno a uno, grupal con cupos, colectivo, round robin, one-off), límites, buffers, incrementos, horarios reutilizables con excepciones, aprobación, cobros con Stripe, routing forms y analytics. Lo que más pesa en contra está en lo que rodea a la agenda: solo Google Calendar (y solo el calendario principal), recordatorios solo por email, Zoom y Teams como link fijo en vez de reunión generada, sin apps móviles, sin IA y sin forma de traer los datos desde Calendly.

Donde estamos mejor: cada reserva crea el contacto y la reunión en el CRM propio sin integración, los cobros no tienen recargo de plan, el editor es más rápido de usar con teclado (C, Cmd+K, Ctrl+Enter) y los routing forms vienen en todos los planes (en Calendly son Teams+).

## Puntaje por área

| Área | Puntaje | Comentario |
|---|---|---|
| Agenda y modelo de datos | 8/10 | Faltan eventos recurrentes, encuestas de horario (meeting polls) y event types ocultos del perfil |
| Equipos y colaboración | 6/10 | Round robin justo y colectivos sí; faltan managed event types (plantillas bloqueadas) y página pública del equipo |
| Automatización | 5/10 | Workflows por email antes o después del inicio; sin SMS ni WhatsApp, sin disparadores al reservar o cancelar |
| Integraciones y API | 5/10 | Google solo calendario principal, sin Outlook ni iCloud, Zoom/Teams sin OAuth, sin Zapier ni PayPal. API v1, webhooks, embed y CRM propio sí |
| Admin y permisos | 4/10 | Roles del workspace; sin SSO, SCIM ni registro de actividad |
| Analytics y reportes | 7/10 | Creadas, canceladas, no-shows, horarios populares, por event type; sin export CSV ni analytics de routing forms |
| Móvil y offline | 3/10 | Web responsive correcta a 390 px; sin apps ni extensión de navegador |
| IA | 1/10 | Calendly lanzó Notetaker, Callie y servidor MCP en 2026; acá nada en Cal |
| Importar y exportar | 2/10 | Sin importar desde Calendly (Cal.com lo hace en un clic), sin exportar reservas |
| UX y pulido | 7/10 | Rápido de crear y reservar, claro y oscuro bien; "Powered by zerosoft" no se puede sacar, sin dominio propio para la página de reservas, bugs menores abajo |

## Capacidades, una por una

Leyenda: **tiene**, **parcial**, **falta**, **mejor** (mejor que el incumbente).

### Agenda y modelo de datos

| Capacidad | Calendly | Cal | Nota |
|---|---|---|---|
| Event type uno a uno | Free (1), Standard+ ilimitados | tiene | Alta con C, nombre y duración; arranca activo lun a vie 9 a 17 |
| Grupal con cupos (seats) | Standard+ | tiene | Hasta 500 cupos |
| Colectivo (todos los anfitriones libres) | Standard+ | tiene | |
| Round robin | Teams+ | tiene | Reparto justo y webhook de no-show |
| One-off / horarios elegidos a mano | Standard+ | tiene | |
| Meeting polls (votar horarios) | Standard+ | falta | |
| Eventos recurrentes (serie semanal) | Cal.com Teams | falta | Calendly tampoco lo ofrece de forma nativa (sin verificar) |
| Buffers, aviso mínimo, horizonte | todos | tiene | |
| Límites diarios, semanales, mensuales | todos | tiene | Por event type y por anfitrión |
| Incrementos de inicio independientes de la duración | todos | tiene | |
| Horarios reutilizables y excepciones por fecha | todos | tiene | |
| Aprobación del anfitrión antes de confirmar | Standard+ | tiene | |
| Event type oculto del perfil (secreto) | todos | falta | Solo existe el link de un uso o apagarlo |
| Ubicaciones estructuradas con elección del invitado | todos | parcial | Zoom y Teams son un link fijo, no se genera una reunión por reserva |
| Preguntas personalizadas (texto, select, radio, checkbox, teléfono) e invitados extra | todos | tiene | |
| Cobro al reservar | Standard+ (Stripe y PayPal) | parcial | Stripe sí, con reembolso al cancelar; PayPal no |
| Paquetes de reuniones, links de pago, facturas | 2026, Stripe | falta | |
| Redirección después de reservar y UTM | Standard+ | tiene | |

### Equipos y colaboración

| Capacidad | Calendly | Cal | Nota |
|---|---|---|---|
| Pool de anfitriones por event type | Teams | tiene | |
| Managed event types (plantilla bloqueada por admin) | Teams+ | falta | |
| Página pública del equipo | Teams | falta | El perfil público es por persona (`/book/<handle>`) |
| Routing forms | Teams+ | **mejor** | En todos los planes; terminan en event type, URL o mensaje |
| Routing por consulta a CRM | Enterprise (Salesforce) | falta | Natural de hacer con nuestro CRM |
| Agendar en nombre de otro | Standard+ | parcial | El anfitrión reprograma reservas existentes, no crea una para otro |

### Automatización

| Capacidad | Calendly | Cal | Nota |
|---|---|---|---|
| Recordatorio por email | todos | tiene | |
| Workflows con pasos antes y después | Standard+ | tiene | Hasta 10 pasos, cron cada minuto |
| Disparadores al reservar, cancelar, reprogramar | Standard+ | falta | Solo relativos al inicio |
| SMS | Standard+ | falta | |
| WhatsApp | no (Cal.com lo anuncia, sin verificar en sus docs) | falta | |
| Reconfirmación y no-show | Standard+ | parcial | No-show corta pasos; sin flujo de reconfirmación |
| Webhook como paso de workflow | Cal.com | falta | Hay webhooks globales |

### Integraciones y API

| Capacidad | Calendly | Cal | Nota |
|---|---|---|---|
| Google Calendar | todos | parcial | Solo el calendario `primary` (`lib/google-calendar.ts`); requiere OAuth configurado |
| Varios calendarios para conflictos | hasta 6 en pagos | falta | Idea ya en el backlog |
| Outlook / Microsoft 365 / Exchange | todos | falta | Idea ya en el backlog |
| Zoom / Teams con reunión generada | todos | falta | Hoy es un link fijo por anfitrión |
| Google Meet generado | todos | tiene | Al crear el evento en Google |
| CRM | HubSpot Standard+, Salesforce Teams+ | **mejor** | Contacto y reunión en el CRM propio, sin configurar |
| Zapier / Make | Standard+ | falta | |
| API REST y webhooks | Standard+ | tiene | API v1 con claves, webhooks firmados |
| Embed inline y popup | todos | tiene | |
| Servidor MCP | 2026 | falta | |
| Google Analytics / Meta Pixel | Standard+ | falta | |

### Admin y permisos

| Capacidad | Calendly | Cal | Nota |
|---|---|---|---|
| Roles | 5 roles | parcial | Roles del workspace compartidos con el resto de las apps |
| SSO SAML / SCIM | Enterprise | falta | |
| Registro de actividad | Enterprise | falta | |
| Borrado de datos de invitados (GDPR) | todos | falta | Sin flujo dedicado |

### Analytics

| Capacidad | Calendly | Cal | Nota |
|---|---|---|---|
| Creadas, canceladas, no-shows, horarios populares | Standard+ | tiene | |
| Por event type | Standard+ | tiene | |
| Filtro por persona o equipo | Standard+ | falta | |
| Analytics de routing forms (envío a reunión) | Teams+ | falta | Hay registro de envíos, sin embudo |
| Export CSV de reservas y analytics | pagos | falta | |

### Móvil, IA, importar

| Capacidad | Calendly | Cal | Nota |
|---|---|---|---|
| Apps iOS y Android | todos | falta | La web se ve bien a 390 px, sin scroll horizontal |
| Extensión de navegador | todos | falta | |
| Notetaker (grabar y resumir reuniones) | Standard+ add-on, 2026 | falta | |
| Asistente que agenda por email (Callie) | 2026, beta | falta | |
| Importar desde Calendly | no aplica (Cal.com lo hace) | falta | Bloquea el cambio: hay que recrear todo a mano |
| Exportar reservas | pagos | falta | |

### UX y pulido

| Capacidad | Calendly | Cal | Nota |
|---|---|---|---|
| Sacar el "Powered by" | pagos | falta | Siempre visible en la página pública |
| Dominio propio para la página de reservas | no documentado | falta | Link sí tiene dominios propios; se podría reutilizar |
| Idiomas de la página pública | 5 | parcial | en, es, pt |
| Cmd+K | no | **mejor** | Encuentra event types; las reservas no aparecen |
| Crear con teclado | no | **mejor** | C abre el modal, Ctrl+Enter crea |
| Estados vacíos, claro y oscuro, 390 px | sí | tiene | Revisado en overview, event types, routing, bookings, página pública |

## Paridad de UX en los flujos principales

| Flujo | Calendly | Cal |
|---|---|---|
| Crear un event type y compartir el link | Botón, elegir tipo, formulario, guardar, copiar (unos 5 pasos) | C, nombre, Ctrl+Enter, "Copy link" en la fila (4 pasos, todo con teclado) |
| Reservar como invitado | Día, hora, "Next", formulario, confirmar | Día, hora, formulario, confirmar. Detecta la zona horaria. Confirmación con link para reprogramar o cancelar |
| Ver y gestionar reservas | Lista con pestañas Upcoming / Past | Lista agrupada por día con búsqueda, estado, rango, reprogramar, cancelar, no-show |
| Bloquear un día | Excepción en el horario | Excepción por fecha o "blocked slot" desde el overview |

## Top 10 brechas (impacto para un equipo chico que viene de Calendly)

| # | Brecha | Por qué volverían a Calendly | Esfuerzo |
|---|---|---|---|
| 1 | Outlook / Microsoft 365 y varios calendarios para conflictos (idea existente) | Sin esto hay reservas dobles o directamente no pueden usar Cal | M |
| 2 | Zoom y Teams que generan una reunión por reserva | Hoy reutilizan un link fijo; quien usa Zoom espera un link único por reunión | M |
| 3 | Importar desde Calendly | Recrear event types, horarios y preguntas a mano frena el cambio | M |
| 4 | Recordatorios por SMS y WhatsApp | Es lo que baja los no-shows en servicios (salud, belleza, educación), sobre todo en LatAm | M |
| 5 | Disparadores de workflow al reservar, cancelar y reprogramar, y paso de webhook | Seguimientos y avisos internos dependen de esto | S |
| 6 | Apps móviles (o al menos PWA con notificaciones) | Ver la agenda y compartir el link desde el teléfono | L |
| 7 | Sacar "Powered by" y dominio propio para la página de reservas | Marca propia en la página que ven los clientes | S |
| 8 | Export CSV de reservas y analytics, filtros por persona | Reportes para el equipo y contabilidad | S |
| 9 | Managed event types y página pública del equipo | Equipos de ventas o soporte de más de 3 personas | M |
| 10 | Notetaker o resumen de la reunión hacia el CRM | Calendly lo empuja fuerte desde agosto 2026 | L |

## Bugs encontrados

1. **Breadcrumb de Analytics dice "Overview".** Ir a Cal › Analytics (`/en/app/calendar/analytics`). La barra superior muestra "Cal / Overview". Causa probable: falta `/app/calendar/analytics` en `sections` de `app/[locale]/app/layout.tsx`.
2. **Campos de fecha de Analytics se estiran en alto.** En Cal › Analytics a 1440 px, los inputs "From" y "To" miden unos 140 px de alto, desalineados con los botones "Last 7/30/90 days" y "Apply".
3. **Hora partida en dos líneas en Bookings.** En Cal › Bookings a 1440 px, "09:00 AM" de la columna de hora se corta en "09:00" y "AM".
4. **Cmd+K no encuentra reservas.** Abrir Cmd+K y escribir el nombre de un invitado que tiene reserva: solo aparecen event types.

## Fuentes

- Calendly precios: https://calendly.com/pricing
- Calendly conectar calendarios: https://calendly.com/help/connect-your-calendar-to-calendly
- Calendly analytics: https://calendly.com/help/calendly-analytics
- Calendly seguimiento y export: https://calendly.com/help/tracking-and-reporting
- Calendly workflows: https://calendly.com/blog/workflows, https://calendly.com/learn/calendly-workflows
- Calendly roles: https://help.calendly.com/hc/en-us/articles/4410722852759
- Calendly registro de actividad: https://calendly.com/help/the-activity-log
- Calendly SCIM: https://calendly.com/help/how-to-set-up-scim-with-microsoft-entra-id
- Calendly suite de IA (agosto 2026): https://calendly.com/newsroom/press-release/calendly-new-ai-product-suite
- Calendly novedades de producto: https://calendly.com/blog/product-updates
- Calendly facturas con Stripe: https://calendly.com/de/help/how-to-send-and-manage-invoices-in-calendly
- Calendly webhooks: https://calendly.com/de/help/webhooks-overview
- Calendly ajustes de cuenta e idiomas: https://calendly.com/help/account-settings-overview
- Calendly VPAT: https://calendly.com/help/voluntary-product-accessibility-template-vpat
- Historial de planes (tercero): https://pricingsaas.com/companies/calendly/diffs/2026W35
- Cal.com precios: https://cal.com/pricing
- Cal.com workflows: https://cal.com/docs/enterprise-features/workflows
- Cal.com Cal.ai: https://cal.com/ai
- Cal.com releases: https://github.com/calcom/cal.com/releases
