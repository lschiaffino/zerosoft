# Benchmark: Talk vs Slack

Fecha: 2026-10-25. Referencia: Slack Pro (USD 7,25 por usuario al mes pagando anual, USD 8,75 pagando mensual) y Business+ (USD 15 anual, USD 18 mensual).

## Cómo se hizo

- **Competidor:** página de precios y comparación de planes de Slack, help center (huddles, canvases, lists, Workflow Builder, límites del plan gratis, cambios de planes de 2025), página de funciones de AI y el anuncio de precios de junio de 2025. Todo con fuentes públicas, leídas el 2026-10-25. Las fuentes están al final.
  - En junio de 2025 Slack subió Business+ de USD 12,50 a USD 15 (anual), dejó Pro igual, sumó AI básica a todos los planes pagos, dejó de vender el add-on de Slack AI y agregó Enterprise+. La página de precios ya no muestra Enterprise Grid: lo que se vende arriba de Business+ es Enterprise+, a consultar.
  - El día de la revisión la página de precios mostraba una promoción con 40% menos sobre Pro y Business+ (USD 4,35 y USD 9 anual). Acá se usan los precios de lista tachados, que son los que figuran también en la comparación de planes.
- **Nuestra app:** Talk todavía no existe. Solo hay un shell en `/app/talk` con el estado vacío "Próximamente" (tanda 4a). No hay tablas, API ni componentes de mensajería interna. `Chat` es otra cosa (el widget de soporte al estilo Intercom) y no cubre canales de equipo.
- **Limitaciones:** no hay recorrido en navegador porque no hay app que recorrer. No se probó Slack con una cuenta paga, así que los límites salen de la documentación. Todas las capacidades de Talk marcan **falta**.

## Capacidades por área

Leyenda: **tiene**, **parcial**, **falta**, **mejor** (mejor que el incumbente).

### 1. Canales (0/10)

| Capacidad | Slack | Talk | Nota |
|---|---|---|---|
| Canales públicos | Sí | **falta** | Cualquiera del workspace los ve y se une. Se exploran desde un directorio de canales |
| Canales privados | Sí | **falta** | Solo por invitación, no aparecen en el directorio |
| Tema, descripción y marcadores del canal | Sí | **falta** | Encabezado con tema, pestañas y links fijados |
| Secciones del sidebar | Sí | **falta** | Cada persona agrupa y ordena canales y DMs en secciones propias |
| Archivar, renombrar y convertir canales | Sí | **falta** | Archivar conserva el historial; público a privado también |

### 2. Mensajes directos (0/10)

| Capacidad | Slack | Talk | Nota |
|---|---|---|---|
| DM 1:1 | Sí | **falta** | También con uno mismo, como bloc de notas |
| DM grupal | Sí | **falta** | Hasta 9 personas además de uno; se puede convertir en canal privado |

### 3. Escribir y conversar (0/10)

| Capacidad | Slack | Talk | Nota |
|---|---|---|---|
| Editor con formato | Sí | **falta** | Negrita, listas, código, citas, links y vista previa de links |
| Hilos | Sí | **falta** | Respuestas en un panel lateral, con opción de mandar también al canal |
| Menciones de personas, @canal y @here | Sí | **falta** | Con autocompletado y grupos de usuarios (@equipo) |
| Reacciones con emoji | Sí | **falta** | Emoji propios del workspace incluidos |
| Editar y borrar mensajes | Sí | **falta** | El admin define por cuánto tiempo se puede editar |
| Mensajes programados | Sí | **falta** | Enviar más tarde a una hora elegida |
| Fijar mensajes | Sí | **falta** | En el encabezado del canal |
| Clips de audio y video | Sí | **falta** | Grabación corta dentro del mensaje, con transcripción |

### 4. Archivos (0/10)

| Capacidad | Slack | Talk | Nota |
|---|---|---|---|
| Subir y previsualizar archivos | Sí | **falta** | Imágenes, PDF y documentos con vista previa dentro del mensaje |
| Explorador de archivos | Sí | **falta** | Todos los archivos del workspace, con filtros |

### 5. Búsqueda y seguimiento (0/10)

