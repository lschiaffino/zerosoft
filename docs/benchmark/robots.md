# Benchmark: Robots vs Browse AI (y Apify para usuarios avanzados)

Fecha: 2026-10-22. Incumbente principal: Browse AI (robots sin código para equipos chicos).
Referencia avanzada: Apify (plataforma de actores, proxies y storage). Método: capacidades públicas
(precios, help center y docs 2025-2026, ver Fuentes), código de Robots en `lib/robots*.ts`,
`components/robots/` y `app/api/v1/robots`, y una pasada en el navegador sobre un build de
producción local (`next start` con DEMO_MODE sobre `main`, runner local con Chromium, Playwright). Los tiempos no se miden: la máquina de prueba estaba saturada.

**Paridad global contra Browse AI: 49 %** (promedio ponderado, ver tabla de puntajes).

Leyenda: **tiene** · **parcial** · **falta** · **mejor** (lo hacemos mejor que el incumbente).

## Resumen

Robots es un intérprete de pasos sobre un Chromium real: ir a URL, clic, completar, elegir,
teclas, esperar, extraer (texto, atributo, lista), extraer tabla, extraer lista de tarjetas con
campos y paginación, scroll, condicional "si existe", loops sobre listas, descargas, subidas, PDF,
capturas y JavaScript. Tiene credenciales con TOTP, sesiones guardadas, horarios con cron, alertas
y pausa por fallas, detección de cambios con diff, exportación CSV, API v1 con corridas en lote y
uso desde Flow y Agents.

La distancia con Browse AI está en cómo se arma un robot y en qué tan bien sobrevive a la web real.
Browse AI se arma con una extensión que graba clics y marca la lista en pantalla, o con Table Studio
(IA) que propone columnas desde una URL. Robots se arma con selectores CSS a mano o con un
bookmarklet que graba clics pero no extracciones. Browse AI además trae proxies residenciales,
resolución de captchas, robots que se reparan solos y 250+ robots prearmados. Robots no tiene
nada de eso.

Donde ganamos: TOTP para 2FA (Browse AI no lo soporta), corrida desde Flow y desde Agents sin
Zapier, y el evento `robot.output.changed` con diff que dispara cualquier flow.

## Capacidades por área

### 1. Armado del robot (5/10)

| Capacidad | Browse AI | Apify | Robots | Nota |
|---|---|---|---|---|
| Grabar clics y escritura en el sitio | extensión de Chrome | n/a (código) | **parcial** | bookmarklet que exporta pasos JSON para pegar |
| Marcar en pantalla la lista o el texto a extraer | Capture List / Text | n/a | **falta** | extracciones se escriben con selectores CSS |
| Armar desde una URL con IA (columnas propuestas) | Table Studio | actores de IA | **falta** | idea "act and extract" en backlog cubre parte |
| Extraer lista de tarjetas con campos | sí | código | **tiene** | `extract_list`, 20 campos, 1.000 filas |
| Extraer tablas HTML | sí | código | **tiene** | `extract_table` |
| Paginación (Siguiente, cargar más, scroll infinito) | las tres | código | **parcial** | Siguiente y scroll; "cargar más" con loop manual |
| Acciones antes de extraer (formularios, clics) | sí | sí | **tiene** | |
| Condicionales y saltos | limitado | código | **mejor** | `if_exists` con skip / goto / stop / fail |
| JavaScript propio | no | sí | **tiene** | `evaluate` |
| Descargas, subidas y PDF | no | sí | **mejor** | hasta 5 archivos de 10 MB |
| Entradas por corrida | sí | input schema | **tiene** | texto y listas, 20 entradas |
| Deep scraping (lista y luego cada detalle) | workflows de 2 robots | sí | **tiene** | `loop_over` con hasta 50 items |
| Datos según país | sí | proxies por país | **falta** | |

### 2. Login y sesiones (8/10)

