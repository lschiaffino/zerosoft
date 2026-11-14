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

- `0003-sync-chat-state-on-connect.patch`: al vincular o reconectar, WhatsApp manda el estado de archivado y
  fijado de cada chat, pero Baileys lo deja esperando el historial de ese chat y casi nunca lo emite, así que lo
  archivado en el teléfono mientras la línea estaba desconectada no llegaba a zerosoft. Ahora, 45 segundos después de
  conectar, Evolution relee esa colección (`regular_low`) desde cero como un cambio normal y cada chat sale por
  `CHATS_UPDATE` con `archived` y `pinned`. También queda `POST /chat/syncChatState/{instance}` (sin cuerpo, mismo
  `apikey`) para pedirlo a mano.

## Mantenimiento (automático)

El workflow corre todos los lunes:

- Si salió una versión nueva de Evolution y los parches aplican, abre un PR que sube `VERSION`. Al mergearlo se
  arma la imagen; en Railway se cambia la etiqueta de la imagen del servicio.
- Si los parches ya no aplican (Evolution cambió ese código), abre un issue en vez de publicar algo roto.
- Si la versión nueva ya trae el arreglo, abre un issue para volver a la imagen oficial.