| Capacidad | Slack | Talk | Nota |
|---|---|---|---|
| Búsqueda de mensajes y archivos con filtros | Sí | **falta** | `from:`, `in:`, fechas; en el plan gratis solo los últimos 90 días |
| No leídos y menciones | Sí | **falta** | Contadores por canal, vista de no leídos y pestaña Actividad |
| Guardar para después y recordatorios | Sí | **falta** | "Later" con recordatorio en un mensaje |
| Notificaciones configurables | Sí | **falta** | Por canal, palabras clave, horario de no molestar, push y escritorio |

### 6. Presencia y perfil (0/10)

| Capacidad | Slack | Talk | Nota |
|---|---|---|---|
| Estados con emoji y vencimiento | Sí | **falta** | Ejemplo: "En reunión" hasta las 15 |
| Presencia activo o ausente | Sí | **falta** | Punto verde en el avatar |
| Perfil con cargo, zona horaria y campos propios | Sí | **falta** | Muestra la hora local de la otra persona |

### 7. Huddles (0/10)

| Capacidad | Slack | Talk | Nota |
|---|---|---|---|
| Llamadas de audio y video en canales y DMs | Sí | **falta** | Gratis: solo 1:1. Pagos: hasta 50 personas, 25 con video |
| Compartir pantalla y dibujar | Sí | **falta** | Hasta dos pantallas a la vez, dibujo en escritorio |
| Hilo, canvas y notas AI del huddle | Sí | **falta** | Notas AI en todos los planes pagos; subtítulos en vivo solo en inglés |

### 8. Canvases y listas (0/10)

| Capacidad | Slack | Talk | Nota |
|---|---|---|---|
| Canvases | Sí | **falta** | Documento en una pestaña del canal o suelto, con embeds y comentarios. Solo planes pagos |
| Listas | Sí | **falta** | Tabla o tablero con campos, vistas guardadas e hilo por ítem. Hasta 1.000 ítems en Pro y Business+ |

### 9. Automatización y apps (0/10)

| Capacidad | Slack | Talk | Nota |
|---|---|---|---|
| Workflow Builder | Sí | **falta** | Disparadores por link, horario, emoji o canal; pasos con condiciones. Solo pagos |
| Conectores de otras herramientas en workflows | Sí | **falta** | Pasos de terceros con autenticación |
| Apps y bots del marketplace | Sí | **falta** | Más de 2.600 apps; el plan gratis permite 10 |
| API, bots propios y webhooks entrantes | Sí | **falta** | Web API, Events API, slash commands |

### 10. Externos y AI (0/10)

| Capacidad | Slack | Talk | Nota |
|---|---|---|---|
| Slack Connect | Sí | **falta** | Canales compartidos con hasta 250 organizaciones; gratis solo DMs 1:1 |
| Invitados | Sí | **falta** | Cuentas de invitado limitadas a algunos canales |
| Resúmenes AI de canales e hilos | Sí | **falta** | Todos los planes pagos |
| Búsqueda AI, recaps diarios y traducción | Sí | **falta** | Business+ y Enterprise+ |
| Slackbot como agente personal | Sí | **falta** | Business+ y Enterprise+; prueba en Pro |

### 11. Admin y seguridad (0/10)

| Capacidad | Slack | Talk | Nota |
|---|---|---|---|
| Roles de miembro, admin y owner | Sí | **falta** | Más roles granulares en Enterprise+ |
| Retención y export de datos | Sí | **falta** | Políticas de retención; export de canales públicos en todos los planes |
| SSO y SCIM | Sí | **falta** | OAuth de Google en Pro; SAML en Business+ |

### 12. Apps (0/10)

| Capacidad | Slack | Talk | Nota |
|---|---|---|---|
| App de escritorio | Sí | **falta** | Mac, Windows y Linux |
| Apps móviles | Sí | **falta** | iOS y Android con push |

## Resumen de puntajes

Todas las áreas en 0/10: Talk todavía no tiene código.

## Precios de Slack

Verificado el 2026-10-25 en `slack.com/pricing` y `slack.com/pricing/paid-vs-free`. Precios de lista en USD, por usuario activo y por mes.

