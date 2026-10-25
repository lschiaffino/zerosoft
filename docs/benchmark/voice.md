# Benchmark: Voice vs Wispr Flow + Granola (dictado por voz y notas de reunión)

Fecha: 2026-10-25. Referencia de precio: Wispr Flow Pro (USD 12 por usuario al mes en anual, USD 15 en mensual) y Granola Business (USD 14 por usuario al mes).

## Cómo se hizo

- **Competidores:** Voice junta dos productos, así que se miraron los dos.
  - **Wispr Flow** (dictado): página de precios, página de funciones y el help center completo (`docs.wisprflow.ai`): las colecciones "Using Wispr Flow" (31 artículos) y "Wispr Notetaker" (25 artículos), más los artículos de atajos, Command Mode, Styles, Smart Formatting y Backtrack, IDEs y MCP.
  - **Granola** (notas de reunión): página de precios y el índice completo de docs (`docs.granola.ai/llms.txt`), con transcripción, notas mejoradas con AI, plantillas, chat, recipes, compartir, espacios y carpetas, personas y empresas, integraciones, API y consentimiento.
  - Solo fuentes públicas. No se probaron las apps. Las fuentes están al final.
- **Nuestra app:** Voice todavía no existe. Hoy está en el catálogo (`lib/products.ts`) con un shell en `/app/voice` que muestra el estado vacío "Próximamente" (tanda 4a), sin tablas, API ni lógica. Por eso la columna Voice dice **falta** en todo.
- **Dato de contexto:** Wispr Flow sumó su propio Notetaker (beta, Mac y Windows) que importa reuniones de Granola y Otter. Los dos competidores se están acercando al mismo producto que queremos armar: dictado y reuniones en una sola app.
- **Limitaciones:** no hay recorrido en navegador porque no hay app que recorrer.

## Capacidades por área

Leyenda: **tiene**, **parcial**, **falta**, **mejor** (mejor que el competidor).

### 1. Dictado en cualquier app (0/10)

| Capacidad | Wispr Flow + Granola | Voice | Nota |
|---|---|---|---|
| Dictar en cualquier campo de texto con un atajo | Wispr: mantener Fn (Mac) o Ctrl+Win (Windows) y hablar; el texto se pega donde está el cursor | **falta** | Es el corazón de Wispr Flow |
| Modo manos libres | Wispr: Fn+Space o Ctrl+Win+Space para empezar y terminar sin mantener la tecla | **falta** | |
| Más de 100 idiomas | Wispr: dictado en más de 100 idiomas, con varios idiomas en la misma cuenta | **falta** | |
| Modo susurro | Wispr: dictar en voz baja en lugares compartidos | **falta** | |
| Pegar o copiar el último dictado | Wispr: Cmd+Ctrl+V / Cmd+Ctrl+C en Mac, Shift+Alt+Z / X en Windows | **falta** | Rescata un dictado que no se pegó |

### 2. Limpieza y formato con AI (0/10)

| Capacidad | Wispr Flow + Granola | Voice | Nota |
|---|---|---|---|
| Sacar muletillas y arreglar gramática y puntuación | Wispr Smart Formatting: "um", "eh", pausas y mayúsculas; prendido por defecto | **falta** | No corrige palabras mal entendidas |
| Backtrack: aplicar autocorrecciones | Wispr: "el lunes, no, mejor el martes" queda "el martes" | **falta** | Solo borra correcciones claras |
| Listas y puntuación dictada | Wispr: "primero... segundo..." arma una lista; "coma", "nueva línea" insertan el signo | **falta** | |

### 3. Diccionario, snippets y estilos (0/10)

