# WAHA contra Evolution API para Lines e Inbox

Estado: análisis, sin cambios de código. Fecha: 2026-11-18.
Fuentes: el código de zerosoft (`lib/groups-provider*.ts`, `lib/inbox/whatsapp.ts`, `lib/wa-*.ts`),
`infra/evolution/`, la documentación de WAHA (waha.devlike.pro/docs, revisada el 18/11, versión 2026.10.1) y el
repo de Evolution (`evolution-foundation/evolution-api`, rama `develop`).

No se corrió WAHA en local: esta Mac no tiene Docker. La forma de la API sale de la documentación y del Swagger
publicado (`https://waha.devlike.pro/swagger/openapi.json`), no de una prueba. Lo que la documentación no dice está
marcado como "no documentado".

## Resumen

- **WAHA ya no tiene versión paga.** Desde la 2026.6.1 lo que era WAHA Plus (sesiones ilimitadas, mandar media,
  guardar sesiones en Postgres, S3, seguridad) está en la imagen pública, con licencia Apache 2.0. Solo queda una
  donación opcional de USD 5 por mes sin beneficios. La comparación de "Core contra Plus" de antes ya no aplica.
- **WAHA no tiene hoy tres cosas que Lines e Inbox usan todos los días:** pedirle al teléfono el historial de un
  chat (`/chat/fetchHistory`, parches 0002 y 0006), avisar por webhook el archivado hecho desde el teléfono con un
  motor liviano (`chat.archive` solo existe en WEBJS, que corre un Chromium por sesión), y bajar un archivo viejo con
  su `mediaKey` sin que el gateway lo tenga guardado (`lib/wa-media-wire.ts`).
- **Los parches de app-state (0005, 0010) son de Baileys, no de Evolution.** NOWEB usa un fork de Baileys mantenido
  por WAHA y GOWS usa whatsmeow (Go). Con GOWS esos problemas desaparecen o cambian de forma, pero GOWS no archiva.
- **Recomendación:** seguir con Evolution como proveedor de producción. Mantener el adaptador `waha` que ya existe y
  probarlo con GOWS en una línea de prueba antes de ofrecerlo a clientes. Volver a evaluar en marzo de 2027 o antes si
  Evolution deja de recibir los arreglos que mandamos upstream.

## Qué usamos de Evolution hoy

Lines (`groups_*`) e Inbox (`inbox_*`) hablan con el mismo servidor de Evolution 2.3.7 con parches
(`infra/evolution/`), una instancia por número. El adaptador es `evolutionProvider` en
`lib/groups-provider-bridge.ts`; el modo administrado (`lib/groups-provider-managed.ts`) crea la instancia con un
token propio, e Inbox lo reusa (`lib/inbox/whatsapp.ts`).

### Endpoints

| Uso | Endpoint de Evolution | Para qué |
|---|---|---|
| Instancias | `POST /instance/create`, `GET /instance/connect/{i}`, `GET /instance/connectionState/{i}`, `GET /instance/fetchInstances`, `DELETE /instance/logout/{i}`, `DELETE /instance/delete/{i}` | Alta con token por instancia, QR, estado, baja. |
| Ajustes | `POST /settings/set/{i}` | Ajustes de la instancia al crearla. |
| Webhook | `POST /webhook/set/{i}`, `GET /webhook/find/{i}` | URL, eventos y el header `x-zerosoft-webhook-secret`. |
| Mandar | `POST /message/sendText`, `sendMedia`, `sendWhatsAppAudio`, `sendSticker`, `sendReaction`, `sendPoll`, `sendContact` | Texto con menciones y respuesta, archivos, notas de voz, stickers, reacciones, encuestas, vCards. |
| Editar y borrar | `POST /chat/updateMessage/{i}`, `DELETE /chat/deleteMessageForEveryone/{i}` | Editar y borrar para todos. |
| Leído | `POST /chat/markMessageAsRead/{i}`, `GET /chat/fetchPrivacySettings/{i}` | Tildes azules y saber si la cuenta los tiene apagados. |
| Archivar | `POST /chat/archiveChat/{i}` (con 409 `app_state_unavailable`, parches 0004 y 0010) | Archivar desde Inbox y Lines (`lib/wa-archive-sync.ts`). |
| Historial guardado | `POST /chat/findChats/{i}`, `POST /chat/findMessages/{i}`, `POST /chat/findContacts/{i}` | Importar chats, mensajes y contactos al conectar (`HistorySource`). |
| Historial del teléfono | `POST /chat/fetchHistory/{i}` (parches 0002 y 0006) | "Cargar mensajes anteriores" y huecos (`lib/wa-history-gaps.ts`). |
| Media recibida | `POST /chat/getBase64FromMediaMessage/{i}` con la key, o con el mensaje entero y su `mediaKey` | Bajar archivos, también los que Evolution no guardó. |
| Perfil | `POST /chat/fetchProfile/{i}`, `POST /chat/fetchProfilePictureUrl/{i}`, `POST /chat/whatsappNumbers/{i}`, `POST /chat/updateBlockStatus/{i}`, `POST /chat/sendPresence/{i}` | Nombre, foto, si el número tiene WhatsApp, bloquear, "escribiendo". |
| Grupos | `GET /group/fetchAllGroups/{i}`, `GET /group/findGroupInfos/{i}`, `GET /group/participants/{i}`, `POST /group/create`, `updateParticipant`, `updateGroupSubject`, `updateGroupDescription`, `updateGroupPicture`, `updateSetting`, `toggleEphemeral`, `inviteCode`, `revokeInviteCode`, `acceptInviteCode`, `leaveGroup` | Todo lo de Lines con grupos. |

