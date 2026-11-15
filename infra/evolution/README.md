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

**Las claves viven en el disco del contenedor.** Con `CACHE_REDIS_ENABLED=false`, Evolution guarda en Postgres solo
`creds`; las sesiones de Signal, las pre-keys y las claves de app-state quedan en `/evolution/instances`, que no
tiene volumen: cada deploy las borra. Por eso, después de un deploy, las líneas vinculadas antes no pueden leer ni
mandar archivado (`failed to find key`) hasta volver a vincularse, y llegan mensajes que no se pueden descifrar
(parche 0002). Falta montar un volumen de Railway en `/evolution/instances` (o Redis).

## Mantenimiento (automático)

El workflow corre todos los lunes:

- Si salió una versión nueva de Evolution y los parches aplican, abre un PR que sube `VERSION`. Al mergearlo se
  arma la imagen; en Railway se cambia la etiqueta de la imagen del servicio.
- Si los parches ya no aplican (Evolution cambió ese código), abre un issue en vez de publicar algo roto.
- Si la versión nueva ya trae el arreglo, abre un issue para volver a la imagen oficial.