| Capacidad | Wispr Flow + Granola | Voice | Nota |
|---|---|---|---|
| Diccionario personal | Wispr aprende de las correcciones y deja agregar palabras; Granola tiene términos propios para la transcripción | **falta** | Nombres, marcas y jerga |
| Snippets por voz | Wispr: una frase dicha inserta un texto guardado (link de agenda, respuesta frecuente) | **falta** | |
| Estilo según la app | Wispr Styles: formal, casual, muy casual o entusiasta por categoría (personal, trabajo, email, otros) | **falta** | Solo en inglés |
| Nombres por contexto | Wispr usa el contexto de la pantalla para escribir bien nombres poco comunes | **falta** | |
| Modo para código | Wispr reconoce variables y funciones visibles en Cursor, Windsurf y VS Code, y etiqueta archivos con @ en el chat de Cursor y Windsurf | **falta** | |

### 4. Comandos de voz y reescritura (0/10)

| Capacidad | Wispr Flow + Granola | Voice | Nota |
|---|---|---|---|
| Command Mode | Wispr: con Fn+Ctrl se selecciona texto y se dice qué hacer ("hacelo más corto", "traducilo"); también busca en Perplexity | **falta** | Apagado por defecto, en planes pagos |
| Transforms y prompts propios | Wispr (beta): reescribir texto con transformaciones guardadas | **falta** | |

### 5. Escritorio, móvil y uso (0/10)

| Capacidad | Wispr Flow + Granola | Voice | Nota |
|---|---|---|---|
| Apps de escritorio Mac y Windows | Wispr y Granola tienen app nativa en los dos | **falta** | Granola web (`notes.granola.ai`) solo ve y edita, no graba |
| Móvil iOS y Android | Wispr: teclado en iPhone y Android; Granola: app iOS, Android y Apple Watch | **falta** | |
| Sincronizar entre dispositivos | Wispr sincroniza diccionario, snippets y ajustes; Granola sincroniza notas | **falta** | Los atajos de Wispr son por dispositivo |
| Estadísticas de uso | Wispr: pestaña Usage con palabras dictadas y apps más usadas; paneles de equipo en planes pagos | **falta** | |

### 6. Captura de reuniones (0/10)

| Capacidad | Wispr Flow + Granola | Voice | Nota |
|---|---|---|---|
| Grabar sin bot | Granola captura el audio del sistema y el micrófono de la compu: sirve para cualquier llamada (Zoom, Meet, Teams, Slack, VoIP) | **falta** | No guarda el audio: lo manda a transcribir en vivo |
| Transcripción en vivo | Granola: panel con burbujas "Yo" (micrófono) y "Ellos" (sistema), con búsqueda | **falta** | Para sola a los 15 minutos sin audio o al terminar la llamada |
| Calendario y recordatorios | Granola y Wispr Notetaker: Google Calendar y Outlook, aviso al empezar la reunión | **falta** | |
| Nombres de quién habla | Granola: nombres reales en Meet, Zoom y Teams; en el resto "Yo" y "Ellos" | **falta** | |
| Reuniones en persona y llamadas | Granola móvil graba reuniones cara a cara y llamadas de teléfono | **falta** | |

### 7. Notas y resúmenes con AI (0/10)

| Capacidad | Wispr Flow + Granola | Voice | Nota |
|---|---|---|---|
| Notas mejoradas con AI | Granola mezcla la transcripción, las notas que escribiste y el evento del calendario; lo tuyo queda en negro | **falta** | Es el corazón de Granola |
| Plantillas de notas | Granola: plantillas por tipo de reunión (ventas, 1:1, daily, entrevista) y propias, compartibles con la empresa | **falta** | Se eligen con `/` o al regenerar |
| Ver de dónde sale cada punto | Granola: la lupa muestra si salió de la transcripción o de tus notas | **falta** | |
| Brief antes de la reunión | Granola Business: resumen de lo hablado antes con esas personas | **falta** | |
| Email de seguimiento | Granola Business: borrador de follow-up en Gmail u Outlook | **falta** | |

### 8. Chat con las reuniones (0/10)

