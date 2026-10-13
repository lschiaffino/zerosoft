---
title: "¿Self-host o Zerosoft Cloud? Un checklist honesto"
description: "Hostear Zerosoft es gratis y está a un docker compose de distancia. Correrlo bien es una lista de tareas chicas: HTTPS, Google OAuth, email, cron, backups, dominios propios. Acá está la lista para que decidas."
date: "2026-08-30"
author: "Zerosoftware"
tags: ["self-hosting", "nube", "guía"]
---

Lo decimos en todos lados: hostear Zerosoft cuesta $0, para siempre. Es verdad, y no es toda la verdad. El software es gratis. La hora que pasás a las 11 de la noche con un mail de recordatorio que no sale, no.

Este post es el checklist que querríamos tener si estuviéramos decidiendo. Sin vender ninguno de los dos lados: ganamos plata cuando elegís la nube, y aun así construimos cada producto para que corra en tu propio servidor. Elegí la opción cuyas tareas prefieras tener a cargo.

## Qué significa "self-host" acá

El punto de partida es chico de verdad:

```bash
git clone https://github.com/lschiaffino/zerosoft && cd zerosoft
cp .env.example .env
docker compose up -d
```

Un contenedor, un proceso Node, un archivo SQLite en el volumen `zerosoft-data` y los adjuntos en `zerosoft-uploads`. Las migraciones de la base corren solas cuando arranca la app. Sin Postgres, sin Redis, sin workers de colas.

Con eso tenés la app corriendo en el puerto 3000. Pasar de "corre" a "mi equipo depende de esto" es el checklist que sigue.

## El checklist

### 1. HTTPS y un reverse proxy

El contenedor habla HTTP plano. Le ponés adelante un reverse proxy — Caddy, nginx, Traefik, el que conozcas — y le das un certificado. Con Caddy son unas pocas líneas y certificados automáticos. Configurá `NEXTAUTH_URL` con la dirección HTTPS pública, porque los callbacks del login dependen de eso.

**Esfuerzo:** una hora la primera vez, casi cero después.

### 2. Google OAuth (el único login)

El login de Zerosoft es Google OAuth. `DEMO_MODE` es para explorar, y en producción se ignora salvo que lo fuerces explícitamente: no lo hagas. Así que necesitás un proyecto en Google Cloud con `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`, y el redirect URI `<NEXTAUTH_URL>/api/auth/callback/google`.

Si querés el sync de Gmail del CRM o el de Google Calendar de Cal, sumá sus callbacks (`/api/integrations/gmail/callback`, `/api/integrations/google-calendar/callback`) y habilitá las APIs de Gmail y Calendar. La lectura de Gmail es un scope sensible del lado de Google: para una app que se usa solo dentro de tu propio Google Workspace suele ser indoloro; para algo más amplio, revisá las reglas de verificación vigentes de Google antes de prometérselo a nadie.

**Esfuerzo:** 30 a 60 minutos de clicks en Google Cloud Console. Molesto, una sola vez.

### 3. Emails que lleguen de verdad

Confirmaciones de reserva, avisos al host, recordatorios de 24 h, emails de cancelación y los emails de los workflows del CRM salen por Resend cuando están configurados `RESEND_API_KEY` y `EMAIL_FROM`. Sin eso, los emails se **loguean en consola**: la app funciona y nadie recibe nada. Es el "está roto" más común que en realidad no está roto.

Vas a necesitar una cuenta de Resend y un dominio de envío verificado con los registros DNS que te dan.

**Esfuerzo:** 20 minutos más la espera del DNS.

### 4. El cron

Hay trabajo que corre con timer: los recordatorios de Cal, los reintentos de webhooks y el trigger `task_due` de los workflows del CRM. Todo pasa por un endpoint, `/api/cron/tick`. En nuestra nube, Vercel Cron lo llama cada hora. En tu servidor lo llamás *vos*, con el secreto:

```bash
# crontab -e
17 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://zs.example.com/api/cron/tick > /dev/null
```

