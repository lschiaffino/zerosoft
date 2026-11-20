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

- `0009-sticker-animated.patch`: los stickers animados llegaban quietos.
  - `/message/sendSticker` pasa el archivo por sharp y decidía si era animado mirando si el texto del pedido decía
    `.webp` o `.gif`: en base64 nunca lo dice, así que convertía sin `animated` y salía solo el primer cuadro. Ahora,
    sin nombre que mirar, se fija en el archivo (GIF, o WebP con el chunk `ANIM`).
  - El `StickerMessage` salía sin `isAnimated` (Evolution no se lo pasaba a Baileys), y WhatsApp lo dibuja quieto.
    Ahora va `isAnimated: true` cuando el WebP que sale es animado.

  zerosoft además manda los WebP ya listos de la colección en base64 con `notConvertSticker: true` (lo acepta la
  versión oficial; `evolutionStickerBody` en lib/groups-media.ts), así salen tal cual. Sin este parche ese camino ya
  conserva la animación del archivo, pero el mensaje no lleva `isAnimated`.

- **La causa de fondo del archivado roto (18/11), arreglada en 0010.** Evolution guarda cada clave de app-state en
  disco con `JSON.stringify`, que usa el `toJSON` del mensaje protobuf y deja los bytes de la clave como texto
  base64. Al leerla usa `AppStateSyncKeyData.create`, que no los convierte: la clave vuelve como texto, todas las
  claves derivadas salen mal, y la línea no puede leer ni firmar ningún cambio de archivado. Una línea recién
  vinculada andaba unos minutos (la clave seguía en la caché en memoria de Baileys, 5 minutos) y después dejaba de
  archivar en las dos direcciones. Ahora, al leer una clave guardada como texto, se convierte a bytes.

- `0010-ask-phone-for-app-state-keys.patch`: una línea sin su clave de app-state ya no queda sin archivar para
  siempre. Las claves viven en disco, y las líneas vinculadas antes de que hubiera volumen las perdieron en un
  deploy: el teléfono solo las manda al vincular, o si se las piden. Ahora:
  - antes de archivar o marcar no leído, si falta la clave de la línea se le pide al teléfono
    (`APP_STATE_SYNC_KEY_REQUEST`, el mensaje entre dispositivos propios que usa WhatsApp Web) y se espera hasta 12 s;
    Baileys la guarda sola al recibir la respuesta. Lo mismo si `regular_low` no se puede leer porque tiene cambios
    cifrados con claves anteriores que faltan: se piden esas y se relee una vez. Cada clave se pide como mucho una
    vez cada 10 minutos;
  - si el teléfono no las manda, sigue el `409` (`missing_key`, `sync_failed`, o `sync_failed_missing_keys` cuando
    lo que impide leer la colección son claves que faltan) y hay que volver a vincular;
  - cuando Baileys no puede leer una colección de app-state, el motivo sale en el log como error (antes iba en
    nivel info, que no se guarda, y la línea dejaba de archivar sin rastro);
  - un `REMOVE` sobre una entrada que el estado local no tiene ya no tira la colección entera (`tried remove, but
    no previous op`: dos intentos y Baileys abandonaba `regular_low`, también en líneas recién vinculadas). Se
    saltea ese cambio, como WhatsApp Web y Baileys 7.0.0-rc14 (`sed` sobre `chat-utils.js`; el build falla si la
    línea cambió);
  - un registro que no se puede descifrar (`bad decrypt`) ya no tira la colección entera. El 18/11 la línea del
    dueño, recién vinculada, no pudo leer nunca `regular_low` por un registro así en su snapshot, y no archivaba en
    ninguna dirección. Ese registro se saltea, pero su MAC igual entra en el hash de la colección (el hash se arma
    con los MAC, no con el contenido), así el estado local sigue igual al del teléfono. Baileys 7.0.0-rc14 también
    lo saltea, pero sin sumar el MAC;
  - `POST /chat/appState/{instance}` (sin cuerpo, mismo `apikey`) responde el diagnóstico sin tocar nada ni mostrar
    claves: `{ connection, hasKeyId, hasKey, missingKeys, keysAsked, versions: { regular_low, ... } }`.

- `0011-group-receipts-reach-webhook.patch` (retirado el 19/11): mandaba al webhook los tildes de "entregado" y
  "leído" de los mensajes propios en grupos. Salió en `zs18` el 18/11 y a la hora y media la línea de Inbox empezó a
  mandar tandas de 150 a 200 avisos juntos que saturaron la base de zerosoft; se volvió a `zs17`. No quedó probado
  que fuera la causa, pero era el único cambio. Para reponerlo hace falta un tope de avisos por minuto. El parche
  está en el historial de git.
- `0012-skip-mutations-without-key.patch`: un cambio de app-state cifrado con una clave que la línea no tiene ya no
  tira la colección. El 19/11 la línea de Inbox recibió un cambio de `regular_low` firmado con una clave del
  teléfono que nunca le llegó (y el teléfono no respondió al pedido de 0010): Baileys cortaba con "failed to find
  key", la colección quedaba sin versión y la línea no archivaba en ninguna dirección. Ahora ese cambio se saltea y
  su MAC igual entra en el hash, así los demás cambios se leen y se mandan. Lo que decía el cambio salteado no se
  llega a saber (si era un archivado hecho en el teléfono, ese no aparece). Cuenta por clave en
  `globalThis.__zsAppStateNoKey`.
