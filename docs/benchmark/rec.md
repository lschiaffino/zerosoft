# Benchmark: Rec vs Loom (videos grabados de pantalla y cámara)

Fecha: 2026-10-25. Referencia: Loom Business (USD 15 por usuario al mes en pago anual, USD 18 en pago mensual) y Business + AI (USD 20 anual, USD 24 mensual).

## Cómo se hizo

- **Competidor:** página de precios con su tabla comparativa completa (incluido el JSON de precios que trae la página, con montos anuales y mensuales), help center de Loom (hoy dentro de `support.atlassian.com/loom`, los links viejos de `support.loom.com` redirigen ahí), ficha de la extensión en Chrome Web Store y el blog de Atlassian sobre Loom (resumen de 2025 y anuncios de reuniones con IA). Las fuentes están al final.
  - Loom no publica un changelog aparte: las novedades salen en el blog de Atlassian y como "New" en la tabla de precios.
  - "Record for agents" figura como nuevo en Business + AI, pero no encontramos una página de ayuda que explique qué hace. No lo contamos como fila.
- **Nuestra app:** Rec todavía no existe en el código. `app/[locale]/app/rec` es solo un shell con el estado vacío "Próximamente" (tanda 4a), sin `lib/rec-*.ts`, tablas ni API. El CRM ya graba videos 1:1 (`/app/crm/videos`), que Rec va a reusar. Todas las capacidades marcan **falta**.
- **Limitaciones:** no hay recorrido en navegador porque no hay app que recorrer. No grabamos con Loom: lo descrito sale de su documentación pública y su tabla de planes.

## Capacidades por área

Leyenda: **tiene**, **parcial**, **falta**, **mejor** (mejor que el incumbente).

### 1. Grabación (0/10)

| Capacidad | Loom | Rec | Nota |
|---|---|---|---|
| Pantalla y cámara a la vez, con la burbuja de cámara | Sí, en todos los planes | **falta** | Tres modos: pantalla y cámara, solo pantalla, solo cámara. Durante la grabación solo se cambia entre pantalla y pantalla con cámara |
| Elegir pantalla completa, ventana o pestaña | Sí | **falta** | En la extensión, la burbuja solo se ve sobre Chrome |
| Extensión de Chrome | Sí | **falta** | Graba sin instalar nada más que la extensión |
| App de escritorio | Mac y Windows | **falta** | Graba sobre cualquier app. No hay versión para Linux ni ChromeOS |
| App móvil | iOS y Android | **falta** | En iOS no hay pantalla y cámara juntas; Android tiene los cuatro modos, también solo audio |
| Micrófono, audio del sistema y supresión de ruido | Sí, en todos los planes | **falta** | |
| Pausar, retomar y volver atrás mientras se graba | Pausa; Live Rewind en Business | **falta** | Live Rewind borra los últimos segundos sin cortar la grabación |
| Grabar reuniones | Sí, marcado como nuevo | **falta** | La grabación de reuniones tiene duración ilimitada aun en Starter |

### 2. Herramientas al grabar (0/10)

| Capacidad | Loom | Rec | Nota |
|---|---|---|---|
| Calidad hasta 4K | 720p en Starter, 4K en planes pagos | **falta** | |
| Fondos virtuales, marcos de cámara y desenfoque | Fondos y marcos en todos; desenfoque desde Business | **falta** | |
| Dibujar en pantalla y resaltar el mouse | Business o superior | **falta** | También "No molestar" y dimensiones de grabación propias |

### 3. Edición (0/10)

| Capacidad | Loom | Rec | Nota |
|---|---|---|---|
| Recortar y unir videos | Business o superior | **falta** | Con edición básica sobre la forma de onda |
| Editar desde la transcripción | Business + AI | **falta** | Borrar texto corta el video |
| Quitar muletillas y silencios con IA | Business + AI | **falta** | |
| Miniatura propia y miniatura GIF | GIF en todos, miniatura propia en Business | **falta** | |
| Textos, cajas y flechas sobre el video | Business + AI, nuevo | **falta** | También subtítulos con estilo (Business) |
| Subir y descargar videos | Business o superior | **falta** | |

### 4. Compartir (0/10)

