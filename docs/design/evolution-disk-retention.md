# Evolution: uso de disco y retención de `Message`

Estado al 19/11/2026. Imagen `2.3.7-zs19` (`infra/evolution/`). Relacionado: punto 8 de
`docs/design/inbox-message-encryption.md` (retención de la copia de Evolution, decisión pendiente).

## 1. Qué guarda Evolution

Postgres de Railway (proyecto `zerosoft-groups-whatsapp`), esquema de Prisma de la 2.3.7:

| Tabla | Qué tiene | Crece con |
|---|---|---|
| `Message` | Cada mensaje entero: `key`, `message` (JSONB con el proto, incluida la clave del archivo: `mediaKey`, `directPath`), `messageTimestamp` (segundos), `status`, `instanceId`. Índice solo por `instanceId`: buscar un mensaje por id (`key->>'id'`, lo hace cada descarga) recorre todas las filas de la instancia. | Todo lo que entra y sale de cada línea, para siempre. Es la que crece. |
| `MessageUpdate` | Cada cambio de estado (entregado, leído, borrado) con `messageId` → `Message` (`ON DELETE CASCADE`). No tiene fecha propia. | Cada tilde de cada mensaje. Probablemente la segunda en tamaño. |
| `Chat`, `Contact` | Una fila por chat y por contacto de cada instancia. | Acotado (contactos de la línea). |
| `Media` | Solo con `S3_ENABLED=true`. | Nada: no usamos S3. |
| `Session` | `creds` de Baileys. | Una por instancia. |
| `IsOnWhatsapp` | Caché de números consultados. | Poco. |

Los archivos (fotos, audios, documentos) **no** se guardan en Evolution: sin S3, `Message` tiene solo la clave del
archivo y dónde está en los servidores de WhatsApp. Las claves de Signal y de app-state viven en el volumen
`/evolution/instances` (README de `infra/evolution`), no en Postgres.

Variables de la 2.3.7 que controlan esto (`.env.example` de la versión):

| Variable | Default | Efecto |
|---|---|---|
| `DATABASE_SAVE_DATA_NEW_MESSAGE` | true | Guarda cada mensaje nuevo en `Message`. Apagarla rompe la descarga por key, las encuestas, editar y borrar (ver 2). |
| `DATABASE_SAVE_MESSAGE_UPDATE` | true | Guarda `MessageUpdate`. |
| `DATABASE_SAVE_DATA_HISTORIC` | true | Guarda lo que llega por la sincronización del historial al vincular. Según `lib/wa-media-wire.ts` está **apagada** en producción. |
| `DATABASE_SAVE_DATA_CHATS` / `_CONTACTS` / `_LABELS` | true | `Chat`, `Contact`, `Label`. |
| `DATABASE_DELETE_MESSAGE` | true | Un "borrar para todos" borra la fila en vez de marcarla. |
| `DATABASE_SAVE_IS_ON_WHATSAPP_DAYS` | 7 | Vencimiento de `IsOnWhatsapp`. |
| `DEL_INSTANCE` | false | Borrar instancias desconectadas después de N minutos. |

La 2.3.7 **no tiene** retención por fecha de `Message`. Lo único que borra filas en bloque es `DELETE
/instance/delete/{instancia}` (`cleaningStoreData`: borra `Chat`, `Contact`, `MessageUpdate`, `Message`, `Session`,
`Webhook`, `Setting` y el directorio de claves de esa instancia). `logout` no borra mensajes.

Los valores que corren en Railway no se pudieron leer desde esta sesión (ver 4): confirmar con
`railway variables -s evolution` antes de decidir.

## 2. Qué usa zerosoft de esa base después del webhook

Inbox y Lines guardan su propia copia de cada mensaje en Turso al recibir el webhook. De Evolution se usa:

