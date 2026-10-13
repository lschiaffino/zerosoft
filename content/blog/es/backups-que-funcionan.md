---
title: "Backups que funcionan para un Zerosoft self-hosted"
description: "Todo tu Zerosoft es un archivo SQLite, una carpeta de uploads y un .env. Cómo copiarlos de forma consistente con la app corriendo, sacarlos del servidor y probar que de verdad se restauran."
date: "2026-10-12"
author: "Zerosoftware"
tags: ["self-hosting", "backups", "sqlite"]
---

Lo dijimos varias veces en este blog: en Zerosoft, el backup es "un archivo". Es cierto en espíritu y un poco peligroso en la práctica. Una base SQLite en la que se está escribiendo no es un archivo que puedas copiar con `cp` a ciegas y confiar.

Esta es la versión práctica: qué backupear, cómo copiarlo de forma consistente con la app corriendo, adónde mandarlo y cómo saber que el backup realmente se restaura. Quince minutos de setup, diez minutos por trimestre.

## Qué estás backupeando

Un Zerosoft self-hosted con Docker tiene exactamente tres cosas que importan:

1. **La base de datos.** Un archivo SQLite, `zerosoftware.db`, en `/app/data` dentro del contenedor, guardado en el volumen `zerosoft-data`. Links, clicks, contactos, deals, issues, reservas, conversaciones, docs, usuarios, teams, API keys: todo.
2. **Uploads.** Los adjuntos de Chat, Track y las tareas del CRM, en `/app/public/uploads`, guardados en el volumen `zerosoft-uploads`.
3. **Tu `.env`.** Fácil de olvidar, y pesa más de lo que parece. Más abajo explicamos por qué.

Sin Docker es la misma idea: `data/zerosoftware.db` y `public/uploads/` en el directorio de la app.

Un detalle de Docker primero: Compose les antepone el nombre del proyecto a los volúmenes, y ese nombre por defecto es el del directorio. Si clonaste en `zerosoft/`, tus volúmenes probablemente se llamen `zerosoft_zerosoft-data` y `zerosoft_zerosoft-uploads`. Fijate en vez de adivinar:

```bash
docker volume ls | grep zerosoft
```

## Por qué un cp no alcanza

Zerosoft abre su base local en **modo WAL** (`PRAGMA journal_mode = WAL`). En modo WAL, las escrituras nuevas van primero a un archivo aparte, `zerosoftware.db-wal`, y se vuelcan al archivo principal más tarde, en un checkpoint. Con la app corriendo, normalmente vas a ver tres archivos: `zerosoftware.db`, `-wal` y `-shm`.

Entonces, si hacés `cp zerosoftware.db` con la app corriendo:

- Datos ya commiteados pueden seguir viviendo en el `-wal`, y tu copia no los tiene.
- Si copiás el `.db` y el `-wal` por separado, puede caer una escritura en el medio y el par que te queda puede no coincidir.

Copiar a mano *sí* está bien si la app está frenada: en un apagado limpio SQLite hace el checkpoint del WAL al archivo principal. Si en cambio el proceso murió de golpe, puede quedar un `-wal` con datos commiteados, así que copiá todos los archivos juntos. Pero frenar tu app todas las noches para backupearla no tiene sentido cuando SQLite tiene una forma correcta de hacerlo en caliente.

## La forma correcta: .backup o VACUUM INTO

SQLite trae dos formas de sacar un snapshot consistente de una base viva:

- **`.backup`** (el backup online del CLI `sqlite3`) copia la base página por página a un archivo nuevo y produce un snapshot consistente aunque la app siga escribiendo.
- **`VACUUM INTO '/ruta/archivo.db'`** escribe una copia nueva y compactada de la base tal como estaba en una única transacción. Trabaja un poco más y te da un archivo más chico. El archivo destino no tiene que existir.

Las dos son correctas. Las dos incluyen lo que está en el WAL. La imagen de Zerosoft no trae el CLI `sqlite3`, así que lo más simple es un contenedor Alpine descartable que monte el volumen:

```bash
#!/bin/sh
# /usr/local/bin/zerosoft-backup.sh
set -eu
DATA_VOL=zerosoft_zerosoft-data        # verificar con: docker volume ls
UPLOADS_VOL=zerosoft_zerosoft-uploads
DEST=/var/backups/zerosoft
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$DEST"

# 1. Snapshot consistente de la base viva (seguro con la app corriendo)
docker run --rm -v "$DATA_VOL":/data -v "$DEST":/backup alpine:3.20 \
  sh -c "apk add --no-cache sqlite >/dev/null && sqlite3 /data/zerosoftware.db \".backup '/backup/db-$STAMP.db'\""

# 2. Verificar la copia antes de confiar en ella
docker run --rm -v "$DEST":/backup alpine:3.20 \
  sh -c "apk add --no-cache sqlite >/dev/null && sqlite3 /backup/db-$STAMP.db 'PRAGMA integrity_check;'" | grep -qx ok

# 3. Los uploads son archivos comunes: tar alcanza
docker run --rm -v "$UPLOADS_VOL":/uploads:ro -v "$DEST":/backup alpine:3.20 \
  tar czf "/backup/uploads-$STAMP.tgz" -C /uploads .

# 4. Guardar dos semanas en local
find "$DEST" -type f -mtime +14 -delete
```

Corrélo desde cron, a una hora tranquila:

```bash
# crontab -e
15 3 * * * /usr/local/bin/zerosoft-backup.sh >> /var/log/zerosoft-backup.log 2>&1
```

¿Preferís `VACUUM INTO`? Cambiá la línea de `.backup` por `sqlite3 /data/zerosoftware.db \"VACUUM INTO '/backup/db-$STAMP.db'\"`.

## No te olvides del .env

Zerosoft cifra en la base los tokens OAuth (las integraciones de Gmail y Google Calendar) y los secretos de los webhooks con AES-256-GCM. La clave sale de `ENCRYPTION_KEY`, o de `NEXTAUTH_SECRET` si esa no está.

Qué significa para los backups: si restaurás la base en un servidor con un secreto *distinto*, todo carga igual, pero esos valores cifrados no se pueden descifrar. Hay que reconectar las integraciones y se pierden los secretos de firma de los webhooks. Backupeá también tu `.env`, por separado y cifrado (tiene tu client secret de Google), en tu gestor de contraseñas o tu bóveda de secretos. No como un archivo plano al lado de los dumps de la base.

## Sacalo del servidor

Un backup en el mismo disco que la base te protege de errores, no de un disco muerto ni de un VPS borrado. Mandá la carpeta de backups a otro lado. Sirve cualquier herramienta; dos comunes:

```bash
# rclone: copiar a cualquier bucket compatible con S3 configurado como "offsite"
rclone copy /var/backups/zerosoft offsite:zerosoft-backups

# o restic: snapshots cifrados y deduplicados
restic -r s3:https://<endpoint>/<bucket> backup /var/backups/zerosoft
```

Sumá esa línea al final del script. Guardá más retención afuera que en local: unas semanas de diarios más algunos mensuales alcanzan para la mayoría de los equipos chicos. Y si tu storage lo permite, que las credenciales del servidor puedan *escribir* backups pero no borrar los viejos; al ransomware le encanta un backup que puede borrar.

Si querés algo más cercano a continuo, Litestream manda los cambios del WAL de SQLite a object storage. Lo mencionamos porque encaja bien con SQLite, pero no lo validamos específicamente con Zerosoft: probá el restore antes de depender de él.

## Restaurar, de verdad

El procedimiento de restore, con la app frenada:

```bash
docker compose stop

docker run --rm -v zerosoft_zerosoft-data:/data -v /var/backups/zerosoft:/backup alpine:3.20 \
  sh -c "rm -f /data/zerosoftware.db-wal /data/zerosoftware.db-shm \
    && cp /backup/db-2026-10-12_0315.db /data/zerosoftware.db \
    && chown 1001 /data/zerosoftware.db"

docker run --rm -v zerosoft_zerosoft-uploads:/uploads -v /var/backups/zerosoft:/backup alpine:3.20 \
  sh -c "tar xzf /backup/uploads-2026-10-12_0315.tgz -C /uploads && chown -R 1001 /uploads"

docker compose start
```

Dos detalles que muerden:

- **Borrá el `-wal` y el `-shm` viejos.** Un WAL sobrante de la base anterior nunca tiene que aplicarse encima del archivo restaurado.
- **El dueño de los archivos.** La app corre como el usuario `zerosoft` (uid 1001). Archivos restaurados como root pueden ser legibles pero no escribibles, y la app va a fallar en la primera escritura.

Las migraciones corren solas cuando arranca la app, así que restaurar un backup viejo sobre una versión más nueva de Zerosoft actualiza su esquema. La dirección contraria — una base más nueva sobre código más viejo — no es algo con lo que puedas contar.

## El simulacro que nadie hace

Un backup que nunca restauraste es una esperanza, no un backup. Una vez por trimestre, agarrá la última copia offsite (no la local) y revisala en algún lugar que no sea producción:

```bash
sqlite3 db-2026-10-12_0315.db "PRAGMA integrity_check;"
sqlite3 db-2026-10-12_0315.db "SELECT count(*) FROM links; SELECT count(*) FROM crm_contacts; SELECT count(*) FROM track_issues;"
```

¿Los números se parecen a los reales? ¿El tarball de uploads abre? Mejor todavía: una vez por año, hacé el restore completo de arriba en un VPS de repuesto con tu `.env` backupeado, entrá y navegá un rato. Tomá el tiempo. Ese número es tu tiempo real de recuperación, y conviene conocerlo antes de necesitarlo.

## Si usás Turso

Configurá `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` y la base ya no está en tu servidor: es una base libSQL remota, que es sobre lo que corre nuestra propia nube. Turso tiene sus propias funciones de backup y restore; fijate qué incluye tu plan. Igual nosotros guardaríamos una copia que controlemos:

```bash
turso db shell <your-db> .dump > zerosoft-$(date +%F).sql
```

Los uploads siguen siendo tuyos para backupear en cualquier caso (en tu disco, o en Vercel Blob si configurás `BLOB_READ_WRITE_TOKEN`).

## Checklist

- Snapshot de la base con `.backup` o `VACUUM INTO`, nunca un `cp` a ciegas de una base corriendo.
- Chequeo de integridad en cada copia.
- Tarball de uploads.
- `.env` guardado aparte y cifrado.
- Copia offsite, con retención.
- Un simulacro de restore en el calendario.

Ese es todo el runbook. Es corto porque la arquitectura es chica: [un proceso, un archivo](/blog/sqlite-es-suficiente). Lo único difícil es hacer el simulacro.