| Capacidad | Loom | Rec | Nota |
|---|---|---|---|
| Link listo al terminar de grabar | Sí | **falta** | El link se copia apenas se corta la grabación |
| Página del video con transcripción | Sí | **falta** | Reproductor, velocidad, transcripción, comentarios |
| Insertar el reproductor en otros sitios | Sí | **falta** | Notion, Confluence, FigJam, Intercom, Zendesk y webs propias |
| Botón de llamada a la acción | Sí; el automático, en Business + AI | **falta** | Se ve todo el video o solo al final; no se puede fijar un minuto |
| Marca propia en la página y el reproductor | Business o superior | **falta** | Logo, colores del reproductor y sacar la marca de Loom |

### 5. Privacidad (0/10)

| Capacidad | Loom | Rec | Nota |
|---|---|---|---|
| Quién lo ve: cualquiera con el link, el workspace o personas puntuales | Sí; privacidad por defecto del workspace en Business | **falta** | Con personas puntuales hay que entrar con ese email |
| Video con contraseña | Business o superior | **falta** | |
| Pedir acceso o pedir email para ver | Pedir acceso; pedir email en Business | **falta** | |
| Bloquear la descarga | Enterprise | **falta** | |

### 6. Interacción (0/10)

| Capacidad | Loom | Rec | Nota |
|---|---|---|---|
| Comentarios con tiempo en el video | Sí | **falta** | Aparecen en la línea de tiempo; se puede responder con un video |
| Reacciones con emoji | Sí | **falta** | El reproductor muestra las últimas 50 |
| Transcripción y subtítulos | Sí, en más de 50 idiomas | **falta** | |
| Notificaciones de vistas, comentarios y reacciones | Sí | **falta** | Página de notificaciones con filtros y seguir un video |

### 7. Analítica (0/10)

| Capacidad | Loom | Rec | Nota |
|---|---|---|---|
| Quién vio el video | Sí, en todos los planes | **falta** | |
| Métricas de interés y export | Business o superior | **falta** | Cuánto vio cada persona y clics en la llamada a la acción, exportable |

### 8. IA (0/10)

| Capacidad | Loom | Rec | Nota |
|---|---|---|---|
| Título y resumen automáticos | Business + AI | **falta** | |
| Capítulos automáticos | Business + AI | **falta** | Los capítulos a mano están en todos los planes |
| Del video a un documento o una tarea | Business + AI | **falta** | AI Workflows y Auto Tasks: documento, reporte de bug o issue de Jira a partir del video |
| Notas y resumen de reuniones | Business + AI, nuevo | **falta** | Notas y mail de resumen después de cada reunión |

### 9. Biblioteca (0/10)

| Capacidad | Loom | Rec | Nota |
|---|---|---|---|
| Biblioteca personal con carpetas y archivo | Sí | **falta** | También "Ver más tarde" |
| Espacios compartidos del equipo | 1 en Starter, 1 + 3 en Business, ilimitados en Enterprise | **falta** | |
| Buscar videos | Business o superior | **falta** | |

### 10. Integraciones (0/10)

| Capacidad | Loom | Rec | Nota |
|---|---|---|---|
| Slack | Sí | **falta** | Vista previa del video dentro de Slack |
| Jira, Confluence y GitHub | Sí | **falta** | |
| Gmail | Sí | **falta** | Grabar e insertar el video desde el mail |

### 11. Administración (0/10)

| Capacidad | Loom | Rec | Nota |
|---|---|---|---|
| Miembros y roles | Hasta 50 miembros en Starter, ilimitados en pagos; roles en Enterprise | **falta** | |
| SSO y SCIM | Enterprise (Atlassian Guard) | **falta** | |
| Retención de datos y traspaso de contenido | Enterprise | **falta** | |

## Resumen de puntajes

| Área | Puntaje |
|---|---|
| Grabación | 0 |
| Herramientas al grabar | 0 |
| Edición | 0 |
| Compartir | 0 |
| Privacidad | 0 |
| Interacción | 0 |
| Analítica | 0 |
| IA | 0 |
| Biblioteca | 0 |
| Integraciones | 0 |
| Administración | 0 |
| **Paridad global con Loom** | **0%**. Rec todavía no existe |

## Precios de Loom

Verificado el 2026-10-25 en https://www.loom.com/pricing. La página muestra el precio mensual y dice que el pago anual ahorra 17%. Los montos anuales salen de los datos de la misma página (USD 180 y USD 240 al año por usuario).

