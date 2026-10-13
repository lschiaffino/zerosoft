---
title: "Self-hosting de Zerosoft con Docker, paso a paso"
description: "De un VPS vacío a un Zerosoft andando con HTTPS, login con Google, backups, actualizaciones y el cron que nadie se acuerda de configurar. Cada comando, sin humo."
date: "2026-07-29"
author: "Zerosoftware"
tags: ["self-hosting", "docker", "tutorial"]
---

Ya dijimos que [el self-hosting en 2026 es más fácil que nunca](/blog/self-hosting-2026-mas-facil-que-nunca). Este post es la secuela aburrida y útil: los pasos exactos para pasar de un VPS vacío a una instancia de Zerosoft a la que le confiarías los links, contactos y reservas de tu equipo.

Asumimos un VPS Linux con Docker y Docker Compose instalados, un dominio que controlás y más o menos una hora. Vamos a usar `zs.example.com` como hostname — cambialo por el tuyo.

## 1. Cloná y mirá qué vas a correr

```bash
git clone https://github.com/lschiaffino/zerosoft && cd zerosoft
cp .env.example .env
```

Importan tres archivos. El `Dockerfile` arma una imagen de Node 24 en tres etapas, corre con un usuario sin privilegios (`zerosoft`, uid 1001) y declara dos volúmenes: `/app/data` y `/app/public/uploads`. El `docker-compose.yml` levanta un solo servicio, expone el puerto 3000 y monta dos volúmenes con nombre, `zerosoft-data` y `zerosoft-uploads`. Y en `.env` vive toda la configuración.

Ese es todo el stack. Un contenedor, sin Postgres, sin Redis, sin workers de colas. La base es un único archivo SQLite en `/app/data/zerosoftware.db`, que se crea y se migra solo en el primer arranque.

## 2. Configurá Google OAuth

Zerosoft solo tiene login con Google ([acá explicamos por qué](/blog/por-que-solo-login-con-google)), así que necesitás credenciales OAuth antes de que alguien pueda entrar.

En la consola de Google Cloud, andá a APIs & Services → Credentials, creá un cliente OAuth de tipo "Web application" y agregá estas redirect URIs autorizadas:

```
https://zs.example.com/api/auth/callback/google
https://zs.example.com/api/integrations/gmail/callback
https://zs.example.com/api/integrations/google-calendar/callback
```

La primera es el login. Las otras dos solo hacen falta si querés la integración de Gmail del CRM o la sincronización de Cal con Google Calendar — en ese caso habilitá también la Gmail API y la Google Calendar API en el proyecto.

Un detalle importante: Zerosoft no tiene lista de emails permitidos. Cualquiera con cuenta de Google que complete tu flujo OAuth puede crearse una cuenta en tu instancia. Si usás Google Workspace, poné el tipo de usuario de la pantalla de consentimiento en **Internal** y solo va a poder entrar gente de tu organización. Si no, no andes repartiendo la URL y revisá las reglas actuales de Google sobre pantallas de consentimiento en testing vs. producción.

## 3. Completá el `.env`

Un `.env` razonable para producción:

```bash
NEXTAUTH_URL=https://zs.example.com
NEXTAUTH_SECRET=        # openssl rand -base64 32
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SHORT_DOMAIN=zs.example.com
DEMO_MODE=false
CRON_SECRET=            # openssl rand -hex 32
ENCRYPTION_KEY=         # openssl rand -base64 32
RESEND_API_KEY=         # opcional: sin esto, los emails solo se loguean
EMAIL_FROM=cal@example.com
```

Algunas notas que salen de leer el código:

- **`DEMO_MODE`** convierte a cada visitante en un usuario demo compartido. La imagen corre con `NODE_ENV=production`, donde el modo demo se ignora salvo que además pongas `DEMO_MODE_ALLOW_PRODUCTION=true`. Ponelo en `false` igual; tu yo del futuro te lo va a agradecer.
- **`ENCRYPTION_KEY`** cifra en la base los tokens OAuth y los secrets de webhooks (AES-256-GCM). Si no está, se deriva de `NEXTAUTH_SECRET`. En cualquier caso: si la rotás, los tokens guardados ya no se pueden descifrar y hay que reconectar las integraciones. Hacé backup del `.env` junto con la base — un backup sin su clave es medio backup.
- **`RESEND_API_KEY`** es lo que hace que los emails de confirmación y recordatorio de Cal salgan de verdad. Sin ella, quedan escritos en los logs del contenedor.
- **Dejá `TURSO_DATABASE_URL` vacío.** Vacío significa archivo SQLite local. Si preferís una base remota en Turso, eso es [otra decisión](/blog/un-codigo-sqlite-local-o-turso).

