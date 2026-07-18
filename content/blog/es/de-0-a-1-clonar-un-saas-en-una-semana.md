---
title: "De 0 a 1: clonar un SaaS en una semana"
description: "Lo que antes llevaba un equipo y seis meses, hoy lleva días. Link se construyó así. Cuando el costo de crear software colapsa, el precio tiene que seguirlo."
date: "2026-05-30"
author: "Zerosoftware"
tags: ["ia", "open source", "saas", "link"]
---

Hace dos años, clonar Bitly era un proyecto de seis meses: un equipo de tres o cuatro personas, un roadmap, sprints, QA y un presupuesto de seis cifras. Hoy lo hace un ingeniero con una LLM en una semana. No es una predicción. Es exactamente lo que hicimos con Link.

## Qué significa "una semana"

Cuando decimos que Link se construyó en días, hablamos de todo esto:

- Un redirect engine que resuelve un alias custom y devuelve el destino en milisegundos.
- Un dashboard con analytics por día, referrer, país, device, browser y OS — sin cookies.
- QR en SVG y PNG, links con password, expiración, límite de clicks, tags y UTM builder.
- Una API pública v1 con API keys por Bearer.
- Login solo con Google. Sin formularios de registro ni passwords que guardar.

Cada una de esas piezas era, en 2019, un ticket de dos semanas. Hoy es una tarde.

## Qué cambió de verdad

No es que la IA "programa sola". Es que el 80% del trabajo de un SaaS estándar es código que ya se escribió mil veces: endpoints CRUD, migraciones, validaciones, tests, un esquema de API keys, un rate limiter. Ese código no necesita genio; necesita tiempo. Y las LLMs lo bajaron de semanas a minutos.

El ingeniero senior no desapareció: cambió de rol. Dejó de tipear boilerplate y pasó a hacer lo que siempre fue su trabajo real — decidir la arquitectura, revisar, cortar features, mantener la coherencia del sistema. La IA escribe rápido; alguien tiene que saber qué pedirle y qué rechazar.

El resultado es una asimetría brutal: el costo de *crear* un SaaS típico cayó una o dos órdenes de magnitud. Y el costo de *correrlo* ya era público: una VPS, una base de datos, ancho de banda que se mide en centavos.

## La consecuencia que nadie quiere decir en voz alta

Si construir un acortador de links cuesta una semana de una persona, cobrar $12 por mes por usarlo no es un negocio: es un alquiler cobrado sobre la costumbre.

Los precios del SaaS se sostenían con un argumento razonable: construir software era caro, y alguien tenía que pagar esos sueldos. Ese argumento murió. Cuando el costo de producción colapsa, el precio lo sigue — pasó con la música, con el almacenamiento, con las llamadas internacionales. El software no es especial.

Nosotros simplemente lo hacemos explícito:

1. **Self-host, $0.** El código de Link es open source. Descargalo, auditalo, hostealo. Es tuyo.
2. **Cloud al costo.** Si no querés administrar nada, lo corremos nosotros y pagás exactamente lo que cuesta la nube. Sin margen, ni un peso más.

La semana que tarda clonar un SaaS no es una anécdota de productividad. Es el nuevo precio del software: cero por los bits, más lo que cuestan los servidores. Y eso está publicado.
