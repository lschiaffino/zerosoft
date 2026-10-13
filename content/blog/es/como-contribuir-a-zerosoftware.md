---
title: "Cómo contribuir a zerosoft"
description: "El código es abierto, el roadmap es público y el blog sale en tres idiomas. Cómo sumarte con issues, PRs, traducciones, documentación e ideas de producto."
date: "2026-06-07"
author: "zerosoft"
tags: ["open source", "comunidad", "contribuir"]
---

Además de usar zerosoft, te podés sumar a hacerlo. El código de las once apps es open source, el roadmap es público y este blog sale en tres idiomas. Este post explica cómo ayudar: reportar bugs, mandar código, traducir, documentar o proponer funciones.

## Reportá lo que está roto

La contribución más subestimada del open source es un buen issue. Si algo falla, contalo:

- **Qué hiciste**, paso por paso, hasta que se rompió.
- **Qué esperabas** que pase y qué pasó en realidad.
- **Tu entorno**: versión, sistema operativo, cómo lo estás corriendo (self-host en tu VPS o en nuestro cloud).

Un issue con esos tres datos vale más que diez comentarios de "no me funciona". Y si el bug ya está reportado, sumá tu caso: cada reproducción independiente acorta el diagnóstico.

## Mandá código

El repo es público y los PRs se revisan en serio. Antes de abrir uno:

1. **Mirá los issues abiertos.** Si tu cambio ya se está discutiendo, sumate a esa conversación primero. Un PR sorpresa de 2.000 líneas es difícil de revisar; uno chico, alineado con un issue, entra rápido.
2. **Respetá el estilo del proyecto.** El código se lee mucho más de lo que se escribe: nombrá las cosas como las nombramos nosotros, comentá lo que nosotros comentamos, nada más.
3. **Un PR, un cambio.** Si arreglás un bug y de paso reformateás medio repo, tu PR es inreviewable. Dos PRs, mejor.

No hace falta que seas senior. Buena parte de los PRs que entran son typos, validaciones, tests y casos borde que nadie había probado. zerosoft corre sobre SQLite: lo descargás, lo corrés y tenés el entorno local funcionando en una tarde.

## Traducciones y documentación

zerosoft existe en tres idiomas: español, inglés y portugués. La interfaz, la documentación en /docs y este blog. Es mucho texto, y siempre hay alguna frase que suena a traducción automática disfrazada.

Si hablás dos de esos idiomas, tu contribución es directa: marcá la frase que suena rara y proponé una mejor. Las traducciones no las hace un equipo de localización en California: las hace gente que leyó algo y se le torció la cara.

Lo mismo con la documentación. La API v1 está documentada endpoint por endpoint, pero una doc nunca está terminada: ejemplos que faltan, errores comunes que nadie explicó, un tutorial de self-hosting para tu caso. Si en algún punto de /docs te trabaste, ese punto es tu PR.

## Ideas, no promesas

Después de Link vienen Track (gestión de proyectos, Q4 2026), CRM (Q1 2027) y Cal (agendamiento, Q2 2027). Ese orden no salió de una encuesta de marketing: salió de issues y conversaciones con la gente que usa Link. Si querés influir en lo que se construye, el lugar es ese: contanos qué herramienta cara te está cobrando de más y qué tendría que hacer la versión libre para reemplazarla.

Lo que no prometemos: fechas exactas, features a pedido, soporte 24/7. Somos un proyecto chico con principios grandes. Lo que sí prometemos es leer todo.

## El trato

Lo que aportás queda bajo AGPLv3: lo publicado no se puede cerrar y, si mañana desaparecemos, el software queda.
