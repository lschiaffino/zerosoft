---
title: "Webhooks de Zerosoft: qué se firma, cómo verificarlo y qué pasa cuando fallan"
description: "Cinco eventos, una firma HMAC-SHA256 en un header estilo Stripe, reintentos con backoff durante unas 15 horas y una protección contra SSRF. Más un verificador en Node para pegar."
date: "2026-08-27"
author: "Zerosoftware"
tags: ["webhooks", "desarrolladores", "seguridad"]
---

Consultar una API para enterarte si pasó algo es como refrescar el mail cada diez segundos. Los webhooks lo dan vuelta: Zerosoft te llama a vos. Este post cubre exactamente qué mandamos, cómo probar que fuimos nosotros y qué pasa cuando tu endpoint está caído — todo sacado directo de `lib/webhooks.ts` y `lib/safe-fetch.ts`.

## Los eventos

Son cinco, y solo cinco:

- `booking.created` — alguien reservó por Cal.
- `booking.rescheduled` — una reserva se movió.
- `booking.cancelled` — una reserva se canceló.
- `link.created` — se creó un link corto (desde el dashboard, la API o una importación).
- `link.clicked` — alguien hizo click en un link corto.

También está `ping`, que es lo que manda el botón "Enviar prueba" del panel. Tu handler tiene que aceptarlo y no hacer nada.

Lo que no está: eventos del CRM. Contactos, deals y tareas todavía no emiten estos webhooks. Lo más parecido hoy es un workflow del CRM con una acción de request HTTP — se dispara con triggers como `deal_won` o `contact_created` y pasa por la misma protección contra SSRF que explicamos abajo, pero no va firmado y no se reintenta. O consultar la [API v1](/blog/api-rest-v1-con-claves-personales) cada tanto.

Un aviso sobre `link.clicked`: se dispara en cada click. Un link que se viraliza te va a mandar muchísimos POST. El redirect en sí nunca espera a tu endpoint — el webhook sale después de responder —, pero tu servidor lo va a sentir. El payload del click trae referrer, país, dispositivo, navegador y sistema operativo. Sin dirección IP.

## Cómo crear uno

Los webhooks viven en Dashboard → Settings → Webhooks, y solo los admins del workspace los pueden gestionar. Elegís una URL y los eventos que te interesan. Al crearlo te damos un secret con forma `whsec_…`, que se muestra una sola vez. Lo guardamos cifrado (AES-256-GCM con la `ENCRYPTION_KEY` de la instancia), así que podemos firmar con él pero nadie puede volver a leerlo desde el dashboard.

## Cómo es una entrega

Cada entrega es un `POST` con body JSON:

```json
{
  "id": "4d1c…",
  "type": "booking.created",
  "createdAt": "2026-11-01T18:00:00.000Z",
  "data": { "id": "…", "status": "confirmed", "startsAt": "…", "invitee": { "name": "Ana", "email": "ana@example.com" }, "eventType": { "slug": "intro", "title": "Intro call" } }
}
```

Y estos headers:

```
Content-Type: application/json
User-Agent: Zerosoft-Webhooks/1
Zerosoft-Event: booking.created
Zerosoft-Delivery: <delivery id>
Zerosoft-Signature: t=1793556000,v1=5f2a…
```

`Zerosoft-Delivery` es único por endpoint y se mantiene igual entre reintentos. Usalo como clave de idempotencia.

## Cómo funciona la firma

Es el patrón de Stripe, a propósito — mucha gente ya lo conoce:

```
v1 = hex( HMAC-SHA256( secret, "<t>.<raw body>" ) )
```

`t` es un timestamp Unix en segundos, tomado en el momento de cada intento. Al incluirlo en lo que se firma, alguien que capture una request no puede reenviarla más tarde sin que la firma quede vieja.

Dos trampas en las que cae todo el mundo:

1. **Firmá el body crudo.** Si tu framework parsea el JSON y lo volvés a serializar, el orden de las claves o los espacios pueden cambiar y el HMAC no va a coincidir. Agarrá los bytes tal como llegaron.
2. **La clave es el secret entero,** prefijo `whsec_` incluido. No se lo saques, no lo decodifiques de base64.

## Un verificador en Node

Un handler completo de Express. Sin dependencias además de Express:

```js
import crypto from 'node:crypto';
import express from 'express';

const SECRET = process.env.ZEROSOFT_WEBHOOK_SECRET; // whsec_…
const TOLERANCE_SEC = 300;

function verify(rawBody, header, secret) {
  const parts = Object.fromEntries((header ?? '').split(',').map((p) => p.split('=', 2)));
  const t = Number(parts.t);
  if (!t || !parts.v1) return false;
  // Rechazar timestamps viejos (o futuros): frena los replays.
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_SEC) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const received = Buffer.from(parts.v1, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

const app = express();
const seen = new Set(); // en la vida real, usá tu base de datos

app.post('/webhooks/zerosoft', express.raw({ type: 'application/json' }), (req, res) => {
  const raw = req.body.toString('utf8');
  if (!verify(raw, req.get('zerosoft-signature'), SECRET)) return res.sendStatus(400);

  const delivery = req.get('zerosoft-delivery');
  if (seen.has(delivery)) return res.sendStatus(200); // reintento de algo ya procesado
  seen.add(delivery);

  const event = JSON.parse(raw);
  res.sendStatus(200); // responder rápido, trabajar después
  handle(event).catch(console.error);
});

async function handle(event) {
  if (event.type === 'ping') return;
  // booking.created, link.clicked, …
}

app.listen(8080);
```

`timingSafeEqual` importa: un `===` común entre strings puede filtrar, por el tiempo de respuesta, cuántos caracteres iniciales coincidieron.

## Timeouts, fallas y reintentos

Cada intento tiene un **timeout de 8 segundos**. Cualquier cosa que no sea 2xx cuenta como falla — redirects incluidos, porque no los seguimos. Si tu endpoint se mudó, actualizá la URL en vez de redirigir.

El primer intento sale apenas ocurre el evento. Si falla, la entrega se reprograma con backoff: **1 minuto, 5 minutos, 30 minutos, 2 horas, 12 horas**. Después de ese sexto intento queda marcada como `failed` y paramos. Son unas 15 horas de gracia para que tu servidor vuelva.

Los reintentos los corre el job periódico `/api/cron/tick`, que toma hasta 50 entregas vencidas por pasada. O sea que el cronograma real es "ese delay, o el próximo tick, lo que llegue después". En Zerosoft Cloud eso está resuelto. Si hacés self-host, tenés que llamar al tick vos — la [guía de Docker](/blog/self-hosting-con-docker-paso-a-paso) muestra la línea de crontab.

El panel muestra la última entrega de cada webhook: estado, código de respuesta y cuándo.

## SSRF: por qué no vamos a llamar a tu localhost

La URL de un webhook es una URL que tipeó un usuario y que nuestro servidor va a pedir. Sin barandas, eso es un server-side request forgery de manual: apuntala a `http://169.254.169.254/` y le estás pidiendo credenciales al servicio de metadata del proveedor de nube.

Por eso `safe-fetch.ts` revisa cada URL, al crear el webhook y otra vez en cada intento:

- Solo `https://` en producción (`http` plano se permite solo fuera de producción, para desarrollo).
- Se rechazan los hostnames `localhost`, `*.localhost` y `*.internal`.
- Se resuelve el hostname, y si **cualquiera** de las direcciones cae en un rango privado o reservado, se rechaza: `10.0.0.0/8`, `127.0.0.0/8`, `0.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, multicast para arriba, más loopback IPv6, unique-local (`fc00::/7`), link-local y direcciones IPv4 mapeadas.
- No se siguen redirects, así que una URL pública no nos puede rebotar hacia adentro.

Siendo precisos con los límites: el chequeo resuelve el DNS y después `fetch` lo resuelve de nuevo, así que un DNS hostil que cambie la respuesta entre esas dos consultas (DNS rebinding) no queda cerrado del todo. Achica mucho la ventana; no es un firewall a nivel de red.

## Self-host en una red privada

Si corrés Zerosoft dentro de la red de tu empresa y querés que llame a servicios internos — `http://n8n.lan:5678/webhook/…`, por ejemplo —, configurá:

```bash
ALLOW_PRIVATE_WEBHOOKS=true
```

Eso apaga por completo el requisito de HTTPS y los chequeos de direcciones privadas. Es lo correcto en una máquina donde todos los usuarios son compañeros de trabajo. Es lo incorrecto en cualquier cosa multi-tenant o pública: cualquiera que pueda crear un webhook podría hacer que tu servidor mande requests a cualquier cosa que tenga a su alcance.

## Checklist

- Verificá la firma sobre el body crudo, con el secret `whsec_` completo.
- Rechazá timestamps de hace más de unos minutos.
- Deduplicá por `Zerosoft-Delivery`.
- Respondé 2xx en menos de 8 segundos; encolá el trabajo lento.
- No redirijas. No esperes eventos del CRM (todavía).
