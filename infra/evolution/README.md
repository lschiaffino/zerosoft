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

## Mantenimiento (automático)

El workflow corre todos los lunes:

- Si salió una versión nueva de Evolution y los parches aplican, abre un PR que sube `VERSION`. Al mergearlo se
  arma la imagen; en Railway se cambia la etiqueta de la imagen del servicio.
- Si los parches ya no aplican (Evolution cambió ese código), abre un issue en vez de publicar algo roto.
- Si la versión nueva ya trae el arreglo, abre un issue para volver a la imagen oficial.
