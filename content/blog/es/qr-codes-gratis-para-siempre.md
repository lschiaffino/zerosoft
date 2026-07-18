---
title: "Los códigos QR son gratis. Para siempre."
description: "El QR es un estándar abierto desde 1994: ISO/IEC 18004, patentes renunciadas por su inventor. Generarlo cuesta cero cómputo. Cobrarlo como feature premium es un abuso — en Link va incluido."
date: "2026-06-22"
author: "Zerosoftware"
tags: ["link", "qr", "open source"]
---

El código QR nació en 1994 en Denso Wave, una subsidiaria de Toyota. Masahiro Hara y su equipo lo crearon para seguir autopartes en la línea de producción: necesitaban algo que guardara más datos que un código de barras y se leyera rápido, desde cualquier ángulo.

Y entonces hicieron algo que la industria del software todavía no termina de procesar: renunciaron a ejercer la patente. La especificación se publicó, el estándar se abrió y hoy es ISO/IEC 18004. Cualquiera puede generar y leer códigos QR. Sin licencia, sin regalías, sin pedirle permiso a nadie.

## Generar un QR no cuesta nada

Un QR no es un servicio. Es aritmética. Se toman tus bytes, se codifican en una grilla de módulos blancos y negros, se agrega corrección de errores Reed-Solomon y se dibuja el resultado. En cualquier CPU de los últimos veinte años, eso tarda microsegundos.

No hay "servidor de QR". No hay costo por código. No hay nada que escale con el uso. Podés generar un millón de QR en una laptop de hace diez años, sin internet, con una librería open source.

## Cómo funciona, en 40 segundos

Un QR es una matriz de módulos: la versión 1 es de 21×21, y cada versión suma 4 módulos por lado hasta la versión 40, de 177×177. Tres elementos hacen el truco:

- **Los cuadrados de las esquinas** (finder patterns): le dicen al lector dónde está el código y en qué ángulo. Por eso podés escanearlo rotado, torcido o en perspectiva.
- **La corrección Reed-Solomon**: los datos se guardan con redundancia. En el nivel más alto, el código se lee aunque esté hasta un 30% dañado o tapado. Por eso las marcas pueden estampar su logo en el medio.
- **La máscara**: antes de dibujarse, la grilla pasa por un XOR con un patrón de máscara para evitar grandes bloques de un solo color que confundirían al lector.

El resto son los datos en zigzag: modo de codificación, longitud y tu contenido. Un URL cabe sobrado en las versiones chicas.

## Entonces, ¿por qué te lo cobran?

Mirá cualquier SaaS de marketing o de links: los QR aparecen en el plan premium. "QR personalizados desde tantos dólares al mes." Te cobran una suscripción mensual por ejecutar una función de una librería open source sobre un estándar abierto con patentes renunciadas.

Es como cobrarte por sumar. La indignación es legítima: no están vendiendo tecnología, están vendiendo acceso a algo que ya era tuyo.

## En Link va incluido

Cada short link que creás en Link trae su QR, en dos formatos:

- **SVG**: vectorial, escala infinito sin pixelarse. Para imprenta, vidrieras, packaging.
- **PNG**: listo para pegar en una presentación, un PDF o un sticker.

Sin plan premium. Sin límite de descargas. Sin marca de agua. Para siempre — porque nunca fue nuestro para cobrarlo.

Link es open source: self-host a $0, o cloud al costo de la nube, sin margen. Los QR son la parte más barata de todo el sistema. Cobrarlos sería ridículo. Por eso no lo hacemos.