| | Starter | Business | Business + AI | Enterprise |
|---|---|---|---|---|
| Pago mensual, por usuario | USD 0 | USD 18 | USD 24 | A medida |
| Pago anual, por usuario y mes | USD 0 | USD 15 (180 al año) | USD 20 (240 al año) | A medida |
| Videos | 25 por persona | Ilimitados | Ilimitados | Ilimitados |
| Duración de grabación de pantalla | 5 minutos | Ilimitada | Ilimitada | Ilimitada |
| Calidad | 720p | 4K | 4K | 4K |
| Miembros | Hasta 50 | Ilimitados | Ilimitados | Ilimitados |
| IA de Loom | No | No | Sí | Sí |

Se cobra por usuario. Business + AI tiene 14 días de prueba. Enterprise suma SSO y SCIM, Salesforce (beta), importar de Zoom, SLA de 99,95% y retención propia.

## Cómo lo vamos a hacer

- **Grabación en el navegador:** `getDisplayMedia` y `getUserMedia` con `MediaRecorder`, la cámara compuesta en un canvas como burbuja. Primero web; la extensión y el escritorio vienen después.
- **Subida por partes:** cada trozo de `MediaRecorder` sube a Vercel Blob mientras se graba, así el link existe apenas se corta.
- **Página pública `/v/[id]`:** reproductor, transcripción, comentarios con tiempo, reacciones y privacidad (link, workspace, contraseña).
- **Transcripción e IA:** por `lib/ai.ts` con el proveedor elegido por env. De la transcripción salen título, resumen y capítulos.
- **Suite:** el video se inserta en Docs y Track, y una vista o un comentario puede disparar un Flow.

## Top 10 gaps para la primera versión

| # | Gap | Por qué importa | Esfuerzo |
|---|---|---|---|
| 1 | Grabar pantalla y cámara desde el navegador | Sin esto no hay producto | L |
| 2 | Subida por partes y link al terminar | Es la promesa central de Loom: grabás y compartís en segundos | M |
| 3 | Página pública del video `/v/[id]` | Es lo que ve quien recibe el link | M |
| 4 | Biblioteca con carpetas, renombrar y borrar | La lista común de toda app | M |
| 5 | Privacidad por link, workspace y contraseña | Hace falta para mandar videos fuera del equipo | S |
| 6 | Comentarios con tiempo y reacciones | El equipo responde sobre el minuto exacto sin armar una reunión | M |
| 7 | Transcripción y subtítulos | Base de la búsqueda y de la IA | M |
| 8 | Quién vio el video y cuánto | Es lo que mira quien manda videos a clientes | S |
| 9 | Título, resumen y capítulos con IA | Loom los cobra aparte en Business + AI | S |
| 10 | Recortar el principio y el final | La edición mínima antes de mandar un video | M |

Fuera del top 10: extensión de Chrome, app de escritorio, móvil, unir videos, editar desde la transcripción, llamada a la acción, marca propia, reuniones, integraciones con Slack y Gmail, SSO.

## Fuentes

- Precios y tabla de planes: https://www.loom.com/pricing
- Help center de Loom: https://support.atlassian.com/loom
- Modos de grabación: https://support.atlassian.com/loom/docs/use-looms-different-capture-modes/
- Plataformas (Chrome, escritorio, móvil): https://support.loom.com/hc/en-us/articles/360007405538-The-Loom-recording-platforms-Chrome-vs-desktop-app-vs-mobile
- Extensión de Chrome: https://support.loom.com/hc/en-us/articles/360002187698
- App de escritorio: https://support.loom.com/hc/en-us/articles/360002207917
- Privacidad: https://support.atlassian.com/loom/docs/use-looms-privacy-settings/
- Compartir: https://support.atlassian.com/loom/docs/share-your-recording/
- Compartir con personas puntuales: https://support.atlassian.com/loom/docs/share-your-recording-with-specific-people/
- Comentarios y reacciones: https://support.loom.com/hc/en-us/articles/360017464517
- Llamada a la acción: https://support.loom.com/hc/en-us/articles/360002241117-How-to-add-and-edit-a-call-to-action-button
- Resumen y capítulos: https://support.loom.com/hc/en-us/articles/360018208478
- Notificaciones: https://support.atlassian.com/loom/docs/understand-the-notifications-page/
- Extensión en Chrome Web Store: https://chrome.google.com/webstore/detail/liecbddmkiiihnedobmlmillhodjkdmb
- Resumen de 2025: https://www.atlassian.com/blog/loom/2025-in-review
- Reuniones con IA: https://www.atlassian.com/blog/loom/unstuck-your-meetings
