---
title: "Cómo funciona un código QR y por qué no debería ser un plan premium"
description: "El QR es un estándar abierto (ISO/IEC 18004) cuyo inventor decidió no cobrar la patente. Cómo se arma la grilla, qué hace la corrección de errores y cómo los genera Link."
date: "2026-06-22"
author: "zerosoft"
tags: ["link", "qr", "open source"]
---

El código QR nació en 1994 en Denso Wave, una empresa del grupo Toyota. Masahiro Hara y su equipo lo diseñaron para seguir autopartes en la línea de montaje: necesitaban algo que guardara más datos que un código de barras y se leyera rápido desde cualquier ángulo.

Denso Wave decidió no ejercer la patente. La especificación se publicó y hoy es el estándar ISO/IEC 18004. Cualquiera puede generar y leer códigos QR sin pagar licencia.

## Generar un QR

Un QR es aritmética: tus bytes se codifican en una grilla de módulos blancos y negros, se les suma corrección de errores Reed-Solomon y se dibuja el resultado. En cualquier CPU de los últimos veinte años tarda microsegundos.

No hace falta un servidor especial ni hay un costo que crezca con el uso. Con una librería open source podés generar un millón en una laptop vieja, sin internet.

## Cómo funciona

Un QR es una matriz de módulos. La versión 1 mide 21×21 y cada versión suma 4 módulos por lado, hasta la 40, de 177×177. Tres elementos hacen el trabajo:

- **Los cuadrados de las esquinas** (finder patterns) le indican al lector dónde está el código y en qué ángulo. Por eso se lee rotado o en perspectiva.
- **La corrección Reed-Solomon** guarda los datos con redundancia. En el nivel más alto, el código se lee aunque falte hasta un 30%. Por eso se puede poner un logo en el medio.
- **La máscara**: antes de dibujarse, la grilla pasa por un XOR con un patrón para evitar bloques grandes de un solo color.

El resto son los datos en zigzag: modo de codificación, longitud y contenido. Una URL entra sobrada en las versiones chicas.

## Por qué aparece en planes pagos

En muchos SaaS de marketing y links, el QR está en el plan premium. Se cobra una suscripción por ejecutar una librería open source sobre un estándar abierto.

## En Link

Cada link corto de Link tiene su QR en dos formatos:

- **SVG**, vectorial, para imprenta, vidrieras o packaging.
- **PNG**, para presentaciones, PDFs o stickers.

Sin límite de descargas ni marca de agua. Lo que todavía no hace: QR con logo o colores propios.