| Capacidad | Browse AI | Apify | Robots | Nota |
|---|---|---|---|---|
| Usuario y contraseña cifrados | sí | por actor | **tiene** | credenciales del workspace, nunca en logs |
| Cookies / sesión guardada | sí (recomendado) | SessionPool | **tiene** | storage state guardado entre corridas |
| 2FA con TOTP | no | código | **mejor** | secreto TOTP en la credencial |

### 3. Monitoreo (7/10)

| Capacidad | Browse AI | Apify | Robots | Nota |
|---|---|---|---|---|
| Horarios | fijo o repetido, hasta 5 min | cron cada 10 s | **parcial** | diario, intervalo (mínimo 15 min) o cron |
| Detección de cambios | AI, email con colores | con actores | **tiene** | diff por clave, evento `robot.output.changed` |
| Email con el cambio | sí | n/a | **parcial** | el cambio dispara Flow; no hay email de cambio listo sin armar un flow |
| Alertas de falla y pausa automática | sí, con digest | por umbral | **tiene** | pausa tras N fallas seguidas |
| Captura y DOM del paso que falló | video de la sesión | logs | **tiene** | captura, URL y fragmento de DOM |

### 4. Automatización (7/10)

| Capacidad | Browse AI | Apify | Robots | Nota |
|---|---|---|---|---|
| Encadenar robots | workflows | Actor a Actor | **mejor** | cualquier lógica vía Flow |
| Reintentos | Double Check automático | sí | **tiene** | reintentos por paso y continuar si falla |
| Corridas en lote con muchas entradas | 50.000 por lote | sí | **parcial** | 100 entradas por lote en la API v1 |
| Cola cuando hay otra corrida | sí | concurrencia por plan | **parcial** | una corrida a la vez por workspace, el resto en cola |

### 5. Integraciones y API (5/10)

| Capacidad | Browse AI | Apify | Robots | Nota |
|---|---|---|---|---|
| Google Sheets / Airtable con sync | sí | Drive, Airtable | **parcial** | Sheets vía plantilla de Flow (append); sin sync ni Airtable |
| Zapier, Make, n8n | sí | sí | **parcial** | webhooks vía Flow; no hay app en esos catálogos |
| Webhooks | 5 eventos | sí | **tiene** | eventos de corrida terminada, fallida y cambio |
| API REST | v2 | completa | **tiene** | `/api/v1/robots`, corridas, lotes |
| MCP | no oficial | mcp.apify.com | **falta** | Agents usa robots como herramientas, pero no hay MCP externo |
| CRM | vía Zapier | conector HubSpot | **parcial** | Flow puede crear contactos; upsert directo en backlog |
| S3 / storage externo | S3 | sí | **falta** | archivos en Blob propio |

### 6. Admin y permisos (5/10)

| Capacidad | Browse AI | Apify | Robots | Nota |
|---|---|---|---|---|
| Roles | owner / admin / member | roles editables | **parcial** | solo admins y owners crean, editan y corren |
| Permisos por robot | no | por recurso | **falta** | |
| Usuarios incluidos | 3 a 10 según plan | por plan | **mejor** | sin límite de asientos |

### 7. Analítica y reportes (5/10)

| Capacidad | Browse AI | Apify | Robots | Nota |
|---|---|---|---|---|
| Historial por robot con entradas y estado | sí | sí | **tiene** | pasos, datos, capturas por corrida |
| Uso del mes | reporte de créditos por robot | gráficos 30 días | **parcial** | minutos y corridas del mes, sin desglose por robot |
| Tabla acumulada de filas entre corridas | Tables con filtros | datasets | **falta** | cada corrida es su propia tabla |

### 8. Confiabilidad contra la web real (2/10)

| Capacidad | Browse AI | Apify | Robots | Nota |
|---|---|---|---|---|
| Proxies residenciales / rotación | sí | sí, por país | **falta** | IP del runner |
| Captchas y Cloudflare | resuelve los soportados | unblocker | **falta** | |
| Self-healing ante cambios de layout | sí | n/a | **falta** | fallback de selectores en backlog |
| Robots prearmados para sitios populares | 250+ | 27.000+ actores | **falta** | 4 plantillas genéricas |
| Límites de corrida | 60 min | por plan | **parcial** | 180 s por corrida, 20 páginas |