| Capacidad | Wispr Flow + Granola | Voice | Nota |
|---|---|---|---|
| Chat sobre una reunión | Granola Chat (Cmd+J) antes, durante y después de la reunión | **falta** | |
| Chat sobre muchas reuniones | Granola: todas las notas, una carpeta, una selección o una persona; Wispr "Ask Wispr" | **falta** | En Granola gratis, solo los últimos 30 días |
| Recipes | Granola: prompts guardados que se corren con `/`, para una o varias reuniones, compartibles por link | **falta** | |
| Personas y empresas | Granola arma un directorio con los asistentes del calendario y muestra todas sus reuniones | **falta** | No deja cargar personas a mano |

### 9. Organizar y compartir (0/10)

| Capacidad | Wispr Flow + Granola | Voice | Nota |
|---|---|---|---|
| Compartir por link | Granola: link con acceso por invitación, workspace o cualquiera; roles lector y colaborador | **falta** | El link web muestra el resumen, no la transcripción |
| Espacios y carpetas | Granola: "Mis notas" privado, espacio del equipo, espacios propios y carpetas con un nivel de subcarpetas | **falta** | |
| Copiar y exportar | Granola copia en Markdown y abre un borrador en Gmail u Outlook | **falta** | |

### 10. Integraciones y API (0/10)

| Capacidad | Wispr Flow + Granola | Voice | Nota |
|---|---|---|---|
| Slack y Notion | Granola manda notas a Slack (gratis) y a Notion (Business) | **falta** | |
| CRM | Granola Business: HubSpot, Attio y Affinity; Salesforce en Enterprise | **falta** | En la suite sería el CRM propio |
| Zapier | Granola Business | **falta** | En la suite sería Flow |
| Servidor MCP | Granola y Wispr exponen las notas a Claude, ChatGPT y otros clientes MCP | **falta** | |
| API y webhooks | Granola: API de notas, transcripciones, carpetas y espacios, con webhooks | **falta** | |

### 11. Equipos, privacidad y admin (0/10)

| Capacidad | Wispr Flow + Granola | Voice | Nota |
|---|---|---|---|
| Diccionario y snippets del equipo | Wispr Pro: compartidos en el workspace; Granola Business: diccionario del workspace | **falta** | |
| Aviso de grabación | Granola: mensaje automático en el chat de Meet, Zoom, Teams y Slack, aviso en el calendario y marca de agua; Wispr también publica un aviso | **falta** | |
| Retención y borrado | Granola borra el audio después de transcribir y deja borrar transcripciones solas; Wispr controla cuánto guarda el Notetaker | **falta** | |
| SSO y SCIM | Wispr Growth (SSO) y Enterprise (SCIM); Granola Enterprise | **falta** | |

## Resumen de puntajes

| Área | Puntaje |
|---|---|
| Dictado en cualquier app | 0 |
| Limpieza y formato con AI | 0 |
| Diccionario, snippets y estilos | 0 |
| Comandos de voz y reescritura | 0 |
| Escritorio, móvil y uso | 0 |
| Captura de reuniones | 0 |
| Notas y resúmenes con AI | 0 |
| Chat con las reuniones | 0 |
| Organizar y compartir | 0 |
| Integraciones y API | 0 |
| Equipos, privacidad y admin | 0 |

## Precios de Wispr Flow y Granola

Verificado el 2026-10-25 en las páginas de precios oficiales.

### Wispr Flow

| | Free | Pro | Growth | Enterprise |
|---|---|---|---|---|
| Por usuario al mes, anual | USD 0 | USD 12 | USD 18 (USD 26 con Notetaker ilimitado) | A medida, solo anual |
| Por usuario al mes, mensual | USD 0 | USD 15 | USD 23 (USD 33 con Notetaker ilimitado) | No hay |
| Límite de dictado | 2.000 palabras por semana en escritorio, uso semanal limitado en móvil | Sin límite | Sin límite | Sin límite |
| Notetaker | Acceso limitado | Más historial | Ilimitado en la opción de USD 26 / 33 | Ilimitado |
| Equipo y admin | | Diccionario y snippets compartidos, facturación central, paneles de uso | SSO SAML, HIPAA con BAA, varios dominios | SCIM, logs de auditoría, MDM, soporte con SLA |

