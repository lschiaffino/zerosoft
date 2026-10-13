---
title: "Cómo construimos la primera versión de Link en una semana"
description: "Un ingeniero y una LLM: redirects, métricas sin cookies, QR, links con contraseña y una API pública en una semana. Qué hizo la IA, qué hizo la persona y qué implica para el precio del software."
date: "2026-05-30"
author: "zerosoft"
tags: ["ia", "open source", "saas", "link"]
---

Hace unos años, hacer un clon de Bitly era un proyecto de meses para un equipo de tres o cuatro personas. La primera versión de Link la hizo un ingeniero con una LLM en una semana. Esto es lo que entró y cómo se repartió el trabajo.

## Qué entró en esa semana

- Un motor de redirects que resuelve un alias y devuelve el destino en milisegundos.
- Un panel con métricas por día, referrer, país, dispositivo, navegador y sistema, sin cookies.
- QR en SVG y PNG, links con contraseña, vencimiento y límite de clics, tags y constructor de UTM.
- Una API pública v1 con claves personales.
- Login con Google.

En 2019, cada una de esas piezas era un ticket de dos semanas.

## Qué cambió

La IA no "programa sola". Lo que pasa es que buena parte de un SaaS estándar es código que ya se escribió muchas veces: endpoints CRUD, migraciones, validaciones, tests, claves de API, un rate limiter. Ese código lleva tiempo, no ingenio, y las LLMs lo escriben en minutos.

El trabajo del ingeniero se movió: menos tipear, más decidir la arquitectura, revisar, cortar funciones y mantener el sistema coherente. Alguien tiene que saber qué pedir y qué rechazar.

## Qué implica para el precio

Si construir un acortador lleva una semana, el argumento de "construir software es caro" ya no explica cobrar $35 por mes por usarlo. Lo que sigue costando plata es correrlo: un servidor, una base de datos y ancho de banda.

Por eso Link (y las otras diez apps) funciona así:

1. **Self-host por $0.** El código es open source. Lo descargás, lo auditás y lo corrés.
2. **zerosoft Cloud.** Si no querés administrar nada, lo corremos nosotros: plan gratis y después pago por uso (clics, almacenamiento).