### Eventos del webhook

`EVOLUTION_EVENTS` en `lib/groups-provider-bridge.ts`:

| Evento | Qué hacemos con él |
|---|---|
| `MESSAGES_UPSERT` | Mensajes nuevos, propios y ajenos. Con el parche 0002 también el aviso `zsUndecryptable` (mensaje que no se pudo descifrar). |
| `MESSAGES_SET` | Historial al vincular y lo que manda el teléfono después de `fetchHistory`. |
| `MESSAGES_UPDATE` | Tildes (enviado, entregado, leído) y ediciones. En grupos solo con el parche 0011. |
| `MESSAGES_DELETE` | Borrado para todos. |
| `CHATS_SET`, `CHATS_UPSERT`, `CHATS_UPDATE` | Lista de chats y archivado, fijado y no leídos desde el teléfono (parche 0001). |
| `CONTACTS_UPSERT` | Nombres, fotos y la equivalencia lid ↔ teléfono. |
| `GROUP_PARTICIPANTS_UPDATE` | Altas, bajas, admins. |
| `GROUPS_UPSERT` | Grupo nuevo para la cuenta. |
| `GROUP_UPDATE` | Asunto, descripción y foto cambiados (parche 0008). |
| `PRESENCE_UPDATE` | "Escribiendo", "grabando", en línea. |
| `CONNECTION_UPDATE`, `QRCODE_UPDATED` | Estado de la línea y QR. |
| `CALL` | Registro de llamadas. |

## WAHA en pocas palabras

- **Licencia:** Apache 2.0 (archivo `LICENSE` del repo `devlikeapro/waha`). Evolution también es Apache 2.0.
- **Plus:** ya no existe. La imagen `devlikeapro/waha` trae todo; la imagen privada `waha-plus` dejó de hacer falta
  en la 2026.6.1. Sesiones ilimitadas, media, Postgres y S3, HMAC, reintentos, dashboard y claves por sesión están en
  la imagen gratis.
- **Mantenimiento:** releases mensuales (2026.9.1, 2026.9.2, 2026.10.1 del 28/10). Unas 7.900 estrellas.
- **Motores:**
  - **WEBJS:** un Chromium con WhatsApp Web por sesión (whatsapp-web.js). El más completo y el más pesado.
  - **NOWEB:** Node, sobre un fork de Baileys. Sin guardar nada por defecto: hay que prender
    `config.noweb.store.enabled` para listar chats, mensajes y contactos.
  - **GOWS:** Go, por WebSocket (whatsmeow). Presentado como el reemplazo de NOWEB. Sincroniza todo el historial por
    defecto (se limita con `WAHA_GOWS_DEVICE_HISTORY_SYNC_*`, y cambiarlo pide volver a escanear el QR).
  - La documentación no marca ninguno como beta ni estable y avisa que los payloads cambian entre motores.