En producción el endpoint se niega a correr si no está `CRON_SECRET`. Si te olvidás de este paso no se rompe nada: los recordatorios simplemente nunca salen, en silencio.

**Esfuerzo:** 5 minutos. Fácil de olvidar, por eso está en la lista.

### 5. Backups y restores

Tus datos son dos volúmenes más tu `.env`. Hacer el backup bien no es difícil, pero "copiá el archivo" no es toda la historia para una base SQLite viva en modo WAL. Le dedicamos un post entero: [backups que funcionan](/blog/backups-que-funcionan). Leelo antes de cargar clientes reales en tu CRM.

**Esfuerzo:** una hora para armarlo, diez minutos por trimestre para probar un restore. La prueba es la parte que todos se saltean.

### 6. Dominios propios para Link

En nuestra nube, `go.tuempresa.com` tiene HTTPS automático. En self-host, los dominios se verifican por DNS (un CNAME o un registro A apuntando a tu servidor), pero el certificado de cada dominio propio es trabajo de tu reverse proxy. Sirve el on-demand TLS de Caddy o un certificado agregado a mano. Si hay hostnames extra que sirven la app en sí, listalos en `APP_HOSTS` para que no se confundan con dominios de links.

**Esfuerzo:** poco por dominio, pero es otra pieza que se mueve.

### 7. Actualizaciones y el servidor

`git pull`, rebuild de la imagen, reinicio. Las migraciones se aplican solas. Más lo aburrido del servidor: updates del sistema, espacio en disco, alguien que se entere cuando se cae. Nuestra página de status lista servicios pero el monitoreo en vivo todavía no está conectado; en tu servidor, el monitoreo es tuyo de todas formas.

**Esfuerzo:** minutos por mes, siempre que alguien sea responsable.

### 8. Archivos subidos

Los adjuntos de Chat, Track y las tareas del CRM van al volumen `zerosoft-uploads`, hasta 10 MB cada uno. No hay nada que configurar: solo acordate de que es parte del backup.

## Cuándo conviene self-host

- Alguien del equipo se lleva bien con un servidor Linux y se va a hacer cargo.
- Tus datos tienen que quedarse en infraestructura que controlás, por un contrato con un cliente, un regulador o por principio.
- Querés modificar el código. (Leé [por qué AGPLv3](/blog/por-que-agpl) para saber qué implica.)
- Preferís gastar una tarde una vez antes que pagar algo, nunca.

## Cuándo conviene la nube

- Nadie quiere estar de guardia por un servidor, y es una decisión razonable.
- Necesitás que el email, el cron, el HTTPS en dominios propios y los backups simplemente existan, hoy.
- Son un equipo no técnico y el checklist de arriba ya los cansó.

Zerosoft Cloud arranca con un plan gratis generoso; pasado eso, pagás por uso — lo que escala —, nunca por asiento, con precios transparentes publicados antes de cobrarte nada. No ponemos números en este post porque el número honesto para comparar es tu propio tiempo.

## Cambiar después: qué es portable hoy

Mirá esto con claridad, porque es donde las decisiones de self-host vs. nube se ponen pegajosas:

- **Link:** exportable — JSON por la API y CSV por link.
- **CRM:** exportación completa en CSV/JSON (solo admins), e importación CSV con mapeo y deduplicación del otro lado.
- **Track, Cal, Chat, Docs:** todavía no tienen exportación. La exportación de conversaciones de Chat y la de Docs a JSON/Markdown son gaps conocidos.
- **Self-hosted:** el archivo SQLite *es* la exportación. Está todo ahí, legible con cualquier herramienta de SQLite.

Hoy no existe un botón de "mover mi workspace de la nube a mi servidor" (ni al revés). Si la portabilidad entre los dos es un requisito duro, arrancá donde pensás quedarte, o arrancá self-hosted, donde tenés el archivo entero.

## La versión corta

Hosteá vos si tenés a alguien a cargo y una razón para quererlo. Usá la nube si preferís no pensar en crons. Las dos son el mismo código, y esa es la idea: elijas lo que elijas, la otra puerta queda abierta.
