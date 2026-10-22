# Benchmark: Agents vs Intercom Fin, Chatbase y Voiceflow

Fecha: 2026-10-22. Base: `main` en `644c85b`.

## Cómo se hizo

### Competidores

Leímos las páginas públicas de precios, la documentación y los changelogs de 2025 y 2026 de Fin (Intercom), Chatbase y Voiceflow. Las fuentes están al final.

- **Fin** cobra $0.99 por "outcome" desde marzo de 2026.
- **Chatbase** cuesta de $40 a $500 por mes con créditos de mensajes.
- **Voiceflow** sacó los precios públicos. Según reseñas de terceros, el plan Pro sale $60 por mes y Business $150 por mes.

### Nuestra app

Leímos el código:

- `lib/agents*.ts` y `lib/agent-tools.ts`;
- `components/agents/*`;
- `app/api/agents/**`, `app/api/v1/agents/**`;
- el canal Chat en `lib/agents-chat.ts`.

También leímos los tests: `tests/unit/agents*.test.ts`, `chat-api-agent-approvals.test.ts` y `tests/e2e/agents.spec.ts`.

Además hicimos un recorrido con Playwright sobre un build de producción en DEMO_MODE:

1. Crear un agente desde una plantilla.
2. Recorrer las 7 pestañas.
3. Mandar un mensaje en el playground.
4. Publicar el agente en `/a/<handle>` y escribirle como visitante.
5. Crear un test.
6. Mirar la lista de agentes y Cmd+K.
7. Revisar el editor a 390 px en modo oscuro.

### Limitaciones

- **Sin modelo.** El gateway de AI local no tiene créditos y el modelo devuelve `ai_no_credits`. Por eso no pudimos medir la calidad de las respuestas, el uso de herramientas ni el juez de tests en vivo. El runtime se evaluó por el código y los tests unitarios: `runAgent` con tope de pasos, herramientas en modo simulación y aprobaciones.
- **Sin números de velocidad.** La máquina estaba saturada y usamos un servidor compartido, así que no reportamos tiempos.

## Capacidades por área

Leyenda: **tiene**, **parcial**, **falta**, **mejor** (mejor que el mejor de los tres).

### 1. Construcción del agente (6/10)

| Capacidad | zerosoft | Competencia |
|---|---|---|
| Instrucciones en texto libre | tiene (hasta 12.000 caracteres) | Fin Guidance, Chatbase instructions, Voiceflow global prompt |
| Plantillas | tiene: soporte, SDR que agenda y calificador de leads, cada una con sus herramientas | Chatbase y Voiceflow tienen más plantillas |
| Mensaje de bienvenida, emoji, nombre | tiene | |
| Guardrails | parcial: temas a evitar y largo máximo de respuesta | Fin tiene Guidance con el chequeo "Optimize" de reglas que chocan entre sí |
| Procedimientos de varios pasos deterministas | parcial: el agente puede correr un Flow (`run_flow`) pero no sigue un procedimiento paso a paso | Fin Procedures (if/else, código, esperar un webhook), Voiceflow Workflows y Chatbase Procedures |
| Instrucciones distintas por canal | falta | Chatbase |
| Memoria del cliente entre conversaciones | falta | Fin Memory |

### 2. Conocimiento (4/10)

| Capacidad | zerosoft | Competencia |
|---|---|---|
| Páginas de Docs | **mejor**: todas las páginas públicas, o una por una, sin sincronizar nada porque son de la misma suite | Los tres importan contenido |
| URLs | parcial: hasta 20 URLs, se descargan al guardar y se re-sincronizan todos los días | Chatbase y Voiceflow rastrean el sitio entero o el sitemap con patrones |
| Archivos (PDF, DOCX, TXT, CSV) | falta: la pestaña Conocimiento no tiene subida de archivos (probado) | Chatbase hasta 20 MB por archivo; Voiceflow incluye tablas CSV/XLSX |
| Pares de pregunta y respuesta | parcial: las respuestas guardadas de un widget de Chat | Chatbase Q&A con variantes y carga por .xlsx |
| Notion, Zendesk, Shopify, tickets cerrados | falta | Chatbase y Voiceflow |
| Recuperación semántica y citas en la respuesta | falta: BM25 en memoria, sin links a la fuente. Ya está en el backlog | Los tres |

### 3. Herramientas y acciones (7/10)