| | Free | Pro | Business+ | Enterprise+ |
|---|---|---|---|---|
| Pagando anual | 0 | 7,25 | 15 | A consultar |
| Pagando mensual | 0 | 8,75 | 18 | A consultar |
| Historial | 90 días; lo de más de un año se borra | Sin límite | Sin límite | Sin límite |
| Huddles | Solo 1:1 | Grupales | Grupales | Grupales |
| Slack Connect | Solo DMs 1:1 | Hasta 250 organizaciones | Hasta 250 organizaciones | Igual |
| Apps | 10 | Sin límite | Sin límite | Sin límite |
| Canvases, listas y workflows | No (solo lectura) | Sí | Sí | Sí |
| AI | Básica | Resúmenes y notas de huddle | Más búsqueda AI, recaps, traducción, Slackbot y AI en workflows | Más enterprise search |
| SSO | No | OAuth de Google | SAML | Varias configuraciones SAML |

Notas:
- Ese día la página mostraba una promoción del 40% sobre Pro (USD 4,35 anual, 5,25 mensual) y Business+ (USD 9 anual, 10,80 mensual). No se usa en la comparación.
- Enterprise Grid ya no aparece en la página de precios; sigue nombrado en el help center para clientes existentes. Enterprise+ no tiene precio público.

## Cómo lo vamos a hacer

- **Tiempo real:** polling corto más SSE para mensajes nuevos, escritura y presencia, sobre la misma base libsql del resto de la suite. Sin servidor de websockets aparte en la primera versión.
- **Huddles en fase 2:** audio y video con WebRTC después de tener canales, DMs e hilos sólidos.
- **AI:** resúmenes de canales e hilos y transcripción de clips y huddles con `lib/ai.ts`, con el proveedor elegido por env.
- **La suite como ventaja:** un mensaje se convierte en issue de Track o en página de Docs, los canvases son páginas de Docs y los workflows corren en Flow.
- **Código abierto:** AGPL y self-host, con los mensajes en la base del cliente.

## Top 10 gaps para la primera versión

| # | Gap | Por qué importa | Esfuerzo |
|---|---|---|---|
| 1 | Canales públicos y privados con sidebar | Es la base del producto | L |
| 2 | DMs 1:1 y grupales | La mitad de las conversaciones pasa ahí | M |
| 3 | Mensajes en tiempo real con editor de formato | Sin esto no reemplaza a Slack | L |
| 4 | Hilos | Ordenan las conversaciones largas | M |
| 5 | Menciones y notificaciones (push y escritorio) | La gente tiene que enterarse cuando la necesitan | M |
| 6 | No leídos y vista de actividad | Es cómo se navega Slack en el día a día | M |
| 7 | Reacciones, editar y borrar | Comportamiento esperado de cualquier chat | S |
| 8 | Archivos con vista previa | Se comparten todo el tiempo | M |
| 9 | Búsqueda con filtros y Cmd+K | Encontrar lo que se dijo es la razón de pagar Slack | M |
| 10 | Estados y presencia | Saber quién está disponible | S |

Fuera del top 10: huddles, canvases, listas, workflows, apps y API, canales compartidos con otras organizaciones, invitados, resúmenes AI, mensajes programados, recordatorios, clips, apps de escritorio y móviles.

## Bugs encontrados

No aplica: Talk todavía no tiene código.

## Fuentes

- Precios: https://slack.com/pricing
- Comparación de planes: https://slack.com/pricing/paid-vs-free
- Anuncio de precios de junio de 2025: https://slack.com/blog/news/june-2025-pricing-and-packaging-announcement
- Cambios de funciones y precios por plan: https://slack.com/help/articles/39264531104275-Updates-to-feature-availability-and-pricing-for-Slack-subscriptions
- Límites del plan gratis: https://slack.com/help/articles/27204752526611-Feature-limitations-on-the-free-version-of-Slack
- Huddles: https://slack.com/help/articles/4402059015315-Use-huddles-in-Slack
- Canvases: https://slack.com/help/articles/203950418-Use-canvases-in-Slack
- Listas: https://slack.com/help/articles/27452748828179-Use-lists-in-Slack
- Workflow Builder: https://slack.com/help/articles/360035692513-Guide-to-Slack-Workflow-Builder
- AI en Slack: https://slack.com/features/ai