### 9. IA (1/10)

| Capacidad | Browse AI | Apify | Robots | Nota |
|---|---|---|---|---|
| Robot armado por IA | Table Studio | actores | **falta** | |
| Columnas calculadas con IA | formula columns (sep 2026) | n/a | **falta** | |
| Pasos en lenguaje natural | parcial | Browser Use / Stagehand | **falta** | en backlog |

### 10. Importar y exportar (6/10)

| Capacidad | Browse AI | Apify | Robots | Nota |
|---|---|---|---|---|
| CSV | sí | sí | **tiene** | por corrida |
| JSON | sí | sí, + XLSX, XML | **tiene** | copiar JSON |
| Subir entradas en lote desde CSV | sí | sí | **falta** | solo por API |
| Exportar / importar el robot | n/d | sí | **parcial** | pegar pasos JSON; no hay export del robot entero |

### 11. Pulido de UX (6/10)

| Capacidad | Browse AI | Apify | Robots | Nota |
|---|---|---|---|---|
| Ver los datos como tabla y como JSON | sí | sí | **tiene** | Table / JSON, copiar JSON, descargar CSV por variable |
| Detalle por paso con tiempos | video de la sesión | logs | **tiene** | tabla de pasos con detalle ("books: 60 rows · 3 pages") |
| Ayuda contextual para selectores | n/a | n/a | **tiene** | panel de tips, logins y TOTP al lado de los pasos |
| Plantillas | 250+ prearmados | Store | **parcial** | 4 plantillas genéricas |
| 390 px y oscuro | n/d | n/d | **tiene** | lista y editor sin scroll horizontal |
| Teclado | n/d | n/d | **tiene** | pestañas con flechas, menú ⋯ por paso con Esc |

## Puntajes

| Área | Peso | Puntaje |
|---|---|---|
| Armado del robot | 20 % | 5 |
| Login y sesiones | 6 % | 8 |
| Monitoreo | 10 % | 7 |
| Automatización | 8 % | 7 |
| Integraciones y API | 12 % | 5 |
| Admin y permisos | 4 % | 5 |
| Analítica y reportes | 6 % | 5 |
| Confiabilidad contra la web real | 14 % | 2 |
| IA | 8 % | 1 |
| Importar y exportar | 4 % | 6 |
| Pulido de UX | 8 % | 6 |
| **Paridad global** | | **49 %** |

## Paridad de UX en los flujos principales

Probado en el navegador (`/en/app/robots`, robots con prefijo "Robots bench"):

| Flujo | Browse AI | Robots | Nota |
|---|---|---|---|
| Primer robot | extensión: abrir el sitio, clic en la lista, aprobar columnas | plantilla o robot vacío, escribir selectores CSS | **peor**: hace falta saber CSS |
| Extraer una lista paginada | Capture List + paginación en el recorder | paso "Extract list" con selector de tarjeta, campos y "Next button selector" | funciona: 60 libros en 3 páginas de books.toscrape.com |
| Correr y ver datos | Run task, tabla | "Run robot", "Run now", pestaña Runs con pasos, datos y entradas | **paridad** |
| Exportar | CSV / JSON / Sheets | "Download CSV" por variable, "Copy JSON" | parcial (sin sync a Sheets) |
| Grabar pasos | extensión con panel | bookmarklet a la barra de favoritos, copiar JSON, "Paste steps" | **peor**: 4 pasos manuales y no graba extracciones |
| Estado vacío | ejemplos | "No robots yet" + crear + 4 plantillas con su secuencia de pasos | **paridad** |
| 390 px y oscuro | n/d | sin scroll horizontal | **paridad** |