| Capacidad | zerosoft | Competencia |
|---|---|---|
| CRM: buscar contacto, crear o actualizar, agregar nota | **mejor**: nativo y sin configuración | Fin y Chatbase por conectores (Salesforce, HubSpot) |
| Agendar con disponibilidad real | tiene: Cal | Chatbase (Cal.com, Calendly), Fin (Chili Piper, HubSpot Meetings) |
| Crear un issue en Track | tiene | |
| Correr un Flow o un Robot | **mejor**: la automatización y el scraping son de la misma suite | |
| HTTP con headers secretos y dominios permitidos | tiene | Fin data connectors, Voiceflow API tool, Chatbase custom action |
| Aprobación humana antes de escribir | tiene, por herramienta | Fin "Ask a teammate" en Procedures |
| MCP | falta | Fin (incluye Zapier MCP), Voiceflow |
| Botones y formularios en el chat (captura de leads) | falta | Chatbase collect leads, custom button |
| Stripe, Shopify, búsqueda web | falta | Chatbase |
| Código propio (JS o Python) | falta | Voiceflow Functions, Fin Python blocks |

### 4. Pruebas y QA (5/10)

| Capacidad | zerosoft | Competencia |
|---|---|---|
| Playground | tiene: las herramientas de escritura no se ejecutan, solo se simulan, y se ve la entrada y la salida de cada una | Los tres |
| Tests guardados con juez LLM | tiene: hasta 50 tests, "Guardar como test" desde el playground y correrlos antes de publicar | Voiceflow Tests, Fin regression |
| Simulación de varios turnos con un cliente AI | falta: cada test es una sola pregunta | Fin Simulations, Voiceflow AI-simulated users |
| Repetir conversaciones reales en lote | falta | Fin Batch Test, Voiceflow Evaluations |
| Comparar modelos lado a lado | falta | |

### 5. Canales (3/10)

| Capacidad | zerosoft | Competencia |
|---|---|---|
| Widget web | tiene: el bot de un widget de Chat, con derivación a la bandeja | Los tres |
| Página pública | tiene: `/a/<handle>` | Chatbase help page |
| API | tiene: `/api/v1/agents/:id/messages` con clave | Los tres |
| Nodo de Flow | **mejor**: el agente se usa como paso de una automatización | |
| WhatsApp, Instagram, Messenger, Slack | falta | Chatbase y Fin |
| Email | falta (ya está en el backlog) | Fin over email, Chatbase |
| Voz y teléfono | falta | Fin Voice 2, Chatbase (Twilio/SIP), Voiceflow |
| SDK mobile | falta | Chatbase iOS/Android |

### 6. Derivación a una persona (7/10)

| Capacidad | zerosoft | Competencia |
|---|---|---|
| Deriva cuando el cliente lo pide, cuando no está seguro o por palabra clave | tiene | Fin escalation rules |
| Mensaje de derivación configurable | tiene | |
| El equipo responde desde la pestaña Conversaciones o desde la bandeja de Chat | tiene | Chatbase takeover, Fin con Workflows |
| Deja de responder después de derivar en todos los canales | tiene | |
| Motivo de la derivación en los reportes | parcial: se cuentan las derivaciones, sin el motivo | Fin escalation reporting |

### 7. Versiones y colaboración (2/10)

| Capacidad | zerosoft | Competencia |
|---|---|---|
| Borrador y versión publicada, historial, rollback | falta (ya está en el backlog) | Voiceflow environments, Fin versioning |
| Entornos dev, staging y prod, A/B | falta | Voiceflow |
| Registro de quién cambió qué | falta | Fin changelog |
| Comentarios y roles de solo lectura | falta | Voiceflow Viewer |

### 8. Seguridad y administración (5/10)

| Capacidad | zerosoft | Competencia |
|---|---|---|
| Secretos cifrados, que el modelo nunca ve | tiene (`secret-box`) | Fin (atributos inyectados), Voiceflow (secrets) |
| Dominios permitidos para HTTP y SSRF bloqueado | tiene (`safeFetch`) | |
| Límites por conversación y por workspace | tiene | Chatbase limita por dispositivo |
| Redacción de datos personales en los transcripts | falta | Voiceflow |
| Spam y bloqueo por país | falta | Chatbase |
| Roles por agente | falta | Voiceflow; Chatbase solo en Enterprise |

### 9. Analítica (6/10)

