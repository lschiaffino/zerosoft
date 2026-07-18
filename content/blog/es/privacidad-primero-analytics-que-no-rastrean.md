---
title: "Privacidad primero: analytics que no rastrean personas"
description: "No guardamos IPs, no usamos cookies, no perfilamos a nadie. Este es el manifiesto de privacidad de Zerosoftware: qué no recolectamos, y por qué."
date: "2026-06-01"
author: "Zerosoftware"
tags: ["privacidad", "manifesto", "analytics", "open source"]
---

La web moderna se construyó sobre un trato silencioso: el software es "gratis" y a cambio te observa. Cada click, cada scroll, cada segundo que pasás en una página termina en una base de datos que no conocés, mezclado con tu historial de otros mil sitios, vendido a terceros que tampoco conocés. No es una conspiración: es el modelo de negocio.

Zerosoftware nace con la convicción opuesta: el software es una herramienta, no una cámara. Este post es nuestro manifiesto de privacidad — lo que no recolectamos, lo que sí, y por qué la diferencia importa.

## Lo que NO recolectamos

La lista de lo que no hacemos es más importante que la de lo que sí:

- **No guardamos direcciones IP.** Ni completas ni hasheadas. Una IP es un identificador personal; si no la guardás, no la podés perder ni vender.
- **No usamos cookies de tracking.** Ni propias ni de terceros. Por eso Link no necesita banner de consentimiento: no hay nada que consentir.
- **No hacemos fingerprinting.** Nada de canvas, fuentes instaladas ni combinaciones exóticas de atributos para reconocerte entre sesiones.
- **No seguimos personas entre sitios.** Nuestros analytics ven un click, no a un usuario. Los "perfiles de usuario" no existen en nuestra base de datos porque nunca creamos esa tabla.
- **No vendemos ni compartimos datos.** Con nadie, jamás. No hay "partners de confianza" ni cláusulas con asterisco.

## Lo que sí medimos (y por qué alcanza)

Los analytics de Link responden las preguntas que el dueño de un link realmente tiene: ¿cuánta gente hizo click?, ¿de dónde vino?, ¿en qué dispositivo? Para eso guardamos, por cada click:

- La fecha y la hora.
- El referrer (el sitio desde donde llegaron, si el navegador lo envía).
- El país, calculado con una base geo local, sin llamadas a servicios externos.
- Device, browser y sistema operativo, leídos del header `User-Agent` y descartados enseguida: guardamos "iPhone / Safari / iOS", no el header crudo.

Conteos agregados. Con esos datos no podés identificar a una persona — y esa es exactamente la idea. Diseñamos el esquema de la base de datos de modo que ni siquiera nosotros podríamos rastrearte aunque quisiéramos. La privacidad que depende de promesas es frágil; la que depende de arquitectura, no.

## Software que trabaja para vos, no que te vigila

Un martillo no le reporta a la fábrica cada clavo que pusiste. Una planilla de cálculo no debería reportar los números que escribís. Durante veinte años aceptamos como normal que nuestras herramientas nos espíen porque "así se financian". Falso: se financian así porque es más rentable, no porque sea necesario.

Nuestro modelo no necesita tus datos. El código es open source: podés auditar exactamente qué se guarda y qué no — no tenés que creernos, podés leerlo. Podés self-hostearlo en un VPS de $5 y que tus datos no salgan jamás de tu servidor. Y si preferís nuestro cloud, pagás el costo real de la infraestructura. Ninguna de las tres vías involucra monetizar tu comportamiento.

## Los principios

1. **Recolectar el mínimo.** Si un dato no es imprescindible para que la herramienta funcione, no se guarda.
2. **Imposible por diseño.** Lo que no se guarda no se puede filtrar, vender ni citar judicialmente.
3. **Verificable, no confiable.** Código abierto, siempre. La privacidad que no se puede auditar es marketing.
4. **Tus datos son tuyos.** Export completo desde el día uno, en cada producto — Link hoy; CRM, scheduling y project management mañana.

La privacidad no es una feature que se agrega en la versión 2.3 para cumplir con una regulación. Es una decisión fundacional: de arquitectura y de modelo de negocio. Nosotros la tomamos el día cero, y no vuelve atrás.
