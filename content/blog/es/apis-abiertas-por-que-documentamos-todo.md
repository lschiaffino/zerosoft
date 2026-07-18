---
title: "APIs abiertas: por qué documentamos todo"
description: "La API v1 de Link es pública, completa y está documentada endpoint por endpoint en /docs. No es una feature más: es nuestra garantía anti-lock-in."
date: "2026-05-27"
author: "Zerosoftware"
tags: ["api", "open source", "link"]
---

Hay una forma fácil de saber si un producto te respeta: mirá su API. Si la API existe, si está documentada, si te deja hacer todo lo que hacés desde la interfaz, el producto te trata como un adulto. Si la API es un accesorio — tres endpoints escondidos, docs desactualizadas, "contactá a ventas para acceso" — el producto te trata como un rehén.

Nosotros arrancamos por el otro lado. Link es API-first: la interfaz web es un cliente más de la API pública. Todo lo que podés hacer con el mouse lo podés hacer con curl.

## La API v1, completa

La API v1 de Link está disponible hoy, documentada endpoint por endpoint en /docs, sin secciones de "coming soon" disfrazadas:

- **Crear links**: `POST /api/v1/links` con alias custom, password, fecha de expiración, máximo de clicks, tags y parámetros UTM.
- **Listar y buscar**: `GET /api/v1/links` con filtros por tag y dominio.
- **Estadísticas**: `GET /api/v1/links/:id/stats` con clicks por día, referrer, país, device, browser y OS. Sin cookies, sin fingerprinting — los mismos datos que ves en el dashboard.
- **QR**: generación en SVG y PNG.

La autenticación es una API key en el header `Authorization: Bearer`. Las generás y revocás desde tu cuenta, sin ticket de soporte de por medio. Los rate limits son públicos y viajan en headers `X-RateLimit-*` en cada respuesta: sabés exactamente cuántas requests te quedan antes de pegarle al techo. Los errores son JSON con códigos estables, no HTML de sorpresa.

```bash
curl -X POST https://zerosoftware.ai/api/v1/links \
  -H "Authorization: Bearer TU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://tuempresa.com/launch", "alias": "launch"}'
```

## La garantía anti-lock-in que funciona de verdad

Todo el mundo promete "sin lock-in". La mayoría quiere decir "podés exportar un CSV si encontrás el botón". Una API abierta es una promesa distinta, y verificable:

1. **Podés automatizar tu salida.** Un script de veinte líneas recorre tus links, baja tus stats y los reconstruye en otro lado. No necesitás nuestra cooperación.
2. **Podés integrarte sin permiso.** Tu CRM, tu CI, tu newsletter. Si habla HTTP, habla con Link.
3. **El plan B ya existe.** El código es open source. Si mañana desaparecemos, tu automatización apunta a tu propio servidor y sigue igual. La API es la misma porque el software es el mismo.

Una empresa que te da una API completa te está dando la puerta de salida, con la luz encendida y sin candado. Nosotros la documentamos porque estamos convencidos de que te vas a quedar por lo bien que funciona, no por lo difícil que es irte.

## Lo que viene

- **Webhooks**: eventos de click en tiempo real hacia tu endpoint, para reaccionar en el momento en que pasa algo.
- **Endpoints por producto**: Track (Q4 2026), CRM (Q1 2027) y Cal (Q2 2027) salen cada uno con su API pública desde el día uno. Misma regla: documentado primero, estable después.

La interfaz es para las personas. La API es para tu empresa. Las dos tienen que ser de primera clase, o ninguna lo es.
