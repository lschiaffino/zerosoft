---
title: "Qué incluye el plan de $35 de Bitly y cuánto cuesta servirlo"
description: "El plan Core de Bitly, ítem por ítem, al lado de lo que cuesta guardar un link, servir un redirect y contar un clic."
date: "2026-06-26"
author: "zerosoft"
tags: ["bitly", "link", "precios"]
---

El plan Core de Bitly cuesta $35 por mes. Repasamos qué incluye y cuánto cuesta servir cada cosa.

## Qué incluyen los $35

- **Unos 1.500 links con tu marca por mes.** Un link es una fila: slug, URL de destino, fecha y algunos flags. Unos 100 bytes. Los 1.500 del mes ocupan 150 KB.
- **Redirects.** Cada clic es un `SELECT`, un `INSERT` y una respuesta 302 de unos 300 bytes. Un millón de redirects por mes mueve menos de 1 GB de tráfico.
- **Códigos QR.** Un SVG o PNG generado a partir del link. Sin almacenamiento ni cómputo relevantes.
- **Métricas de clics** por día, referrer, país y dispositivo. Cada clic es una fila de unos 200 bytes: cien mil clics por mes durante un año son 240 MB. Un VPS de $5 trae 25 GB de disco.
- **Un dominio propio.** El dominio lo registrás y lo pagás vos, unos $10 por año.
- **Constructor de UTM.** Un formulario que agrega `?utm_source=...` a una URL.

## La cuenta

Para un usuario intenso, la infraestructura cuesta menos de $1 por mes. El detalle está en [cuánto cuesta correr un acortador](/blog/cuanto-cuesta-correr-un-link-shortener).

El resto del precio paga ventas, publicidad y la costumbre de que los links con marca se pagan.

## Link

Link es nuestro acortador: alias propios, dominios propios, métricas por día, referrer, país, dispositivo, navegador y sistema (sin cookies), QR en SVG y PNG, links con contraseña, vencimiento o límite de clics, tags, constructor de UTM, importación desde Bitly, API REST y webhooks.

Es open source y lo corrés por $0. En zerosoft Cloud tenés un plan gratis y después pagás por uso (clics, almacenamiento). Lo que Link todavía no tiene (carpetas, QR con logo, ruteo por país) está en [Link vs Bitly](/blog/zerosoft-link-vs-bitly).