## Top 10 gaps (impacto para un equipo chico que viene de Browse AI)

| # | Gap | Por qué se vuelven | Esfuerzo |
|---|---|---|---|
| 1 | Marcar en pantalla qué extraer (lista, texto) | sin saber CSS no pueden armar el primer robot | L |
| 2 | Robot armado con IA desde una URL | Table Studio lo resuelve en un minuto | M |
| 3 | Proxies residenciales y manejo de captchas | los sitios que más les importan (marketplaces, inmobiliarias) bloquean IPs de datacenter | M |
| 4 | Self-healing de selectores | un cambio de layout rompe el robot y no se enteran hasta mirar | M |
| 5 | Sync a Google Sheets y Airtable sin armar un flow | es la salida por defecto en Browse AI | S |
| 6 | Email de cambio listo para monitores | "avisame si cambia el precio" debería ser un clic | S |
| 7 | Tabla acumulada de filas entre corridas | quieren el historial de precios en una tabla, no corrida por corrida | M |
| 8 | Subir entradas en lote desde CSV en la UI y lotes de más de 100 | listas de 1.000 URLs son el caso típico | S |
| 9 | Corridas más largas y más de 20 páginas | 180 s no alcanza para paginar catálogos | M |
| 10 | Robots prearmados para sitios populares | atajo para el primer valor | L |

## Bugs encontrados

1. **Texto invisible en el botón "Table" activo de los datos de una corrida.** Repro: correr un
   robot con un paso Extract list, abrir la pestaña Runs: la vista arranca en Table y el botón
   seleccionado muestra texto blanco sobre gris claro (modo claro). El botón usa
   `className="btn btn-sm"` con `aria-pressed` en `components/robots/RunsPanel.tsx`; el estilo
   del estado presionado no define un color de texto legible para ese fondo.

## Fuentes

- Browse AI precios: https://www.browse.ai/pricing
- Browse AI funciones: https://www.browse.ai/features
- Extensión de Chrome: https://help.browse.ai/en/articles/10492719-how-to-build-a-robot-using-the-chrome-extension
- IA en Browse AI (Table Studio, captchas, self-healing): https://help.browse.ai/en/articles/10486935-how-browse-ai-uses-ai
- Acciones antes de extraer: https://help.browse.ai/en/articles/10497039-can-my-robot-fill-out-a-form-or-perform-an-action-before-extracting-data
- Login: https://help.browse.ai/en/articles/10518514-can-my-robot-log-in-to-websites
- Cookies vs credenciales (2FA): https://help.browse.ai/article/105-cookies-vs-credentials
- Bulk run y API v2: https://www.browse.ai/docs/api/v2
- Monitoreo y notificaciones: https://www.browse.ai/monitor y https://help.browse.ai/en/articles/10524268-how-to-set-up-monitoring-notifications
- Fallas y sitios que cambian: https://help.browse.ai/en/articles/12271136-does-browse-ai-support-websites-that-change-frequently
- Roles: https://help.browse.ai/en/articles/12313816-understanding-workspace-roles-and-permissions
- Reporte de uso: https://help.browse.ai/en/articles/10477976-track-your-browse-ai-usage-with-the-usage-report
- Exportar datos: https://help.browse.ai/en/articles/10477537-how-to-view-manage-and-export-your-scraped-data
- Columnas con IA: https://help.browse.ai/en/articles/14111634-how-to-create-formula-columns-with-ai
- Sitios soportados y proxies: https://help.browse.ai/en/articles/10452902-what-websites-work-with-browse-ai
- Apify precios: https://apify.com/pricing
- Apify storage: https://docs.apify.com/platform/storage/dataset
- Apify schedules: https://docs.apify.com/platform/schedules
- Apify monitoring: https://docs.apify.com/platform/monitoring
- Apify integraciones: https://docs.apify.com/platform/integrations
- Apify MCP: https://docs.apify.com/integrations/mcp
- Apify proxies: https://docs.apify.com/proxy