| Uso | Ruta | Necesita la fila de `Message` | Si la fila no está |
|---|---|---|---|
| Bajar un archivo recibido | `POST /chat/getBase64FromMediaMessage` con la key (`evolutionMedia`, `lib/groups-provider-bridge.ts`) | Sí, en la **misma instancia** (`getMessage` filtra por `instanceId`) | zerosoft reintenta con la clave guardada (`media_ref.wire` en Inbox, `meta.mediaWire` en Lines) y Baileys lo baja de WhatsApp; si el enlace venció, le pide al teléfono que lo vuelva a subir. Sin clave guardada: `media_gone`. |
| Copia propia del archivo | `lib/inbox/media-store.ts` (Inbox, `inbox_media_files`), `storeInboundMedia` (Lines, `media_url`) | Solo para bajarlo la primera vez | Con copia, nada: no se vuelve a pedir. La cola (`lib/wa-media-jobs.ts`) baja sola solo lo de menos de **30 días**; lo más viejo se baja la primera vez que alguien lo abre. |
| Responder citando | `quoted: { key: { id } }` en `sendText` y media | Sí (Evolution busca el mensaje citado) | La respuesta sale **sin la cita** en WhatsApp (en zerosoft se ve igual). |
| Votos de encuestas | `pollUpdateMessage` → `getMessage(pollCreationKey)` | Sí, la encuesta original | Los votos de esa encuesta dejan de llegar. |
| Editar / borrar para todos (desde zerosoft o el teléfono) | `updateMessage`, `messages.update` | Sí | Falla o se saltea el aviso. WhatsApp solo deja editar 15 min y borrar para todos unos 2 días, así que solo importa lo reciente. |
| Archivar | `newest()` en `archiveChat` (`findMessages` de 1) | El último mensaje del chat | Se usa la referencia de zerosoft, como ya hace sin filas. |
| Importación al vincular | `findChats`, `findMessages`, `findContacts` (`lib/inbox/import-jobs.ts`, Lines) | Sí, de la instancia nueva | Corre recién vinculada, sobre filas nuevas. |
| "Cargar mensajes anteriores" | `/chat/fetchHistory` con `anchor` (parches 0002 y 0006) | No: zerosoft manda el ancla | Nada. |
| Estado del servicio | `findMessages` de 1 registro (`lib/status/checks.ts`) | Cualquier fila | Nada mientras haya alguna. |

Consecuencias:

- **Una instancia vieja no la usa nadie.** Al volver a vincular se crea otra instancia (`newManagedInstance`), y
  zerosoft solo le habla a la instancia actual de cada línea. Las filas de una instancia que ya no es de ninguna línea
  no las lee nada: borrarla no cambia lo que zerosoft puede bajar hoy.
- **Lo que sí se pierde al borrar filas** es la única copia de la clave de los archivos que zerosoft no copió ni
  guardó con clave (`bare` en el trabajo de abajo). Son los mensajes de antes de que existiera `wire` (15/11) y que
  nadie abrió.
- `MessageUpdate` no lo lee zerosoft: llega por webhook. Es lo primero que se puede podar.

## 3. Qué se puede podar sin romper nada

| Qué | Seguro | Condición |
|---|---|---|
| `MessageUpdate` de mensajes de más de 7 días | Sí | Ninguna (se borra también solo, en cascada, al borrar su `Message`). |
| `Message` de más de N días de la instancia actual | Sí, para archivos | Que `bare` de esa línea con más de N días sea 0 (o que el dueño acepte perderlos). Se pierde la cita al responder a esos mensajes y los votos de encuestas viejas: dejar afuera `messageType = 'pollCreationMessage'`. |
| Instancia vieja entera (`zs-a1c79…`) | Sí, si `usedBy` es vacío | Ver 5. |
| `IsOnWhatsapp` vencido | Sí | Ya vence solo. |

## 4. Medición

No se pudo medir desde esta sesión: el CLI de `railway` pide aprobación (sesión no interactiva) y no hay credenciales
del Postgres de Evolution en esta Mac. Para medir, solo lectura:

**Desde zerosoft (sin tocar Railway).** El trabajo de mantenimiento `wa-media-audit` (`lib/wa-media-audit.ts`):

1. En Vercel, `MAINTENANCE_JOBS=wa-media-audit:dry` (solo existe `dry`; no escribe nada ni llama a nada que cambie
   algo: lee Turso y hace un `GET /instance/fetchInstances` con la clave global).
2. El cron de cada minuto escribe una línea como
   `[maintenance] wa-media-audit dry: inbox N files: stored …, wire …, bare … (bare older than 30 days …); lines …; K instances, J not used by any line: zs-a1c79 close 90000 msgs`.
3. El detalle por línea (cuentas por categoría y antigüedad, principio del nombre de su instancia) y por instancia
   (`messages`, `contacts`, `chats`, `status`, `usedBy`) queda en `maintenance_jobs.report`.
4. Sacar la variable.

**En el Postgres de Evolution (Railway, consola de la base).** Solo `SELECT`:

```sql
-- Tamaño por tabla (con índices y TOAST)
SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS total, reltuples::bigint AS filas_aprox
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = current_schema() AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 15;

-- Por instancia: filas y bytes de Message, y antigüedad
SELECT i.name, i."connectionStatus", count(m.id) AS mensajes,
       pg_size_pretty(sum(pg_column_size(m.*))::bigint) AS bytes,
       to_timestamp(min(m."messageTimestamp")) AS mas_viejo, to_timestamp(max(m."messageTimestamp")) AS mas_nuevo
FROM "Instance" i LEFT JOIN "Message" m ON m."instanceId" = i.id
GROUP BY i.id ORDER BY count(m.id) DESC;

-- Lo que la poda de N días borraría (cambiar 90)
SELECT i.name, count(*) AS filas
FROM "Message" m JOIN "Instance" i ON i.id = m."instanceId"
WHERE m."messageTimestamp" < extract(epoch FROM now() - interval '90 days')
  AND m."messageType" <> 'pollCreationMessage'
GROUP BY i.name;

-- MessageUpdate no tiene fecha: la de su mensaje
SELECT count(*) FROM "MessageUpdate" u JOIN "Message" m ON m.id = u."messageId"
WHERE m."messageTimestamp" < extract(epoch FROM now() - interval '7 days');
```

