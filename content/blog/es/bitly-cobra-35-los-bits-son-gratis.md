---
title: "Bitly cobra $35. Los bits son gratis."
description: "Desgranamos el plan pago de Bitly ítem por ítem y lo contrastamos con el costo real de servir redirects. La diferencia no es ingeniería: es margen."
date: "2026-06-26"
author: "Zerosoftware"
tags: ["bitly", "link", "precios"]
---

Abrí la página de precios de Bitly. El plan Core: $35 por mes, facturado anual. ¿Qué comprás exactamente con eso? Lo fuimos ítem por ítem, con la calculadora en la mano. Spoiler: la tecnología de esa lista cuesta menos que el café que estás tomando.

## Qué incluyen los $35, desgranado

- **Unos 1.500 links con tu marca por mes.** Un link es una fila en una tabla: slug, URL destino, fecha, flags. ~100 bytes. Los 1.500 del mes son 150KB — menos que una foto de tu celular. Costo marginal: $0.
- **Redirects ilimitados.** Cada click es un `SELECT`, un `INSERT` y una respuesta 302 de ~300 bytes. Es la workload más liviana que existe en la web. Un millón de redirects al mes mueven menos de 1GB de tráfico. Centavos, siendo generosos.
- **QR codes.** Un SVG o PNG generado al vuelo a partir del string del link. No hay cómputo ni almacenamiento que valga mencionar. Costo: $0.
- **Analytics de clicks.** Contador por día, referrer, país, dispositivo. Cada click es una fila de ~200 bytes. Cien mil clicks por mes durante un año: 240MB de disco. Un VPS de $5 trae 25GB.
- **Un dominio propio.** Aviso: lo registrás vos, al registrador, por unos $10 al año. Bitly no paga ni un centavo de eso.
- **UTM builder.** Un formulario que concatena strings con `?utm_source=...`. Literalmente eso.

## La suma que no cierra

Infraestructura total para un usuario intenso: menos de $1 por mes. Ya hicimos la cuenta completa, línea por línea, en otro post.

$35 dividido $1 es un margen del 3.400%. No es un precio de tecnología; es el precio de la ausencia de alternativa. Los $34 restantes pagan el equipo de ventas, los anuncios que te trajeron hasta ahí y una costumbre de veinte años de que "los links con marca se pagan".

> Cuando el precio de algo es 35 veces su costo, no estás comprando tecnología. Estás comprando costumbre.

## La alternativa ya existe

**Link** es nuestro acortador: alias custom, analytics por día, referrer, país, dispositivo, browser y OS — sin cookies —, QR en SVG y PNG, links con password, expiración, límite de clicks, tags, UTM builder y una API pública con API keys. Todo lo del checklist de Bitly, y más.

El código es abierto: descargalo y corrélo en tu VPS. Self-hosteado cuesta $0, para siempre. Y si preferís que lo corramos nosotros, con login, backups y uptime, pagás lo que la nube cuesta. Al costo. Sin margen.

Bitly cobra $35. Los bits son gratis. Ahora los links también.