El anual tiene 20% de descuento. La página muestra dos precios en Growth sin decir cuál es cuál: los rastreadores de precios (UsagePricing, octubre de 2026) dicen que USD 18 / 23 es Growth y USD 26 / 33 es Growth con Notetaker ilimitado. Hasta el 5/10/2026 Growth y Enterprise eran una sola tarjeta.

### Granola

| | Basic | Business | Enterprise |
|---|---|---|---|
| Por usuario al mes | USD 0 | USD 14 | USD 35 |
| Historial | 30 días | Ilimitado | Ilimitado |
| AI | Notas, chat con modelo automático, plantillas, recipes | Elegir modelo (incluido de razonamiento), briefs antes de la reunión, emails de seguimiento | Lo mismo, con controles de admin |
| Integraciones | Slack, MCP de los últimos 30 días | Notion, Zapier, HubSpot, Attio, Affinity, MCP, API | Salesforce, Audit API, controles por integración |
| Admin | | Facturación central, diccionario del workspace | SSO, SCIM, retención de la org, HIPAA, MDM en iOS |

Granola publica un solo precio por usuario y mes, sin opción anual con descuento en la página. Su blog dice que Business se cobra mensual con prorrateo al sumar o sacar personas. Todos los miembros de un workspace van en el mismo plan.

### Para la comparación

Quien hoy usa los dos paga Wispr Flow Pro (USD 12 anual o USD 15 mensual) más Granola Business (USD 14): USD 26 por usuario al mes en anual y USD 29 en mensual.

## Cómo lo vamos a hacer

- **Transcripción por `lib/ai.ts`**, con el proveedor elegido por variable de entorno, igual que el resto de la AI de la suite (cuota por workspace, modelo configurable, se apaga con `AI_ENABLED=false`). La limpieza del dictado y las notas de reunión usan el mismo modelo que ya usa la suite.
- **Web primero.** La primera versión graba desde el navegador: dictado en la propia suite (Docs, Notes, Track, CRM) y reuniones con el micrófono y el audio de una pestaña compartida. Notas, plantillas, chat y compartir viven en `/app/voice`.
- **Escritorio después, con Tauri v2.** Para lo que el navegador no puede: atajo global, pegar en cualquier app y capturar el audio del sistema sin bot.
- **Ventajas de la suite:**
  - la reunión queda en el timeline del contacto y la empresa del CRM, y los pendientes se pasan a issues de Track;
  - el calendario sale de Cal, sin conectar nada aparte;
  - el chat cruza reuniones con Docs y Notes;
  - código abierto y self-host: el audio y las transcripciones pueden quedar en un servidor propio;
  - un solo producto para dictado y reuniones, que hoy son dos suscripciones.

## Top 10 gaps para la primera versión

| # | Gap | Por qué importa | Esfuerzo |
|---|---|---|---|
| 1 | Grabar una reunión desde el navegador (micrófono y audio de pestaña) con transcripción | Sin esto no hay notas de reunión | L |
| 2 | Notas mejoradas con AI que mezclan lo escrito y la transcripción | Es la razón para usar Granola | M |
| 3 | Plantillas de notas (de fábrica y propias) | Cada tipo de reunión pide otra estructura | S |
| 4 | Dictado con limpieza AI (muletillas, puntuación, backtrack) dentro de la suite | Es la razón para usar Wispr Flow | M |
| 5 | Diccionario personal y de equipo | Sin nombres bien escritos, el dictado no sirve en el trabajo | S |
| 6 | Chat sobre una reunión y sobre muchas | Es lo más usado después de las notas | M |
| 7 | Lista de reuniones con búsqueda, carpetas y Cmd+K | Lista común de toda app | M |
| 8 | Compartir por link con roles | Las notas se mandan a quien no estuvo | S |
| 9 | Calendario desde Cal y vínculo con el CRM | Nuestra ventaja más clara frente a Granola | M |
| 10 | App de escritorio Tauri con atajo global y audio del sistema | Dictar en cualquier app y grabar sin bot | L |