- **Autenticación:** `X-Api-Key` con `WAHA_API_KEY`, y `/api/keys` crea claves de administrador o por sesión con
  permisos (read, send, control, setting, app, delete). Sirve para el modo administrado como hoy el token por
  instancia de Evolution.
- **Webhooks:** por sesión (`config.webhooks[]`) o globales (`WHATSAPP_HOOK_URL`), con `customHeaders`, HMAC SHA-512
  en `X-Webhook-Hmac` y reintentos (constante, lineal o exponencial). Evolution no firma ni reintenta.
- **Sesiones guardadas:** volumen local (`/app/.sessions`), Postgres (una base por sesión; el usuario necesita crear y
  borrar bases) o MongoDB (deprecado, sin GOWS).
- **Media recibida:** se guarda 180 segundos por defecto (`WHATSAPP_FILES_LIFETIME=0` la deja), o en Postgres o S3
  (`WAHA_MEDIA_STORAGE`).

### Recursos (FAQ de WAHA, por contenedor)

| Sesiones | WEBJS | NOWEB | GOWS |
|---|---|---|---|
| 1 | 0,3 CPU / 400 MB | 0,1 CPU / 200 MB | 0,1 CPU / 200 MB |
| 10 | 3 CPU / 2,5 GB | 1 CPU / 2 GB | 0,5 CPU / 1 GB |
| 50 | 15 CPU / 20 GB | 2 CPU / 4 GB | 1,5 CPU / 3 GB |
| 100 | sin dato | 4 CPU / 8 GB | 3 a 5 CPU / 5 GB |

WEBJS no escala para un servicio con muchas líneas: 50 sesiones piden 20 GB. GOWS está en el orden de Evolution
(un proceso Node con Baileys para todas las instancias). Imagen: unos 760 MB para `:gows` y `:noweb`, 1,07 GB para la
de WEBJS.

## Comparación por funcionalidad

"Parche" = lo tenemos en Evolution solo por un parche de `infra/evolution/patches/`.

| Lo que usamos | Evolution 2.3.7 + parches | WAHA WEBJS | WAHA NOWEB | WAHA GOWS |
|---|---|---|---|---|
| Varias líneas por servidor | Sí, una instancia por número | Sí | Sí | Sí |
| Token por línea (modo administrado) | Sí (token de instancia) | Sí (`/api/keys` por sesión) | Sí | Sí |
| QR y código de vinculación | Sí | Sí (`/auth/qr`, `/auth/request-code`) | Sí | Sí |
| Texto, menciones, respuesta, vista previa | Sí | Sí | Sí | Sí |
| Imagen, video, archivo, nota de voz | Sí | Sí (imagen solo JPEG; voz OGG/Opus o `convert`) | Sí | Sí |
| Sticker animado | Sí (parche 0009) | `sendSticker`; animación no documentada | Igual | Igual |
| Reacciones | Sí | Sí | Sí | Sí |
| Encuestas y votos | Sí | Sí | Sí (votos guardados cifrados) | Sí |
| vCard | Sí | Sin verificar | Sin verificar | Sin verificar |
| Editar y borrar para todos | Sí | Sí | Sí | Sí |
| Fijar mensaje | No | Sí | Sí | No |
| Reenvío nativo | No | Sí | Sí | No |
| Mensajes temporales en grupos | Sí | No expuesto | No | No |
| Tildes 1:1 | Sí | Sí (`message.ack`; en WEBJS pide `tagsEventsOn`) | Sí | Sí |
| Tildes en grupos | Parche 0011 (un `READ` cuando leyeron todos) | `message.ack.group` por participante; soporte por motor no documentado | Igual | Igual |
| Marcar leído / saber si la cuenta tiene apagados los tildes azules | Sí / Sí | `sendSeen` / no | Igual | Igual |
| Archivar desde la app | Sí (con 409 si la línea no puede, parches 0004 y 0010) | Sí | Sí, con store | **No** |
| Archivado desde el teléfono por webhook | Parche 0001 (`CHATS_UPDATE` con `archived`) | Sí (`chat.archive`) | **No** | **No** |
| Lista de chats y mensajes guardados (importar al conectar) | Sí (`findChats`, `findMessages`, Postgres de Evolution) | Sí | Con `store.enabled` (3 meses o 1 año) | Sí (todo el historial sincronizado) |
| Pedirle historial al teléfono (huecos, "cargar anteriores") | Parches 0002 y 0006 | No documentado | No documentado | No documentado |
| Mensaje que no se pudo descifrar | Parche 0002 (pide reenvío y avisa) | `message.waiting` | No | No |
| Bajar un archivo viejo con su `mediaKey` | Sí (`getBase64FromMediaMessage` con el mensaje entero) | No: la media se baja al llegar y vive 180 s salvo S3/Postgres | Igual | Igual |
| Grupos: crear, miembros, admins, asunto, descripción, foto, ajustes, link, unirse, salir | Sí | Sí (y borrar grupo) | Sí | Sí |
| Grupo nuevo / cambios de asunto, descripción, foto por webhook | `GROUPS_UPSERT` / parche 0008 | `group.v2.join`, `group.v2.update` | Igual | Igual |
| Metadata de grupos sin 429 al conectar | Parche 0004 | No documentado | No documentado | No documentado |
| Presencia | Sí | Sí | Sí | Sí |
| Llamadas | Sí (`CALL`) | `call.received/accepted/rejected` | Igual | Igual |
| lid ↔ teléfono | Por contactos y `remoteJidAlt` | API `/lids` | Con store | Sí (resuelve lids desconocidos desde 2026.8.1) |
| Bloquear contacto | Sí | Sí | No | No |
| Webhook con header propio | Sí (`headers`) | Sí (`customHeaders`) + HMAC | Igual | Igual |
| Reintentos del webhook | No | Sí | Sí | Sí |

