# Inbox y Lines: cifrado de los mensajes (diseño)

Estado: propuesta, sin implementar. Espera las decisiones del dueño (al final).
Fecha: 2026-11-17. Vale para las dos apps: Inbox (`inbox_*`, de cada persona) y
Lines (`groups_*`, del equipo).

## Resumen

- Hoy el texto de los mensajes, sus vistas previas, resúmenes, transcripciones y
  avisos se guardan en texto plano en Turso. Lo único cifrado por la app son
  credenciales y tokens (#146, `lib/secret-box.ts`) y parte de los archivos.
- "Punta a punta" en sentido estricto no es posible mientras el servidor sea el
  dispositivo de WhatsApp: el mensaje llega descifrado a Evolution (Railway) y a
  nuestro webhook. Lo que sí se puede elegir es quién puede leer lo **guardado**.
- Recomendación: **opción A**, cifrado en reposo con claves por workspace (Lines)
  y por persona (Inbox) envueltas por una clave maestra que no está en la base.
  Protege contra una base o un backup filtrados y contra quien solo tiene acceso a
  Turso, y mantiene búsqueda, IA, MCP, automatizaciones y multi-dispositivo.
- La búsqueda pasa a un **índice ciego** (palabras y prefijos con HMAC); se pierde
  buscar un pedazo en medio de una palabra.
- La opción B (el servidor no puede leer nada guardado) rompe IA, MCP, agentes,
  HubSpot, exportaciones y búsqueda del servidor, y obliga a manejar claves en
  cada dispositivo. Queda como posible extra opcional para chats puntuales de
  Inbox (opción C), no como base.

## 1. Qué hay hoy

### Dónde está el texto de los mensajes

| Tabla | Columnas con contenido | Dueño de la fila |
| --- | --- | --- |
| `inbox_messages` | `body`, `subject`, `media_name`, `meta` (citas, miniaturas, avisos de grupo), `reactions`, `email_to`, `email_cc`, `sender_name`, `sender_handle` | persona (`owner_id`) |
| `inbox_threads` | `preview`, `summary` (resumen IA), `notes`, `draft`, `title`, `handle`, `info` | persona |
| `inbox_scheduled` | `body` (envíos programados) | persona |
| `inbox_messages_fts` | índice FTS5 de `body`, `subject`, `media_name`, `sender_name` (las tablas internas del índice guardan las palabras) | persona |
| `groups_messages` | `body` (incluye notas internas, `direction = 'note'`), `media_name`, `meta`, `translations`, `poll`, `sender_name`, `sender_phone` | workspace (`user_id`) |
| `groups_chats` | `last_message_preview`, `name`, `phone`, `description` | workspace |
| `groups_messages_fts` | índice FTS5 de `body` | workspace |
| `groups_notifications` | `body` (hasta 240 caracteres del mensaje, para el push) | workspace + persona |
| `groups_tickets`, `groups_broadcasts`, `groups_recurring`, `groups_quick_replies`, `groups_templates` | títulos y textos escritos por el equipo (a veces copiados de un mensaje) | workspace |
| `wa_transcripts` | `text`, `summary` de audios (Inbox y Lines) | persona o workspace |
| `wa_link_previews` | URL, título y descripción de links compartidos (caché global, no por workspace) | nadie |

Los archivos (fotos, audios, documentos) van por `lib/private-files.ts` (Inbox,
`INBOX_MEDIA_*`) y `lib/files/store.ts` (Lines). Los dos cifran con su propia
clave (`*_FILES_KEY`) **solo** cuando caen en el store público o en disco; si
está configurado el store privado de Vercel Blob (`INBOX_MEDIA_BLOB_READ_WRITE_TOKEN`,
`FILES_BLOB_READ_WRITE_TOKEN`), se guardan sin cifrado de la app (solo el del
proveedor).

### Cómo entran

- WhatsApp (Inbox y Lines): Evolution API en Railway es el "dispositivo vinculado"
  de cada número. Descifra el mensaje de WhatsApp, guarda su propia copia en su
  Postgres (tabla `Message`, que usamos para importar historial y bajar archivos) y
  llama a `app/api/inbox/webhook/[id]/[secret]` o `app/api/groups/webhook/[id]/[secret]`
  con el texto plano. `lib/inbox/whatsapp.ts` y `lib/groups.ts` lo guardan.
  Lines también tiene el proveedor oficial (Cloud API de Meta,
  `lib/groups-provider-cloud.ts`): mismo resultado, Meta entrega texto plano.
- Gmail (Inbox): `lib/inbox/gmail.ts` trae los correos por la API de Google.
  Google tiene el original.
- Lo que manda la persona: el navegador manda texto plano por HTTPS, el servidor
  lo guarda y se lo pasa a Evolution o a Meta para enviarlo.

### Quién lee el texto

| Lector | Dónde | Qué lee |
| --- | --- | --- |
| Interfaz (lista, chat abierto, panel de info) | `lib/inbox/core.ts`, `lib/groups.ts` | todo |
| Búsqueda en mensajes | `lib/inbox/message-search.ts` (FTS5 + `LIKE` de respaldo), `lib/groups.ts` (`body LIKE`), `lib/app-search.ts` (Cmd+K, `body LIKE`), `lib/inbox/core.ts` (filtro de la lista) | texto en SQL |
| Conteos de links | `lib/inbox/wa-meta.ts`, `lib/groups-person.ts` (`body LIKE '%http%'`) | texto en SQL |
| IA de Inbox (borradores, reescribir, resumen) | `lib/inbox/ai.ts`, `lib/inbox/wa-summary.ts` | últimos mensajes y notas, a OpenRouter o al Gateway |
| IA de Lines (tareas, tickets, traducción) | `lib/groups-ai.ts`, `app/api/groups/translate` | mensajes del chat |
| Agente de Agents en un chat de Lines | `lib/groups-agent.ts` | cada mensaje entrante y el historial de la conversación del agente |
| Asistente ⌘J | `lib/assistant/tools-chats.ts` (`inbox_read_chats`, `lines_read_chats`) | últimos mensajes |
| MCP de Lines | `lib/groups-mcp.ts` (`/api/v1/groups/mcp`, con API key) | mensajes |
| API REST de Lines | `lib/groups-v1.ts` | mensajes |
| Analytics (BI) | `lib/bi/zs-tables.ts` expone `groups_messages.body` a SQL de la persona | texto en SQL |
| Exportaciones | `app/api/groups/export`, `lib/privacy.ts` (exportar mis datos) | todo |
| Push | `lib/groups-push.ts`: el push sale sin contenido; el texto queda en `groups_notifications` y el service worker lo pide con la sesión | hasta 240 caracteres |
| Integraciones salientes | `lib/groups-integrations.ts` (Slack, Freshdesk, Zoho), webhooks `groups.message.received` (`lib/webhooks-events.ts`), notas diarias a HubSpot (`groups_hubspot_notes`), Flow | texto, sale de zerosoft |
| Reglas y tickets por palabra clave | `lib/groups-rules.ts`, `lib/groups-tickets.ts` | texto al llegar |
| Transcripción de audios | `lib/wa-extras.ts`, `lib/groups-transcript.ts` | audio, a un proveedor de IA |
| Fleet | `lib/fleet/link.ts`: avisos al "mensaje a mí mismo" de Inbox y respuestas citando el aviso | texto de ese chat |
| Desktop y mobile | `desktop/` (escritorio) y `mobile/` (Capacitor) muestran la misma web | igual que el navegador |

### Lo que ya hizo #146

- `lib/key-ring.ts`: anillo de claves maestras en `ENCRYPTION_KEYS` (`id:clave`,
  la activa primero). Sin la variable sigue la clave heredada `0`, derivada de
  `ENCRYPTION_KEY`. **En producción todavía no está configurada** (decisión
  pendiente del dueño), así que hoy todo se escribe en el formato `enc:v1:`.
- `lib/secret-box.ts` v2: cifrado en sobre con una DEK aleatoria **por valor**,
  envuelta con una subclave HKDF de la maestra. Pensado para pocos valores
  (tokens), no para millones de mensajes.
- `scripts/rotate-encryption-keys.ts`: recorre todas las tablas y vuelve a cifrar
  con compare-and-set. Salta las tablas virtuales de búsqueda.
- `docs/security/encryption.md` explica por qué no se hizo punta a punta en todo.
- Además existe un caso de punta a punta real: notas bloqueadas de Notes
  (`lib/notes-crypto.ts`, PBKDF2 + AES-GCM en el navegador).
- La verificación en dos pasos (TOTP) existe (`lib/account-security.ts`) pero es
  opcional para todos, también dueños y admins.

### Copias que no están en nuestra base

Cualquier opción de esta página solo cubre Turso (y sus backups). Siguen
existiendo copias del texto en:

- Postgres de Evolution en Railway (tabla `Message`), sin retención propia
  mientras la cuenta está activa.
- Google (Gmail), Meta (Cloud API), el teléfono de la persona y el de su contacto.
- Proveedores de IA cuando se usa una función de IA (OpenRouter, Gateway, el de
  transcripción).
- HubSpot, Slack, Freshdesk, Zoho y los webhooks salientes, si el workspace los
  conectó.

## 2. Qué significa "punta a punta" acá

WhatsApp cifra de teléfono a teléfono. Cuando un número se conecta a Inbox o
Lines, Evolution pasa a ser uno de esos teléfonos: los mensajes se descifran
ahí, en un servidor nuestro. Con Gmail, Google tiene el texto antes que
nosotros. Por eso:

- Ninguna opción puede impedir que el servidor vea un mensaje **en el momento en
  que llega o sale**. Para recibir y mandar, el texto pasa por Evolution y por
  la función que lo procesa.
- Lo que se puede decidir es qué pasa **después**: si lo guardado lo puede leer
  el servidor (opción A) o solo los dispositivos de las personas (opción B).
- Llamar "punta a punta" a la opción B sería engañoso en la web y en ventas. El
  nombre honesto es "cifrado con clave del cliente" o "el servidor no puede leer
  el historial". La opción A es "cifrado en reposo con claves por workspace".

## 3. Amenazas

| Amenaza | Hoy | A | B | C (A + chats privados) |
| --- | --- | --- | --- | --- |
| Se filtra un volcado o backup de Turso | se lee todo | protegido (la base no tiene la maestra) | protegido | protegido |
| Alguien con acceso solo a Turso (consola, token de solo base) | lee todo | protegido | protegido | protegido |
| Empleado de zerosoft con acceso a Vercel (variables) y a Turso | lee todo | lee todo (con KMS aparte, queda registrado y se puede separar quién tiene qué) | no lee lo guardado | no lee los chats privados |
| Servidor comprometido (código o función tomados) | lee todo | lee todo | lee lo que entra desde ese momento y puede servir JavaScript que robe claves | igual que B para los chats privados |
| Proveedor (Turso) curioso o con orden judicial | lee todo | protegido mientras no tenga la maestra | protegido | protegido |
| Sesión robada de una persona | lee lo suyo | lee lo suyo | lee lo suyo si la clave está desbloqueada en ese navegador | igual |
| Copia en Evolution (Railway) | lee todo | sin cambio | sin cambio, salvo que se apague el guardado de Evolution | sin cambio |

## 4. Opción A: cifrado en reposo con claves por workspace y por persona

### Cómo funciona

- Una **clave de contenido (DEK)** de 256 bits por alcance: una por workspace para
  Lines y una por persona para Inbox (Inbox es de la persona y ni un admin la
  ve, así que su clave tampoco se comparte).
- Las DEK viven en una tabla nueva `content_keys (scope, scope_id, id, wrapped,
  created_at, retired_at)`, envueltas con una subclave HKDF de la maestra activa
  de `ENCRYPTION_KEYS` (propósito `content:wrap`, distinto del de secret-box).
- Cada campo cifrado: `ct:v1:<id de DEK>:<iv>.<tag>.<datos>` con AES-256-GCM y
  AAD `<tabla>.<columna>|<scope_id>`: un valor copiado a otro workspace o a otra
  columna no abre. No se ata al id de fila porque varias rutas copian textos
  entre filas del mismo dueño (`lib/wa-dedupe.ts`, importaciones, reenviar).
- Las DEK abiertas se guardan en memoria de la función un rato corto (LRU con
  vencimiento de minutos). Una página de 50 mensajes es una sola lectura de
  clave y 50 descifrados AES, que en Node con AES-NI cuestan microsegundos.
- Lectura doble: `openContent()` acepta texto plano heredado, `ct:v1:` y
  devuelve `''` si no abre (igual que `open()` hoy). Así se puede desplegar,
  revertir y migrar sin cortar nada.

### Rotación

- Rotar la maestra (lo que pide `encryption.md` cada 12 meses) solo vuelve a
  envolver las DEK: una fila por workspace y por persona, no millones de
  mensajes. `scripts/rotate-encryption-keys.ts` se extiende a `content_keys`.
- Rotar una DEK (si se sospecha de una en particular) crea otra, escribe con la
  nueva y un script vuelve a cifrar en segundo plano las filas de ese alcance,
  con compare-and-set. Es raro; no hace falta automatizarlo de entrada.

### Borrado

- Al borrar un workspace o una persona (`runDueErasures` en `lib/privacy.ts`),
  además de borrar las filas se borra su DEK. Lo que quede en backups de Turso
  sigue cifrado con una DEK que también está en ese backup, envuelta con la
  maestra: el borrado definitivo en backups llega cuando vence su retención o
  cuando se rota la maestra y se saca la vieja. Esto hay que decirlo así en la
  documentación, sin prometer más.

### Qué cambia en cada cosa

- **Búsqueda.** Las tablas FTS5 actuales guardan las palabras en claro: con A
  se borran (junto con sus triggers) y se reemplazan por un índice ciego:
  - Al guardar o editar un mensaje, la app normaliza el texto como hoy
    (`unicode61`, sin tildes, minúsculas), y por cada palabra escribe
    `HMAC(clave de búsqueda del alcance, palabra)` truncado, más los prefijos
    desde 2 letras en otra columna. La clave de búsqueda sale por HKDF de la
    DEK del alcance.
  - Se guarda en una FTS5 sin contenido (`content=''`) con dos columnas:
    `w` (palabras en orden, para frases exactas) y `p` (prefijos).
  - Buscar: la consulta se tokeniza igual y se buscan los HMAC. Siguen andando
    palabras, prefijos ("contra" encuentra "contrato"), frases y los filtros
    `from:`, `in:`, `has:`, `before:`, `after:`. Se pierde buscar un pedazo en
    medio de una palabra (hoy el respaldo `LIKE` lo hace).
  - El fragmento con lo encontrado resaltado se arma después de descifrar, con
    `markSnippet()` que ya existe.
  - Lo que se filtra: dentro de un mismo alcance, palabras iguales dan el mismo
    HMAC (se puede contar frecuencia con la base y mucho tiempo). Entre
    workspaces no se puede cruzar.
  - Los `LIKE` sobre `body` (Cmd+K, lista de Lines, filtro de Inbox, conteo de
    links) pasan al índice ciego o a una columna `has_link` calculada al guardar.
    Analytics deja de ofrecer `body` en `groups_messages` (o lo descifra en la
    app después de la consulta, con el tope de filas que ya tiene).
- **IA, asistente y MCP.** Sin cambios visibles: el servidor descifra antes de
  mandar al modelo, igual que hoy lee. El texto sigue saliendo a los
  proveedores de IA cuando se usa una función de IA.
- **Webhooks entrantes y reglas.** Sin cambios: el texto llega en claro, las
  reglas y el agente lo usan, y se guarda cifrado.
- **Integraciones salientes** (Slack, HubSpot, webhooks, Flow): sin cambios; el
  texto sale descifrado a donde el workspace eligió.
- **Push.** Sin cambios en el envío. `groups_notifications.body` se cifra con la
  DEK del workspace (y conviene vaciarlo al entregarlo, ver huecos).
- **Multi-dispositivo, desktop y mobile.** Sin cambios: las claves no salen del
  servidor.
- **Invitar a alguien.** Sin cambios: el acceso sigue siendo el de hoy (rol,
  etiquetas, líneas).
- **Recuperar acceso.** Ninguna persona maneja claves. El riesgo pasa a ser
  perder la maestra: tiene que haber copia fuera de Vercel (gestor de secretos
  del dueño) y estar escrita en el procedimiento de rotación.
- **Rendimiento.** Descifrar es barato. Lo que cuesta: escribir el índice ciego
  en cada mensaje (hoy lo hace un trigger de SQLite gratis), el texto ocupa un
  poco más (base64 más 28 bytes por campo) y el índice con HMAC pesa más que el
  de palabras. Estimación, no medición: hay que medirlo con una copia de datos
  de prueba en la fase 3.
- **Migración.** Un script como el de rotación cifra las filas viejas por
  lotes, con compare-and-set, y llena el índice ciego. Los backups de Turso
  anteriores quedan en claro hasta que vence su retención.
- **Puntos frágiles.** Todo lo que escribe `body` tiene que pasar por la misma
  función (hoy hay escrituras en `lib/inbox/whatsapp.ts`, `lib/groups.ts`,
  importaciones, dedupe, ediciones, borrados, programados). Un test que busque
  `INSERT`/`UPDATE` de esas columnas fuera del módulo evita que alguien escriba
  en claro sin querer. Las consultas SQL que lean `body` dejan de tener sentido
  y hay que listarlas (sección 1).

### Costo

Mediano: unas 6 a 8 PRs chicas (sección 8). Sin cambios de interfaz salvo la
búsqueda por pedazo de palabra.

## 5. Opción B: el servidor no puede leer lo guardado

### Cómo funciona

- Cada persona tiene un par de claves (X25519) creado en su navegador. La
  privada se guarda envuelta con algo que el servidor no tiene: una frase de la
  persona o una passkey (extensión PRF de WebAuthn). La pública se guarda en el
  servidor.
- Inbox: cada mensaje que llega se cifra **al llegar** con la clave pública de
  la persona (sobre sellado) y se guarda así. El texto plano solo vive en la
  memoria de la función mientras procesa el webhook.
- Lines: una clave por workspace, guardada envuelta una vez por cada miembro
  con su clave pública. Los mensajes se cifran al llegar con una clave pública
  del workspace.
- Cada dispositivo (navegador, desktop, mobile) desbloquea la clave con la
  frase o la passkey, o se vincula desde otro dispositivo con un QR.

### Qué se rompe o cambia

- **Búsqueda.** El servidor no puede buscar. La búsqueda pasa al dispositivo: un
  índice local (IndexedDB) que se arma bajando y descifrando el historial. En
  mobile y en cuentas con mucho historial es lento y pesado, y cada
  dispositivo nuevo lo arma de cero. Cmd+K deja de encontrar mensajes.
- **IA y asistente.** Solo a pedido y desde el dispositivo: el navegador
  descifra y manda el texto a la función de IA en ese pedido, sin guardarlo. Los
  resúmenes guardados (`summary`) y la transcripción guardada tendrían que
  cifrarse del lado del cliente.
- **MCP y API REST de Lines.** Una API key no tiene la clave: el MCP y la API
  quedan solo con metadatos (quién, cuándo, estado), o la persona tiene que
  cargar una clave en el cliente MCP (casi nadie lo hace).
- **Agente de Agents en Lines, reglas, tickets por palabra, Flow.** Pueden
  actuar sobre el mensaje en el momento en que llega (todavía es texto plano),
  pero no sobre el historial. El agente pierde el contexto de la conversación
  guardada.
- **HubSpot (notas diarias), exportaciones, Analytics.** Dejan de andar desde el
  servidor. Exportar pasa al navegador.
- **Envíos programados, difusiones y recurrentes.** El servidor necesita el
  texto a la hora de mandar: quedan en claro hasta que salen, o se pierden.
- **Push.** Sin texto: "Nuevo mensaje en X".
- **Evolution.** Mientras guarde su tabla `Message`, el historial completo sigue
  en claro en Railway. Apagar ese guardado rompe la importación de historial y
  la bajada de archivos tal como están hoy.
- **Invitar a alguien a Lines.** Un miembro que ya tiene la clave tiene que estar
  conectado para envolverla para el nuevo. Hasta entonces el nuevo no ve el
  historial.
- **Perder la clave.** Sin frase ni passkey, el historial se pierde. Si
  zerosoft guarda una copia para recuperar, volvemos a la opción A.
- **Servidor comprometido.** Como la app es web, quien controle el servidor
  puede servir JavaScript que robe la clave al desbloquearla. B protege lo
  guardado contra filtraciones, no contra un servidor tomado.
- **Migración.** El servidor cifra el historial con las claves públicas una
  última vez (lee todo en claro por última vez). Los backups viejos siguen en
  claro hasta que vencen.

### Costo

Grande: meses, cambios en casi toda la interfaz de Inbox y Lines, en el
asistente, el MCP, la API y Analytics, y soporte nuevo por claves perdidas.

## 6. Opción C: A para todo, y chats privados en Inbox

- Todo lo de la opción A.
- Más adelante, si alguien lo pide: en Inbox (no en Lines, que es de equipo) una
  persona puede marcar un chat como privado. Ese chat se cifra con su clave
  (como las notas bloqueadas de Notes) y pierde búsqueda del servidor, IA,
  asistente y resúmenes. El resto de Inbox sigue igual.
- Sirve para quien quiere un chat puntual fuera del alcance de zerosoft sin
  pagar el costo de B en todo.
- Costo: el de A más algo mediano para el chat privado. Se puede decidir
  después de A, no bloquea nada.

## 7. Comparación

| | A | B | C |
| --- | --- | --- | --- |
| Base o backup filtrados | protegido | protegido | protegido |
| Empleado con acceso a todo | no protege | protege lo guardado | protege los chats privados |
| Búsqueda | palabras y prefijos (sin pedazos en medio) | solo en el dispositivo | A; los privados sin búsqueda |
| IA, asistente, MCP, agentes | igual que hoy | a pedido desde el dispositivo; MCP sin texto | igual que hoy salvo los privados |
| Multi-dispositivo e invitaciones | igual que hoy | vincular cada dispositivo; invitar requiere a otro miembro | igual que hoy |
| Perder la clave | no aplica a personas | se pierde el historial | se pierde ese chat |
| Costo | mediano | grande | mediano, en dos tiempos |

## 8. Recomendación y plan por fases

Recomendación: **A**, con C como opción futura. A cubre lo que piden auditores y
clientes (base filtrada, acceso a la base, borrado por workspace) sin romper lo
que hace útil a Inbox y Lines. En la web y en ventas se dice "cifrado en reposo
con claves por workspace", no "punta a punta".

Una PR por fase, cada una se puede revertir sola:

0. **Dueño:** configurar `ENCRYPTION_KEYS` en producción (procedimiento de
   `docs/security/encryption.md`) y decidir los puntos de la sección 10. Sin la
   maestra la opción A no tiene sentido (se usaría la clave heredada).
1. **Claves de contenido.** `lib/content-keys.ts` y migración de `content_keys`;
   formato `ct:v1:`, AAD, caché en memoria, tests. Nada lo usa todavía.
2. **Lectura doble.** Las funciones que arman los DTO de mensajes y chats
   (`lib/inbox/core.ts`, `lib/groups.ts`, asistente, MCP, exportaciones,
   privacidad) pasan por `openContent()`. Sigue escribiendo en claro. Un test
   que falle si alguien escribe esas columnas sin pasar por el módulo.
3. **Índice ciego.** Tablas nuevas, escritura desde la app en cada alta, edición
   y borrado, búsqueda de Inbox, Lines y Cmd+K con bandera, columna `has_link`.
   Medir tamaño y tiempos con datos de prueba.
4. **Inbox escribe cifrado** (bandera `MESSAGE_ENCRYPTION=inbox`): mensajes,
   vista previa, resumen, notas, borrador, programados, transcripciones.
5. **Lines escribe cifrado** (bandera `MESSAGE_ENCRYPTION=inbox,lines`):
   mensajes y notas internas, traducciones, encuestas, vista previa, avisos de
   push, transcripciones. Analytics sin `body` o descifrado en la app.
6. **Historial.** Script de backfill (como `rotate-encryption-keys.ts`, con
   conteo, `--apply` y compare-and-set), después borrar las FTS5 viejas y sus
   triggers. Registrar la fecha: los backups de Turso anteriores siguen en claro
   hasta vencer.
7. **Borrado y rotación.** Borrar la DEK en `runDueErasures`; rotación de la
   maestra que vuelve a envolver `content_keys`; actualizar
   `docs/security/encryption.md`, `data-map.md` y `retention.md`.
8. **Fuera de Turso (opcional).** Retención de la tabla `Message` de Evolution y
   cifrado del volumen de Railway.

Nombres y contactos (`sender_name`, `sender_phone`, `handle`, `title`) quedan
fuera de la primera vuelta: se usan para cruzar contactos y deduplicar. Se
pueden sumar después con un índice ciego propio.

## 9. Huecos de privacidad encontrados (no se arreglan en esta PR)

1. **`groups_notifications` guarda el texto para siempre.** Hasta 240 caracteres
   del mensaje quedan en la fila después de entregado el push; ningún cron borra
   los entregados ni los vencidos (más de 24 h). Arreglo chico: vaciar `body` al
   entregarlo y borrar en el cron horario lo de más de 24 h.
2. **Archivos sin cifrado de la app con el store privado.** Con
   `FILES_BLOB_READ_WRITE_TOKEN` o `INBOX_MEDIA_BLOB_READ_WRITE_TOKEN` los
   archivos de Lines e Inbox se guardan sin cifrar por la app (solo el cifrado
   de Vercel). Con el store público sí se cifran. Vale decidir si el privado
   también cifra, para que un token de Blob filtrado no alcance.
3. **Caché global de links.** `wa_link_previews` guarda la URL completa de cada
   link compartido (puede llevar tokens en la query) en una tabla sin dueño; se
   borra a las dos semanas, pero no al borrar la cuenta. Arreglo chico: guardar
   un hash de la URL como clave.
4. **Copia de Evolution sin retención.** La tabla `Message` del Postgres de
   Evolution tiene todo el historial en claro mientras la cuenta está activa y
   no figura en `docs/security/retention.md`.
5. **Secreto del webhook en la URL.** `/api/inbox/webhook/[id]/[secret]` y
   `/api/groups/webhook/[id]/[secret]` llevan el secreto en la ruta, que queda
   en los logs de requests de Vercel. No es contenido, pero quien lea los logs
   puede mandar mensajes falsos a ese número. Arreglo: secreto en un header.
6. **Mensaje de error de la IA en el log.** `lib/inbox/ai.ts` (línea 326)
   escribe hasta 200 caracteres del mensaje de error del proveedor; algunos
   proveedores repiten parte de lo que se les mandó. Arreglo: loguear solo nombre
   y código.
7. **Analytics expone el texto.** `lib/bi/zs-tables.ts` da `groups_messages.body`
   a consultas SQL de la persona (con los permisos de Lines). Es a propósito,
   pero con la opción A deja de funcionar y hay que decidir si se mantiene.

El resto de los logs de Inbox, Lines y Fleet solo escriben el nombre del error,
sin contenido.

## 10. Decisiones que necesita el dueño

1. **Opción:** (a) A, cifrado en reposo con claves por workspace y por persona
   (recomendada) · (b) C, A ahora y chats privados en Inbox más adelante ·
   (c) B, el servidor no puede leer lo guardado.
2. **`ENCRYPTION_KEYS` en producción:** (a) generarla ya y rotar cada 12 meses
   según `docs/security/encryption.md` (recomendada) · (b) esperar a tener KMS.
3. **Dónde vive la maestra:** (a) variable sensible de Vercel, con copia en el
   gestor de secretos del dueño (recomendada para empezar) · (b) KMS externo
   (AWS o GCP), con costo mensual y acceso separado del de Vercel.
4. **Búsqueda:** (a) índice ciego: palabras, prefijos y frases, sin pedazos en
   medio de una palabra (recomendada) · (b) mantener el índice en claro (la base
   filtrada sigue mostrando las palabras) · (c) sin búsqueda en el texto.
5. **Alcance de la primera vuelta:** (a) texto de mensajes y todo lo derivado:
   vistas previas, resúmenes, transcripciones, notas internas, borradores,
   traducciones, avisos (recomendada) · (b) solo el texto de los mensajes.
6. **Historial:** (a) cifrar todo lo viejo con el backfill y aceptar que los
   backups anteriores de Turso siguen en claro hasta vencer (recomendada) ·
   (b) cifrar solo desde la fecha del cambio.
7. **Verificación en dos pasos:** (a) obligatoria para dueños y admins de
   workspaces con Lines o Inbox conectados (recomendada) · (b) sigue opcional.
8. **Copia de Evolution:** (a) retención de 90 días en la tabla `Message` ·
   (b) 30 días · (c) dejarla como está y documentarlo.