| Capacidad | zerosoft | Competencia |
|---|---|---|
| Resolución, derivaciones, conversaciones, tiempo promedio | tiene (7, 30 o 90 días) | Los tres |
| Errores por herramienta y corridas que tocaron el tope de pasos | **mejor**: ninguno lo muestra tan directo | |
| Temas | parcial: agrupados por palabra clave, sin modelo | Fin Topics Explorer, Chatbase topics con CSV |
| Pulgares | tiene | |
| Alertas cuando suben los pulgares abajo o los errores | tiene | Fin Monitors |
| CSAT, sentimiento, CX score con AI | falta | Fin CX Score, Chatbase sentiment |
| Desglose por canal | parcial: solo conteos de 7 días en la lista | Chatbase |

### 10. Modelos (8/10)

| Capacidad | zerosoft | Competencia |
|---|---|---|
| Elegir el modelo | **mejor que Fin**: cualquier `proveedor/modelo` del AI Gateway | Fin no deja elegir; Chatbase y Voiceflow sí |
| Temperatura | tiene | Chatbase, Voiceflow |
| Modelo de respaldo | falta | Voiceflow Business |
| Mensaje de error útil para el dueño | tiene: indica dónde cambiar el modelo | |

### 11. Control de calidad de las respuestas (4/10)

| Capacidad | zerosoft | Competencia |
|---|---|---|
| Respuestas basadas en tu contenido, con derivación si no sabe | tiene | Los tres |
| Citas y links a la fuente | falta | Fin, Chatbase |
| Revisión de calidad de conversaciones (scorecards, cola de revisión) | falta | Fin Monitors |
| Preguntas sin respuesta convertidas en contenido | falta (ya está en el backlog) | Fin content recommendations, Chatbase source suggestions |

### 12. Importar y exportar (1/10)

| Capacidad | zerosoft | Competencia |
|---|---|---|
| Exportar o duplicar la configuración de un agente | falta | Chatbase duplicate, Voiceflow export |
| Exportar conversaciones | parcial: solo por API | Chatbase CSV |

### 13. Pulido de UX (7/10)

| Capacidad | zerosoft | Nota |
|---|---|---|
| De la plantilla al editor en 1 clic | tiene | |
| Pestañas con flechas, Home y End; un solo Guardar con Cmd+S | tiene | |
| Avanzado plegado, lo básico a la vista | tiene | |
| Cmd+K encuentra agentes | tiene | |
| 390 px y modo oscuro | tiene: sin scroll horizontal (probado) | |
| Agentes en la barra lateral | falta | La barra muestra solo "Agentes", sin la lista |

## Resumen de puntajes

| Área | Puntaje |
|---|---|
| Construcción | 6 |
| Conocimiento | 4 |
| Herramientas | 7 |
| Pruebas | 5 |
| Canales | 3 |
| Derivación | 7 |
| Versiones | 2 |
| Seguridad | 5 |
| Analítica | 6 |
| Modelos | 8 |
| Calidad | 4 |
| Importar/exportar | 1 |
| UX | 7 |
| **Paridad global** (promedio simple frente al mejor de los tres en cada área) | **50%** |

Por competidor:

- **Chatbase:** la paridad estimada es de 55%. Nos ganan en fuentes y canales; les ganamos en acciones nativas y aprobaciones.
- **Fin:** 45%. Nos ganan en procedimientos, simulaciones, voz y CX score.
- **Voiceflow:** 45%. Nos ganan en ciclo de vida (entornos y evaluaciones) y en voz.

## Paridad de UX en el flujo principal

| Flujo | zerosoft | Chatbase |
|---|---|---|
| Crear un agente útil | 1 clic en "Usar plantilla". Las páginas públicas de Docs ya están como conocimiento | Crear el agente, cargar fuentes y esperar el entrenamiento |
| Publicarlo en el sitio | Canales → asignarlo a un widget de Chat. Si no hay widget, crearlo y pegar el snippet: unos 4 pasos | Copiar el embed: 2 pasos |
| Probar | Playground en la misma página, simulado. "Guardar como test" en cada respuesta | Playground |

## Top 10 gaps (impacto para un equipo chico que viene de Fin o Chatbase)