## 5. Borrar la instancia vieja `zs-a1c79…`

Antes de borrarla:

1. `wa-media-audit:dry` debe listarla con `usedBy` vacío. Si una línea la usa, **no** es vieja: no borrar.
2. Su `status` no debería ser `open`. Si está `open`, sigue vinculada como dispositivo en un teléfono (ocupa uno de
   los lugares de dispositivos vinculados y sigue mandando webhooks que zerosoft rechaza): conviene `logout` primero,
   y avisar a quien tiene ese teléfono.
3. Mirar `bare` (sobre todo `mid` y `old`) de la línea que la usaba antes. Esos archivos ya no se pueden bajar desde
   la instancia actual (no tiene sus filas), y la vieja es el único lugar con su clave. Si es 0, borrar no pierde
   nada. Si no es 0, el dueño elige entre aceptarlo o rescatarlos antes (ver 7, decisión 3).
4. Borrar con `DELETE /instance/delete/zs-a1c79…` (clave global), que borra sus filas y su directorio de claves. No
   borrar a mano en Postgres.

## 6. Propuesta de poda (no aplicada)

1. **Ya:** medir con `wa-media-audit:dry` y las consultas de 4.
2. **Bajar todo antes de podar.** Hoy la cola solo baja sola lo de menos de 30 días (`EAGER_MAX_AGE_MS`). Un trabajo
   de mantenimiento `wa-media-prefetch` (dry y apply, a desarrollar) encolaría los `bare` y `wire` de más de 30 días
   de las líneas conectadas en `wa_media_jobs`, de a poco por línea. Con la copia hecha, la fila de Evolution deja de
   importar para ese archivo. Respeta `INBOX_MEDIA_MAX_MB` por persona: lo que pase el tope sigue dependiendo de
   Evolution (con `wire`, no de la fila).
3. **Poda en Evolution.** Como la 2.3.7 no la trae, un parche `0013-message-retention` en `infra/evolution` con un
   intervalo (`ZS_MESSAGE_RETENTION_DAYS`, apagado por defecto; `ZS_MESSAGE_RETENTION_DRY=true` solo cuenta y lo
   escribe en el log) que cada hora borre de a 5.000 filas:
   - `MessageUpdate` de mensajes de más de 7 días;
   - `Message` con `messageTimestamp` anterior a N días, salvo `pollCreationMessage`.

   Antes, un índice `("instanceId", "messageTimestamp")` (`CREATE INDEX CONCURRENTLY`): sin él cada tanda recorre la
   tabla. De paso, uno por `("instanceId", (key->>'id'))` acelera cada descarga de archivo y cada cita. Después de la primera poda grande, `VACUUM` (o `pg_repack`) para devolver el espacio: un `DELETE` solo lo
   deja libre para filas nuevas, el volumen no baja.
4. **Alternativa sin parche:** un cron de Railway con `psql` y la misma consulta. Más simple, pero queda fuera del
   repo.

Lo que cambia para la gente con N = 90: responder citando un mensaje de más de 90 días sale sin cita en WhatsApp; nada
más. Con N = 30, lo mismo a 30 días, y los archivos sin copia de 30 a 90 días que nadie abrió dependen de la clave
guardada (los anteriores al 15/11 no la tienen).

## 7. Decisiones del dueño

1. **Retención de `Message`:** (a) 90 días (recomendada: casi nadie cita algo de hace 3 meses) · (b) 30 días ·
   (c) sin poda, documentarlo en `docs/security/retention.md`.
2. **Dónde vive la poda:** (a) parche `0013` en la imagen, con dry por defecto (recomendada: queda en el repo y en
   el README) · (b) cron de Railway con `psql`.
3. **Archivos `bare` de la instancia vieja:** (a) borrarla si `bare` de esa línea es 0, y si no, aceptar perderlos ·
   (b) antes, un rescate de una vez que copie a zerosoft la clave del archivo desde las filas de la instancia vieja
   (`findMessages` por id en esa instancia, solo lectura en Evolution; escribe `wire` en Turso), y recién después
   borrar.
4. **Bajar todo lo viejo (`wa-media-prefetch`):** (a) sí, antes de podar (recomendada; usa storage de Blob,
   acotado por `INBOX_MEDIA_MAX_MB`) · (b) no, y aceptar que lo `bare` viejo se pierda con la poda.
5. **`MessageUpdate` a 7 días:** (a) sí, junto con lo anterior (recomendada) · (b) apagar
   `DATABASE_SAVE_MESSAGE_UPDATE` (zerosoft no lee esa tabla; los tildes siguen llegando por webhook).
