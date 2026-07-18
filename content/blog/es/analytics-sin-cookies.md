---
title: "Analytics sin cookies: lo que un click ya te cuenta"
description: "Las analytics de Link no usan cookies, ni JavaScript, ni fingerprinting. Todo lo que sabemos de un click viene del request HTTP que el navegador iba a mandar de todas formas."
date: "2026-06-24"
author: "Zerosoftware"
tags: ["analytics", "privacidad", "link", "open source"]
---

Un click en un link corto es una conversación entre un navegador y nuestro servidor. Antes de que exista cualquier analytics, esa conversación ya pasa: el navegador pide el redirect, el servidor contesta con un 302. Las analytics sin cookies son simplemente escuchar con atención esa conversación, en vez de intervenir el cuarto.

## El request cuenta la historia

Cuando alguien hace click en tu link corto, el navegador manda un request HTTP. Tres piezas de ese request cargan todo lo que reportamos:

- **El header Referer.** Dice de dónde vino el click: `x.com`, `news.ycombinator.com`, el dominio de tu newsletter. Los navegadores modernos lo recortan al origen por defecto, así que vemos el sitio, no la página exacta. El sitio es la respuesta útil.
- **El header User-Agent.** El string con el que el navegador se presenta. Lo parseamos localmente en tres campos: tipo de device (mobile, tablet, desktop), familia de browser y familia de OS. El string crudo nunca toca la base de datos.
- **La IP de la conexión.** Sirve para una sola cosa: una consulta de país contra una base GeoIP empaquetada con la app. La consulta pasa en memoria, en nuestro servidor, sin llamadas externas, y después se descarta. Guardamos el código de país, no la dirección.

No hay JavaScript en la página de destino. No hay pixel. No hay localStorage. El click se mide en el redirect, el único momento en que el navegador tiene que hablarnos sí o sí.

## Qué guardamos, qué no

Cada click se convierte en una fila de unos 200 bytes:

- Timestamp
- ID del link
- Host del referrer
- Código de país
- Tipo de device, familia de browser, familia de OS

La lista que importa más: lo que no guardamos.

- **Nada de IPs.** Se usan en memoria, se descartan, jamás se escriben en disco.
- **Nada de cookies.** No seteamos ninguna, en ningún dominio.
- **Nada de fingerprinting.** Ni canvas, ni enumeración de fuentes, ni tamaño de pantalla.
- **Nada de user IDs, sesiones o identidad entre clicks.** No sabemos si una persona clickeó diez veces o diez personas una vez. No queremos saberlo.

El dashboard y `GET /api/v1/links/:id/stats` muestran clicks por día, referrer, país, device, browser y OS. Ese es el dataset completo. Es agregado por construcción, no por política.

## Por qué no hay banner de consentimiento

Los banners de cookies existen por dos reglas. Las normas de ePrivacy exigen consentimiento antes de guardar o leer información en el dispositivo de alguien: eso son las cookies y sus primas. El GDPR entra en juego cuando procesás datos personales, y una IP atada a un historial de navegación califica.

Nosotros no hacemos ninguna de las dos. Nada se guarda en el dispositivo del visitante y nada de lo que guardamos puede identificar a una persona. No hay nada que consentir, así que no hay banner, y no perdés un pedazo de tu audiencia en el "rechazar todo". Si tu equipo legal quiere verificarlo, el schema es open source: lo leen más rápido de lo que tardan en coordinar una reunión.

## Comparado con las analytics tradicionales

Las analytics web clásicas cargan un script de terceros, setean cookies, siguen usuarios entre sesiones y a veces entre sitios, y después mandan todo a servidores ajenos. Responden preguntas como "quién es esta persona y qué más le gusta", preguntas que un shortener no tiene por qué hacerse.

Para un redirect, además, el enfoque server-side es simplemente más preciso: un ad blocker puede matar un script de tracking, pero no puede frenar un 302. Cada click se cuenta, porque el conteo pasa donde pasa el redirect.

Las stats de tus links son tuyas: visibles en el dashboard, exportables por la API, e idénticas si hacés self-host. Mismo código, mismo schema, tu SQLite. Analytics que miden tu tráfico sin vigilar a tu audiencia.