- `0013-forward-flag.patch`: los reenvíos de zerosoft salen marcados como reenvíos. WhatsApp muestra "Reenviado" con
  `contextInfo.isForwarded` y "Reenviado muchas veces" con `contextInfo.forwardingScore` >= 5; Evolution no dejaba
  pasar ninguno de los dos y el reenvío llegaba como un mensaje nuevo.
  - `/message/sendText`, `/message/sendMedia`, `/message/sendWhatsAppAudio` y `/message/sendSticker` aceptan
    `forward: { score?: number, key?: { id, remoteJid, fromMe } }`. Sin `forward` no cambia nada.
  - Con `key`, si ese mensaje está guardado en la base de esta instancia y es lo mismo que se pide mandar (mismo tipo,
    mismo texto o pie, nota de voz o no), sale con el reenvío de Baileys (`sendMessage(jid, { forward, force: true })`,
    `generateForwardMessageContent`): el mismo contenido y, en un archivo, el que ya está en el servidor de WhatsApp,
    sin volver a subirlo. Un archivo solo si tiene su clave (32 bytes) y su ruta y es de los últimos 7 días (después
    WhatsApp puede haberlo borrado y quien lo recibe no lo podría bajar). El score es el mayor entre el pedido y el
    del original + 1.
  - Si no, el mensaje se arma como siempre (texto, o el archivo que manda zerosoft) y lleva `isForwarded: true` y
    `forwardingScore` en el `contextInfo` (en grupos y en chats de a dos).

  zerosoft lo manda solo al reenviar (`evolutionForward` en lib/wa-forward.ts; Lines e Inbox). Un Evolution sin este
  parche ignora el campo (la validación de Evolution no rechaza campos de más) y el reenvío sale como antes, sin la
  marca.

**Qué imagen corre.** Cada parche llega a las líneas solo cuando el servicio de Railway usa la etiqueta nueva: el
workflow publica la imagen pero no cambia Railway. El 15/11 el servicio seguía en `2.3.7-zs4` (sin 0004 ni 0005)
después de publicarse `zs6`. Para ver cuál corre: `railway deployment list -p <proyecto> -s evolution --json`
(`meta.image`).

**Las claves viven en el disco del contenedor.** Con `CACHE_REDIS_ENABLED=false`, Evolution guarda en Postgres solo
`creds`; las sesiones de Signal, las pre-keys y las claves de app-state quedan en `/evolution/instances`. Al 15/11
ese camino tiene un volumen de Railway (el deploy lo muestra en `volumeMounts`), así que un deploy ya no las
borra. Sin el volumen, después de un deploy las líneas no podían leer ni mandar archivado (`failed to find key`)
hasta volver a vincularse.

## Secreto del webhook en un header

Desde el 17/11, al vincular (o volver a vincular) una línea de Inbox o Lines se registra el webhook como
`/api/{inbox|groups}/webhook/{id}` con el header `x-zerosoft-webhook-secret` (el campo `headers` del webhook, que
Evolution 2.3.7 manda en cada evento). Antes el secreto iba en la ruta (`/webhook/{id}/{secreto}`), que queda en los
logs de requests de Vercel. La ruta vieja se sigue aceptando: las instancias ya vinculadas siguen andando sin tocar
nada. Lo explica `lib/wa-webhook-secret.ts`.

**Pasar las instancias ya vinculadas (paso del dueño, no se hizo solo).** Con el trabajo de mantenimiento
`wa-webhook-header` (lib/wa-webhook-migrate.ts), que solo llama a `/webhook/set/{instancia}` de cada línea conectada
(no toca la sesión ni la vinculación):

1. En Vercel, `MAINTENANCE_JOBS=wa-webhook-header:dry`. El cron de cada minuto escribe
   `[maintenance] wa-webhook-header dry: inbox would migrate N of M …` (solo cuentas).
2. Cambiarla a `wa-webhook-header:apply` (espera a que el dry haya terminado). Mirar `migrated` y `failed`; una línea
   que falla sigue con la ruta vieja y se pasa sola la próxima vez que se vincule.
3. Sacar la variable. Para comprobar una línea: `GET /webhook/find/{instancia}` muestra la URL sin secreto y
   `headers`.
4. Cuando ninguna instancia use la ruta vieja (en los logs de Vercel no aparecen más POST a
   `/api/inbox/webhook/{id}/{…}` ni a `/api/groups/webhook/{id}/{…}` de Evolution), se puede borrar
   `app/api/inbox/webhook/[id]/[secret]`. La de Lines se queda: la usa la Cloud API de Meta, que no deja mandar
   headers propios (y firma cada evento con `X-Hub-Signature-256`).

## Mantenimiento (automático)

El workflow corre todos los lunes:

- Si salió una versión nueva de Evolution y los parches aplican, abre un PR que sube `VERSION`. Al mergearlo se
  arma la imagen; en Railway se cambia la etiqueta de la imagen del servicio.
- Si los parches ya no aplican (Evolution cambió ese código), abre un issue en vez de publicar algo roto.
- Si la versión nueva ya trae el arreglo, abre un issue para volver a la imagen oficial.
