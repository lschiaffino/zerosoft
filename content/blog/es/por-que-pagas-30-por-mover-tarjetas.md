---
title: "Por qué pagás $30 por mover tarjetas"
description: "Un gestor de proyectos es una base de datos, un frontend con drag-and-drop y un login. Qué parte del precio por usuario paga tecnología y qué parte paga otra cosa."
date: "2026-07-03"
author: "zerosoft"
tags: ["saas", "precios", "track"]
---

Un gestor de proyectos muestra tarjetas en columnas, un campo de texto con formato, asignaciones, fechas, etiquetas y notificaciones. Algunos cobran unos $30 por usuario por mes por eso. Veamos qué hay adentro.

## Las piezas

Técnicamente, un gestor de proyectos es:

1. **Una base de datos** con proyectos, tareas, usuarios y comentarios. El costo por usuario activo se mide en centavos.
2. **Un frontend con drag-and-drop.** Se escribe una vez y sirve a todos los clientes.
3. **Un login.** OAuth con Google, resuelto hace una década.
4. **Un servidor.** Un VPS de $20 alcanza para muchos equipos chicos.

Agregar un usuario es un `INSERT` en una tabla.

## Qué estás pagando

Más que tecnología, pagás:

- **La costumbre.** El precio de referencia lo fijó el primero que funcionó y el resto lo copió.
- **El costo de irte.** Tus proyectos, el historial y los flujos del equipo están adentro. Mientras migrar cueste más que pagar, el precio se sostiene.
- **La venta.** Una parte de la suscripción paga los anuncios y el equipo comercial que trae al próximo cliente.

## Una prueba simple

Preguntate cuánto costaría correrlo vos. Un gestor de proyectos open source en un VPS de $5 por mes sirve a un equipo entero, sin límite de usuarios y con los datos en tu servidor. La diferencia entre $5 y $30 × 10 usuarios no se explica por ingeniería.

## Track

Track es nuestro gestor de proyectos: issues con sub-issues y relaciones, ciclos, estimaciones y cuatro vistas (lista, board, calendario y Gantt). Es open source y lo corrés por $0. En zerosoft Cloud, el workspace tiene un plan gratis y después paga por uso; los asientos no se cobran.

Lo que todavía no tiene: API pública, atajos de teclado y sincronización en tiempo real. Lo contamos en [Track vs Linear](/blog/zerosoft-track-vs-linear).