## Qué pasa con cada parche nuestro en WAHA

| Parche | En WAHA |
|---|---|
| 0001 archivado del teléfono en `CHATS_UPDATE` | Solo WEBJS (`chat.archive`). Con NOWEB y GOWS se pierde. Mandado a Evolution como #2791. |
| 0002 / 0006 historial del teléfono | No existe. "Cargar mensajes anteriores" quedaría limitado a lo que el motor guardó al vincular. |
| 0003 releer app-state a mano | No aplica. |
| 0004 429 de metadata de grupos | No documentado. La parte genérica se mandó a Evolution (ver abajo). |
| 0005 / 0010 MAC y claves de app-state | Problemas de Baileys. NOWEB depende de su fork; GOWS usa whatsmeow y no archiva. |
| 0007 filtro de `getLastMessage` | Ya está arreglado en `develop` de Evolution. |
| 0008 cambios de grupo al webhook | `group.v2.update` lo cubre. |
| 0009 sticker animado | No documentado; habría que probarlo. |
| 0011 tildes en grupos | `message.ack.group` (por participante; contar "leyeron todos" queda de nuestro lado). |

## Arreglos de los parches en Evolution upstream

Evolution se mudó a `evolution-foundation/evolution-api` (los PRs van contra `develop`). Estado al 18/11:

| Parche | Upstream |
|---|---|
| 0001 estado del chat en `CHATS_UPDATE` | Nuestro PR #2791, abierto. |
| 0004 (parte genérica: guardar la metadata de `groups.update` en vez de pedir cada grupo) | Nuestro PR #2797, abierto. El resto de 0004 (pausa después de un 429, 409 al archivar) queda como parche. |
| 0009 sticker animado en base64 e `isAnimated` | Nuestro PR #2798, abierto. |
| 0010 (clave de app-state guardada como texto: `AppStateSyncKeyData.fromObject`) | Ya hay dos PRs de otras personas, #2610 y #2685, abiertos. No mandamos otro. |
| 0008 (`GROUP_UPDATE` contra `GROUPS_UPDATE` en el filtro del webhook) | PR #2652 de otra persona, abierto. La parte de foto del grupo y el filtro de la metadata al conectar quedan como parche. |
| 0011 tildes en grupos | PR #2674 de otra persona, abierto (con otro formato de evento). |
| 0007 filtro de `getLastMessage` | Ya arreglado en `develop` (filtra por path). Se puede sacar al subir de versión; solo perdemos el segundo intento con `remoteJidAlt`. |
| 0005 y la parte de Baileys de 0010 | Son de Baileys; `develop` ya usa Baileys rc13 y rc14 trae `appStateMacVerification`. Se sacan al pasar a una versión con rc14. |
| 0002, 0003, 0006, resto de 0010 | Funciones nuestras (historial del teléfono, diagnóstico de app-state). No se mandan. |