## 4. Levantalo

```bash
docker compose up -d --build
docker compose logs -f
```

El primer build tarda unos minutos. Cuando esté arriba, un `curl -I http://localhost:3000` desde el VPS tendría que responder.

Antes de seguir, un ajuste de seguridad en tu `docker-compose.yml` local: cambiá `"3000:3000"` por `"127.0.0.1:3000:3000"`. Docker publica puertos escribiendo sus propias reglas de firewall, que pueden saltearse `ufw`. Atándolo a localhost, solo tu reverse proxy llega a la app.

## 5. HTTPS con un reverse proxy

Cualquier proxy sirve. Caddy es el camino más corto porque consigue los certificados solo:

```
zs.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Apuntá el registro A de tu DNS al VPS, recargá Caddy, listo.

Si usás Nginx, poné `proxy_set_header X-Forwarded-For $remote_addr;` en vez de agregar al header existente. Los rate limits por IP de Zerosoft leen la primera dirección de `X-Forwarded-For`, y si el proxy solo agrega, el cliente puede meter lo que quiera en ese primer lugar. Caddy por defecto no confía en headers de forwarding que vienen de clientes desconocidos, así que de fábrica está bien.

## 6. El cron (no te lo saltees)

Parte del trabajo de Zerosoft pasa por calendario, y todo entra por un único endpoint: `GET /api/cron/tick`. Cada tick manda los recordatorios de Cal pendientes, reintenta entregas de webhooks fallidas y dispara los triggers de workflows del CRM para tareas que acaban de vencer.

En Vercel lo llama Vercel Cron. En tu VPS no lo llama nadie si no lo configurás. En producción, el endpoint se niega a correr sin `CRON_SECRET` y lo exige como Bearer token:

```bash
# crontab -e
*/5 * * * * curl -fsS -H "Authorization: Bearer YOUR_CRON_SECRET" https://zs.example.com/api/cron/tick > /dev/null
```

Cada cinco minutos es un default razonable — los recordatorios y los reintentos de webhooks son tan puntuales como tu tick.

## 7. Backups

Tus datos viven en dos volúmenes de Docker. Compose les antepone el nombre del proyecto (por defecto, el del directorio), así que fijate con `docker volume ls` — con un directorio `zerosoft` son `zerosoft_zerosoft-data` y `zerosoft_zerosoft-uploads`.

La base corre en modo WAL, así que copiar el archivo mientras la app escribe no garantiza una copia consistente. Usá el backup en caliente de SQLite, desde un contenedor descartable:

```bash
mkdir -p /srv/backups
docker run --rm -v zerosoft_zerosoft-data:/data -v /srv/backups:/backups alpine \
  sh -c 'apk add -q sqlite && sqlite3 /data/zerosoftware.db ".backup /backups/zerosoftware.db"'
docker run --rm -v zerosoft_zerosoft-uploads:/u -v /srv/backups:/backups alpine \
  tar czf /backups/uploads.tgz -C /u .
```

Metelo en un script nocturno, sumale la fecha a los nombres de archivo y mandá `/srv/backups` fuera de la máquina (object storage, otro servidor, tu notebook). Un backup en el mismo disco es una copia, no un backup. Y restauralo al menos una vez en una máquina de prueba — un backup que nunca probaste es una expresión de deseo.

## 8. Actualizaciones

```bash
# primero el backup, después:
git pull
docker compose up -d --build
```

Las migraciones no se corren a mano. Al arrancar, la app compara las migraciones del código contra una tabla `schema_migrations` y aplica las pendientes antes de la primera query ([cómo funciona](/blog/migraciones-versionadas-sin-orm)). Por eso el backup va primero: las migraciones solo van para adelante.

## Lo que te queda

Un contenedor, dos volúmenes, una línea de cron, un bloque de proxy. Link, CRM, Cal, Track, Chat y Docs en tu propio hardware, con tus datos en un archivo que podés copiar a donde quieras.

Lo que no tenés es a alguien más vigilándolo. Uptime, parches del sistema operativo, espacio en disco y simulacros de restore ahora son tuyos. Si ese trato te suena mal, Zerosoft Cloud existe justamente para eso — el mismo código, un plan gratis generoso y precios por uso publicados antes de cobrarte nada. Si te suena bien, bienvenido. Tu servidor, tus reglas.