| # | Gap | Por qué vuelven | Esfuerzo | ¿En el backlog? |
|---|---|---|---|---|
| 1 | Subir archivos (PDF, DOCX, TXT, CSV) como conocimiento | Los manuales y las listas de precios están en PDF. Sin esto, el agente no sabe lo básico | M | nuevo |
| 2 | Rastrear un sitio o un sitemap entero (más de 20 URLs) | El centro de ayuda viejo vive en otro dominio con cientos de páginas | M | nuevo |
| 3 | Recuperación semántica con citas | Las preguntas con otras palabras no encuentran nada con BM25, y sin link nadie confía en la respuesta | M | sí |
| 4 | WhatsApp como canal del agente | En LatAm es el canal principal de soporte y ventas | L | nuevo (Flow tiene un nodo de WhatsApp en el backlog) |
| 5 | Versiones con borrador, publicación y rollback | Una instrucción mal editada rompe el agente en producción | M | sí |
| 6 | Email como canal | Fin over email es el uso número dos | L | sí |
| 7 | Simulaciones de varios turnos y repetir conversaciones reales | Los tests de una sola pregunta no prueban reservas ni calificación | M | nuevo |
| 8 | Contexto del visitante identificado (CRM, Cal, Track) | "¿Dónde está mi pedido?" necesita saber quién pregunta | M | sí |
| 9 | Formularios y botones en el chat (captura de leads, opciones rápidas) | El SDR pierde leads si los datos se piden en texto libre | M | nuevo |
| 10 | Sentimiento y CSAT por conversación, puntuados con AI | Sin eso no hay forma de saber si el agente trata bien a los clientes | S/M | nuevo |

También en el JSON: conector MCP, procedimientos de varios pasos, exportar e importar agentes, y un camino de respaldo cuando falla el modelo en la página pública o la API.

## Bugs encontrados

1. **La página pública le muestra al visitante un error pensado para el dueño.**
   - Repro:
     1. Publicar un agente en `/a/<handle>` sin créditos en el AI Gateway.
     2. Escribir "hola" como visitante anónimo.
   - Resultado: el visitante lee "El proveedor de AI rechazó el pedido: la cuenta no tiene créditos… Cargá créditos en el AI Gateway de Vercel o elegí un modelo… en Instrucciones > Modelo" (captura `agents-05b-public-reply.png`).
   - El canal Chat cae al bot por palabras clave. La página pública y la API no tienen respaldo, no derivan y no piden un email.
   - Lo esperable: un mensaje genérico para el visitante, la derivación con pedido de email, y la alerta al dueño (las alertas ya existen).

## Fuentes

**Fin (Intercom)**

- Precios: https://fin.ai/pricing, https://www.intercom.com/pricing
- Novedades: https://fin.ai/updates
- Guidance: https://fin.ai/updates/fin-guidance
- Procedures: https://fin.ai/help/en/articles/13976187-fin-procedures-explained
- Data connectors: https://www.intercom.com/help/en/articles/13459820-how-to-use-data-connectors-in-fin-procedures
- Simulations: https://fin.ai/updates/simulations-for-procedures
- Fin Voice: https://www.intercom.com/help/en/articles/16248514-fin-voice-faqs
- Insights: https://community.intercom.com/product-updates/a-new-era-of-insights-has-arrived-10513

**Chatbase**

- Precios: https://www.chatbase.co/pricing
- Fuentes de datos: https://www.chatbase.co/docs/user-guides/chatbot/data-sources.md
- Procedures: https://chatbase.co/docs/user-guides/chatbot/procedures/procedures-overview.md
- Acciones y canales: https://www.chatbase.co/docs/llms.txt
- Playground: https://www.chatbase.co/docs/user-guides/chatbot/playground.md
- Guardrails: https://www.chatbase.co/docs/user-guides/chatbot/guardrails.md
- Analytics: https://www.chatbase.co/docs/user-guides/chatbot/analytics.md
- Takeover: https://chatbase.co/docs/user-guides/chatbot/help-desk/takeover.md

**Voiceflow**

- Documentación: https://www.voiceflow.com/docs
- Fuentes de datos: https://www.voiceflow.com/docs/documentation/build/importing-data-sources.md
- Herramientas: https://www.voiceflow.com/docs/documentation/build/tools/overview.md
- Tests: https://www.voiceflow.com/docs/documentation/measure/tests.md
- Evaluations: https://www.voiceflow.com/docs/documentation/measure/evaluations.md
- Entornos: https://www.voiceflow.com/docs/documentation/deploy/environments/overview.md
- Colaboración: https://www.voiceflow.com/docs/documentation/account-management/collaboration.md
- Changelog: https://www.voiceflow.com/docs/changelog/changelog.md

**Precios de Voiceflow (terceros)**

- https://www.getmacha.com/blog/voiceflow-pricing-explained
- https://www.ringly.io/blog/voiceflow-pricing