## Cómo se vería en nuestro código

Ya existe un adaptador `waha` (`wahaProvider` y `parseWahaWebhook` en `lib/groups-provider-bridge.ts`), elegible en
Ajustes de Lines como opción avanzada con un WAHA propio. Cubre mandar, reaccionar, editar, borrar, fijar, reenviar,
encuestas, grupos y los eventos `message.any`, `message.ack`, `message.reaction`, `message.edited`,
`message.revoked`, `group.v2.participants`, `call.*`, `poll.vote` y `session.status`. Inbox no lo usa: Inbox solo
habla con el Evolution administrado.

Para que WAHA sea un proveedor completo (y se pueda tener los dos a la vez, por número):

1. **Modo administrado con WAHA.** Un `managedWahaProvider` igual a `groups-provider-managed.ts`: crear la sesión
   con `POST /api/sessions`, una clave por sesión con `/api/keys` (permisos `read`, `send`, `control`), borrar las
   dos al desconectar. La variable de entorno elige el servidor (`GROUPS_BRIDGE_KIND=evolution|waha`), y cada número
   guarda su `provider` como hoy, así conviven líneas viejas en Evolution y nuevas en WAHA.
2. **Eventos que faltan en `parseWahaWebhook`:** `message.ack.group` (con el conteo de lectores de 0011, del lado
   nuestro), `group.v2.join` y `group.v2.update`, `chat.archive` (solo WEBJS), `presence.update`, `contacts` y lids.
   El id del mensaje de WAHA trae el chat y si es propio (`true_<chat>_<id>`); hay que guardar la parte del id para
   que las respuestas, reacciones y tildes coincidan con lo que manda el teléfono.
3. **`HistorySource` para WAHA:** `GET /api/{s}/chats`, `/chats/{id}/messages` (con `limit` y `offset`) y
   `/contacts/all`. Con NOWEB pide `store.enabled`; con GOWS, limitar la sincronización para que la base no crezca sin
   tope.
4. **Media:** WAHA baja el archivo al llegar y lo sirve por URL. Hay que bajarlo nosotros dentro de los 180 s (o
   configurar S3), en vez de pedirlo después como hoy. `fetchMedia` deja de existir para esos números.
5. **Capacidades:** `PROVIDER_CAPS.waha` ya apaga lo que no hay (`ephemeral`, `fetchHistory`). Faltaría una
   capacidad `archive` (falso con GOWS) para que Inbox y Lines no ofrezcan archivar en WhatsApp ahí.
6. **Migración de una línea:** las sesiones no se pasan de Evolution a WAHA (claves distintas, otro motor): cada
   línea se vuelve a vincular con QR. Los mensajes ya guardados en zerosoft quedan; los ids de WhatsApp son los
   mismos, así que los tildes y respuestas de mensajes viejos siguen andando si guardamos el id de WhatsApp y no el
   compuesto de WAHA.

Costo aproximado: el modo administrado y el `HistorySource` son unos días; los eventos nuevos, uno o dos; probarlo
contra un número de prueba con GOWS, una semana de uso real.

## Recomendación

Seguir con Evolution para todas las líneas. WAHA es más prolijo en lo operativo (licencia simple, releases
mensuales, HMAC y reintentos de webhook, claves por sesión) pero con el motor que escala (GOWS) perdemos el
archivado en las dos direcciones y el historial pedido al teléfono, que son justo las dos cosas que más trabajo nos
costaron en Inbox. WEBJS tiene el archivado pero cuesta 20 GB para 50 líneas.

Siguiente paso concreto, sin servicios pagos: el día que se pruebe, levantar `devlikeapro/waha:gows` en Docker en una
máquina de desarrollo, vincular un número de prueba al adaptador `waha` de Lines, y mirar tres cosas: tildes de
grupo (`message.ack.group`), sticker animado, y si GOWS suma archivado (está en su lista de faltantes). Si en
marzo de 2027 GOWS archiva y avisa el archivado, vale hacer el modo administrado con WAHA y ofrecer las dos opciones
por número.
