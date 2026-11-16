# Evolution API con parches de zerosoft

Las líneas de WhatsApp de Lines e Inbox corren sobre [Evolution API](https://github.com/EvolutionAPI/evolution-api)
(Railway, proyecto `zerosoft-groups-whatsapp`, servicio `evolution`). Esta carpeta arma una imagen de Evolution con
los parches de `patches/` aplicados sobre su código fuente, para lo que la versión oficial todavía no resuelve.

| Archivo | Qué es |
|---|---|
| `VERSION` | La versión de Evolution (etiqueta del repo oficial) sobre la que se aplican los parches. |
| `PATCH_LEVEL` | Sube cuando cambian los parches sin cambiar la versión. |
| `patches/*.patch` | Diffs contra el código fuente, en orden. |

La imagen sale como `ghcr.io/lschiaffino/zerosoft-evolution:<VERSION>-zs<PATCH_LEVEL>` (y `:latest`), desde
`.github/workflows/evolution-image.yml`.

## Parches

- `0001-chats-update-forward-state.patch`: el webhook `CHATS_UPDATE` solo mandaba el id del chat
  (`{ remoteJid, instanceId }`), así que archivar, fijar o leer un chat desde el teléfono nunca llegaba a zerosoft.
  Ahora manda también `archived`, `pinned` y `unreadCount` cuando WhatsApp los informa. Propuesto a Evolution; se
  saca cuando una versión oficial lo traiga.
- `0002-recover-dropped-messages.patch`: los mensajes que llegan y no se pueden descifrar (`No session record`,
  `Invalid PreKey ID`, `Message absent from node`, etc.) Evolution los tiraba con un "Message ignored" en el log, y
  nunca llegaban ni a su base ni a zerosoft (pasó con mensajes mandados desde el teléfono). Ahora:
  - le pide una vez al teléfono que reenvíe ese mensaje (`requestPlaceholderResend` de Baileys; el reenvío llega como
    un `MESSAGES_UPSERT` normal con el mismo id);
  - avisa por el webhook con un `MESSAGES_UPSERT` sin `message`, con `zsUndecryptable: true`, `key`,
    `messageTimestamp` y `messageStubParameters` (el motivo). zerosoft lo lee como "falta un mensaje en este chat"
    (`parseEvolutionWebhook` → `{ type: 'missing' }`); quien no lo conoce lo ignora porque no trae contenido;
  - suma `POST /chat/fetchHistory/{instance}` con `{ remoteJid, count?: 1..100, after?: segundos }` (mismo `apikey`
    que el resto de `/chat`): pide al teléfono el historial de ese chat (`fetchMessageHistory`), anclado en el mensaje
    guardado más viejo posterior a `after`, o en el más nuevo. Responde `{ requestId, anchor, count }`. Lo que manda
    el teléfono llega por `MESSAGES_SET` (con `syncType: 'ON_DEMAND'`), se guarda en la base de Evolution y zerosoft
    lo guarda como historial (sin avisos ni automatizaciones);
  - en ese historial pedido, lo repetido se busca en la base y no en el caché de la primera sincronización (que no
    tiene lo que llegó después).

  WhatsApp solo manda los mensajes anteriores al ancla: si el que falta es el último del chat, lo recupera el reenvío
  del teléfono, no el historial. Las dos cosas necesitan el teléfono conectado a internet.

- `0003-sync-chat-state-on-connect.patch`: suma `POST /chat/syncChatState/{instance}` (sin cuerpo, mismo `apikey`),
  que relee desde cero la colección donde viven archivado y fijado (`regular_low`) y manda cada chat por
  `CHATS_UPDATE`. **Solo a mano y con cuidado:** borra el estado guardado de la línea, y si rearmarlo falla (falta una
  clave, `Invalid patch mac`) la línea deja de recibir los cambios del teléfono hasta volver a vincularla. La primera
  versión lo corría sola en cada conexión y el 14/11 rompió así el archivado desde el teléfono; ya no lo hace.

- `0004-group-metadata-pace-app-state-guard.patch`:
  - **Metadata de grupos sin 429.** Al conectar, Baileys trae todos los grupos de una y Evolution los volvía a pedir
    uno por uno (`groupMetadata`), con decenas de `rate-overlimit` por línea en cada reinicio. Ahora la metadata que
    ya vino se guarda en la caché; cada grupo tiene un solo pedido en vuelo; un cambio de participantes hace un pedido
    (antes dos); `/group/participants` responde desde la caché (1 h, renovada con cada evento del grupo); y después de
    un `rate-overlimit` no se le pide metadata a WhatsApp por un minuto.
  - **Archivar no miente.** `/chat/archiveChat` y `/chat/markChatUnread` responden `409` con
    `app_state_unavailable: missing_key | sync_failed | not_connected` (en `response.message`) cuando la línea no
    tiene su clave de app-state o no puede sincronizar `regular_low`. Antes Baileys armaba el cambio sobre un estado
    vacío, WhatsApp no lo aplicaba y Evolution respondía "archivado". zerosoft lo muestra como "volvé a vincular la
    línea". Una cuenta cuyo `regular_low` nunca tuvo cambios también da `sync_failed` (caso raro).

- `0005-baileys-skip-patch-mac.patch` (sobre el `Dockerfile`, porque Baileys vive en `node_modules`): Baileys
  7.0.0-rc.9 valida siempre el MAC de cada patch de app-state y, si uno no da (`Invalid patch mac`), borra el estado
  de `regular_low` y no lo vuelve a leer; el archivado del teléfono deja de llegar. El 15/11 pasó en la línea del
  dueño 7 minutos después de vincularla de cero, con un patch escrito por el teléfono (no por zerosoft). Baileys
  7.0.0-rc14 usa `appStateMacVerification.patch` (false por defecto, como WhatsApp Web) y saltea lo que no puede
  leer; el parche hace lo mismo con un `sed` después de `npm ci`, y el build falla si la línea cambió. Se saca al
  pasar a una versión de Evolution con Baileys rc14 o posterior.

- `0006-fetch-history-given-anchor.patch`: `POST /chat/fetchHistory/{instance}` acepta `anchor: { id, fromMe?, timestamp,
  participant? }` (segundos): el mensaje exacto desde el que se piden los anteriores, aunque Evolution no lo tenga
  guardado. Sin esto el ancla se busca en la base de Evolution (el primer mensaje posterior a `after`), y después de
  volver a vincular una línea la instancia es nueva y no tiene los mensajes viejos: el ancla caía en uno más nuevo y
  WhatsApp volvía a mandar lo que zerosoft ya tenía. Lo usa "Cargar mensajes anteriores" de Inbox y Lines. La
  respuesta lleva `given: true` y el `anchor` que se usó. Un Evolution sin este parche ignora el campo.

- `0007-archive-last-message-filter.patch`: `/chat/archiveChat` y `/chat/markChatUnread` sin `lastMessage` buscan el
  último mensaje del chat con `{ key: { remoteJid } }`, un filtro que Prisma no acepta sobre la columna JSON `key`:
  respondían 500 siempre (en producción, cada archivado de zerosoft era un 500 y después un 201 con la referencia
  nuestra). Ahora filtra por path (`key.remoteJid`, y si no hay, `key.remoteJidAlt`), como el resto del servicio.

- `0008-group-updates-reach-webhook.patch`: los cambios de un grupo hechos en el teléfono (o por otra persona)
  llegan al webhook:
  - **Asunto y descripción.** Baileys los emite como `groups.update` (con `author`), pero el filtro del webhook de
    la instancia comparaba el evento `GROUPS_UPDATE` contra la opción `GROUP_UPDATE` (la única que acepta la
    validación) y nunca coincidía. Ahora `GROUP_UPDATE` en los eventos de la instancia recibe `groups.update`.
  - **Solo cambios.** Al conectar, Baileys emite la metadata completa de todos los grupos por `groups.update`:
    eso ya no sale por el webhook (eran megas por línea); se sigue guardando en la caché como en 0004.
  - **Foto del grupo.** Llegaba solo como mensaje de sistema sin contenido (GROUP_CHANGE_ICON), que Evolution
    descartaba. Ahora sale como `GROUPS_UPDATE` con `{ id, picture: 'changed' | 'removed', author, authorPn }`.

  zerosoft lo lee en `parseEvolutionWebhook` (`groups.update` → `{ type: 'group' }`, lib/wa-group-events.ts).

**Qué imagen corre.** Cada parche llega a las líneas solo cuando el servicio de Railway usa la etiqueta nueva: el
workflow publica la imagen pero no cambia Railway. El 15/11 el servicio seguía en `2.3.7-zs4` (sin 0004 ni 0005)
después de publicarse `zs6`. Para ver cuál corre: `railway deployment list -p <proyecto> -s evolution --json`
(`meta.image`).

**Las claves viven en el disco del contenedor.** Con `CACHE_REDIS_ENABLED=false`, Evolution guarda en Postgres solo
`creds`; las sesiones de Signal, las pre-keys y las claves de app-state quedan en `/evolution/instances`. Al 15/11
ese camino tiene un volumen de Railway (el deploy lo muestra en `volumeMounts`), así que un deploy ya no las
borra. Sin el volumen, después de un deploy las líneas no podían leer ni mandar archivado (`failed to find key`)
hasta volver a vincularse.

## Mantenimiento (automático)

El workflow corre todos los lunes:

- Si salió una versión nueva de Evolution y los parches aplican, abre un PR que sube `VERSION`. Al mergearlo se
  arma la imagen; en Railway se cambia la etiqueta de la imagen del servicio.
- Si los parches ya no aplican (Evolution cambió ese código), abre un issue en vez de publicar algo roto.
- Si la versión nueva ya trae el arreglo, abre un issue para volver a la imagen oficial.
