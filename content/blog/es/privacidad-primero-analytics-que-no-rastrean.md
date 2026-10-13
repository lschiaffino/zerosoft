---
title: "Qué guarda Link de cada clic (y qué no)"
description: "Las métricas de Link no guardan IPs, no usan cookies ni fingerprinting y no arman perfiles. Qué columnas tiene la tabla de clics y por qué con eso alcanza."
date: "2026-06-01"
author: "zerosoft"
tags: ["privacidad", "manifesto", "analytics", "open source"]
---

Buena parte de la web funciona con un acuerdo implícito: la herramienta es gratis y, a cambio, te observa. Cada clic termina en una base de datos que no conocés, cruzado con tu historial en otros sitios.

Las métricas de Link están hechas al revés. Este post cuenta qué no guardamos, qué sí y por qué alcanza.

## Lo que no guardamos

- **Direcciones IP.** Ni completas ni hasheadas. La IP se usa en el momento para calcular el país y se descarta.
- **Cookies de seguimiento.** Ni propias ni de terceros. Por eso un link de Link no necesita banner de consentimiento.
- **Fingerprinting.** Nada de canvas, fuentes instaladas o combinaciones de atributos para reconocer a alguien entre visitas.
- **Perfiles.** Las métricas ven un clic, no una persona. No existe una tabla de "visitantes".
- **Venta de datos.** No compartimos datos con terceros.

## Lo que sí guardamos

Por cada clic, una fila con:

- Fecha y hora.
- Referrer (el sitio de origen, si el navegador lo manda).
- País. En Vercel lo pone el edge en un header; en tu servidor se calcula con una base geográfica local (geoip-lite), sin llamar a servicios externos.
- Dispositivo, navegador y sistema, leídos del `User-Agent`. Guardamos "iPhone / Safari / iOS", no el header completo.

Con eso respondés lo que un dueño de link quiere saber: cuánta gente hizo clic, de dónde vino y con qué dispositivo. No alcanza para identificar a nadie, y está hecho así a propósito: lo que no se guarda no se puede filtrar ni vender.

## Cómo verificarlo

El código es abierto: la inserción de clics está en `lib/track.ts` y tiene seis columnas. Podés leerla vos. Y si corrés Link en tu servidor, los datos nunca salen de ahí.

## Los principios

1. **Guardar el mínimo** que la herramienta necesita para funcionar.
2. **Que la arquitectura lo garantice**, no una promesa en la política de privacidad.
3. **Que se pueda auditar**, con el código a la vista.
4. **Que los datos se puedan llevar**: links y clics se exportan en CSV o JSON.