Fuera del top 10: Command Mode, snippets, estilos por app, modo para código, móvil, recipes, personas y empresas, briefs y emails de seguimiento, MCP, API y webhooks, aviso de grabación automático, SSO.

## Bugs encontrados

No aplica: Voice todavía no tiene código.

## Fuentes

Wispr Flow:

- Precios: https://wisprflow.ai/pricing
- Funciones: https://wisprflow.ai/features
- Help center: https://docs.wisprflow.ai
- Using Wispr Flow (31 artículos): https://docs.wisprflow.ai/collections/7303194563-using_wispr_flow
- Wispr Notetaker (25 artículos): https://docs.wisprflow.ai/collections/8559995472-wispr_notetaker
- Atajos: https://docs.wisprflow.ai/articles/2612050838-supported-unsupported-keyboard-hotkey-shortcuts
- Command Mode: https://docs.wisprflow.ai/articles/4816967992-how-to-use-command-mode
- Styles: https://docs.wisprflow.ai/articles/2368263928-how-to-setup-flow-styles
- Smart Formatting y Backtrack: https://docs.wisprflow.ai/articles/5373093536-how-do-i-use-smart-formatting-and-backtrack
- IDEs: https://docs.wisprflow.ai/articles/6434410694-use-flow-with-cursor-vs-code-and-other-ides
- Snippets: https://docs.wisprflow.ai/articles/5784437944-create-and-use-snippets
- Diccionario: https://docs.wisprflow.ai/articles/4052411709-teach-flow-your-words-with-the-dictionary
- MCP: https://docs.wisprflow.ai/articles/9551372685-connect-an-mcp-client-to-wispr-flow-remote-mcp-server
- Separación de Growth y Enterprise (5/10/2026): https://www.usagepricing.com/blueprint/activity/wisprflow-2026-10-05-growth-enterprise-split

Granola:

- Precios: https://www.granola.ai/pricing
- Facturación mensual de Business: https://www.granola.ai/blog/granola-pricing-startups-free-trial-discounts
- Índice de docs: https://docs.granola.ai/llms.txt
- Transcripción: https://docs.granola.ai/help-center/taking-notes/transcription.md
- Notas mejoradas con AI: https://docs.granola.ai/help-center/taking-notes/ai-enhanced-notes.md
- Plantillas: https://docs.granola.ai/help-center/taking-notes/customise-notes-with-templates.md
- Chat: https://docs.granola.ai/help-center/getting-more-from-your-notes/chatting-with-your-meetings.md
- Recipes: https://docs.granola.ai/help-center/getting-more-from-your-notes/recipes.md
- Compartir: https://docs.granola.ai/help-center/sharing/sharing-notes.md
- Espacios y carpetas: https://docs.granola.ai/help-center/sharing/folders/spaces-and-folders.md
- Personas y empresas: https://docs.granola.ai/help-center/people-and-companies.md
- Integraciones: https://docs.granola.ai/help-center/sharing/integrations/integrations-with-granola.md
- MCP: https://docs.granola.ai/help-center/sharing/integrations/mcp.md
- API: https://docs.granola.ai/introduction.md
- Aviso de grabación: https://docs.granola.ai/help-center/consent-security-privacy/transparency-solutions/introduction.md
- Borrado de transcripciones: https://docs.granola.ai/help-center/consent-security-privacy/transcript-auto-deletion.md
