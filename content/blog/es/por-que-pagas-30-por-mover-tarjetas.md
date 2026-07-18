---
title: "Por qué pagás $30 por mover tarjetas"
description: "Un gestor de proyectos es una base de datos, un drag-and-drop y un login. Desarmamos el precio del SaaS, pieza por pieza."
date: "2026-07-03"
author: "Zerosoftware"
tags: ["saas", "precios", "track"]
---

Abrí tu gestor de proyectos. ¿Qué ves? Tarjetas que se mueven entre columnas. Un campo de texto con formato. Asignaciones, fechas, etiquetas. Notificaciones.

Ahora preguntate: ¿qué parte de eso cuesta $30 por usuario por mes?

## La anatomía de un kanban

Técnicamente, un gestor de proyectos moderno es:

1. **Una base de datos.** Postgres o similar. Guarda tablas: proyectos, tareas, usuarios, comentarios. Costo por usuario activo: centavos.
2. **Un frontend con drag-and-drop.** React, una librería de DnD, websockets para sincronizar. Se escribe una vez y sirve a millones.
3. **Un login.** OAuth con Google. Resuelto, gratis, hace una década.
4. **Un servidor.** Un VPS de $20 corre esto para cientos de empresas chicas.

El costo marginal de agregar un usuario más es, literalmente, cero. No hay fábrica, no hay stock, no hay envío. Es un `INSERT` en una tabla.

## Entonces, ¿qué estás pagando?

No pagás tecnología. Pagás:

- **La costumbre.** "Siempre costó eso" no es un argumento, es una herencia.
- **El lock-in.** Tus proyectos, tu historial, tus flujos están adentro. Migrar cuesta más que seguir pagando. El precio no refleja el valor del software: refleja el costo de irte.
- **El positioning.** Cuando el primero puso $8/usuario y funcionó, todos copiaron. No es un precio de mercado: es un cartel de hecho.
- **El marketing.** Una parte enorme de tu suscripción paga los ads que te trajeron a vos y al próximo cliente. Pagás para que te vendan.

## La prueba de fuego

Hay una forma simple de saber si un precio es honesto: ¿cuánto cuesta correrlo vos mismo?

Un gestor de proyectos open source en un VPS de $5/mes sirve para todo un equipo. Sin límite de usuarios. Con tus datos en tu servidor. La diferencia entre $5 y $30×10 usuarios no es ingeniería: es margen.

## Por eso existe Track

Track es nuestro gestor de proyectos. Open source, rápido, keyboard-first, con cycles y roadmaps. Si lo hosteás vos, cuesta $0. Si lo corremos nosotros, pagás la nube al costo: unos pocos dólares por equipo, no por usuario.

No es más barato porque valga menos. Es más barato porque cobramos lo que cuesta.

El software murió. Y su precio también.
