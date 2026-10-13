---
title: "Por qué AGPLv3 (y no MIT, Apache ni BSL)"
description: "Elegimos la licencia que asusta a algunos abogados. Qué te obliga de verdad AGPLv3, qué no, la cláusula de red en criollo y qué significa si hosteás Zerosoft en tu empresa."
date: "2026-07-31"
author: "Zerosoftware"
tags: ["open source", "licencias", "agpl"]
---

Toda empresa open source tarde o temprano tiene la charla de la licencia. La nuestra fue corta: el core de Zerosoft — cada feature de Link, CRM, Track, Cal, Chat y Docs — está bajo la GNU Affero General Public License, versión 3. No MIT. No Apache 2.0. No la Business Source License que está de moda esta década.

AGPL tiene fama. Hay empresas que la prohíben de entrada, y muchos developers creen que significa "vas a tener que liberar el código de toda tu empresa". No es así. Así que acá va por qué la elegimos y qué te pide realmente.

Un aviso antes de arrancar: esta es nuestra lectura de una licencia pública, escrita por gente que hace software, no por abogados. No es asesoramiento legal. Si tu empresa tiene algo serio en juego con una pregunta de licencias, el texto de la licencia y tu abogado le ganan a un post de blog.

## Las opciones que descartamos

**MIT y Apache 2.0** son permisivas. Cualquiera puede tomar el código, modificarlo, cerrarlo y venderlo, sin obligación de devolver nada. Es una elección perfectamente honesta y muchísimo software excelente la usa. Para nosotros tiene un problema concreto: una empresa con mucha plata podría agarrar los seis productos, ponerlos detrás de un login, mejorarlos en privado y competir contra lo mismo que intentamos mantener libre. Las licencias permisivas hacen eso legal y barato.

**BSL y otras licencias "source-available"** van para el otro lado. Podés leer el código, pero el uso en producción está restringido (típicamente: no lo ofrezcas como servicio competidor) hasta una fecha de cambio, años después, cuando pasa a una licencia abierta. Protege a la empresa. Pero no es open source según la definición de la Open Source Initiative, y las reglas pueden endurecerse en cada versión nueva. No queríamos que nuestro core fuera algo que podés *mirar*. Queríamos que fuera algo que *tenés*.

**AGPLv3** se ubica en el medio de una forma muy específica: es una licencia open source de verdad, aprobada por la OSI, y cierra el único agujero que importa en software web.

## Qué obliga la familia GPL

La idea de la GPL es vieja y simple: podés usar, estudiar, modificar y compartir el software, y si *distribuís* una versión modificada, tenés que compartir su código bajo la misma licencia. Las libertades viajan con el código.

El problema con las web apps es que nunca se distribuyen. Los usuarios tocan un servidor; nunca reciben un binario. Con la GPL a secas, una empresa puede modificar una web app, correrla como servicio para millones de personas y no compartir una sola línea. A eso a veces le dicen el "agujero del SaaS".

## La cláusula de red, en criollo

AGPL agrega una sola cosa: la sección 13. Si **modificás** el programa y hay usuarios que **interactúan con él de forma remota por red**, tu versión modificada tiene que ofrecerles a esos usuarios una forma de obtener su código fuente correspondiente.

Eso es todo. Algunas consecuencias que la gente suele pasar por alto:

- **Sin modificación, no hay obligación extra.** Correr Zerosoft sin modificar — incluso como servicio público — no activa la sección 13. El código ya es público.
- **Es sobre los usuarios de tu instancia.** La obligación es con la gente que interactúa con tu versión modificada, no con "todo internet" ni con nosotros.
- **Cubre el programa y tus cambios**, bajo la misma licencia. No se extiende a software ajeno que simplemente le habla por HTTP, como los scripts que llaman a nuestra API pública con una key `zs_…`.

## Qué significa si lo hosteás en tu empresa

El caso más común: una empresa corre Zerosoft en su propio servidor para su propio equipo.

- **Sin modificar:** usalo como quieras. Interno, externo, comercial: ninguna obligación más allá de conservar los avisos de licencia. No nos pagás nada y no publicás nada.
- **Modificado, solo de uso interno:** la gente que interactúa con él son tus propios empleados. Ofrecerles el código de tu propio fork interno es, en la práctica, un no-evento. Nada se hace público.
- **Modificado, con superficies públicas:** esta es la parte que vale pensar. Varias features de Zerosoft las usan personas de afuera de tu empresa: las páginas públicas de reserva de Cal en `/book/[slug]`, el widget embebible de Chat, las páginas link-in-bio en `/@handle`. Una lectura conservadora es que esos visitantes también interactúan con tu versión modificada, así que deberías poder ofrecerles su código. La forma fácil de quedarte tranquilo: tené tu fork en un repo público, o mandanos los cambios.

Y si contribuís tu cambio de vuelta, la pregunta desaparece: está en el código principal, que ya es público.

## Por qué esto también te protege a vos

A AGPL se la suele presentar como protección para el autor. También es protección para el usuario.

Cada mejora que alguien le hace a un servicio público de Zerosoft vuelve al común. Nadie puede armar una versión cerrada y mejor sobre el código del que dependés y dejarte atrás. Y como el copyleft aplica a todos — incluida cualquier empresa que algún día nos compre —, el código que está publicado hoy sigue siendo AGPL para siempre. Un futuro dueño podría cambiar la licencia del código *nuevo*, pero no puede retirar lo que ya se publicó. Siempre podés forkear desde la última versión libre.

Esa es la diferencia con una licencia que se revisa en cada release. Hicimos la promesa en el único formato que no se puede romper en silencio. Es el lado práctico de lo que escribimos en [open source no es gratis: es libre](/blog/open-source-no-es-gratis-es-libre).

## Lo que AGPL no cubre: /ee

Hay una sola carpeta que no es AGPL: `/ee`. Es para features enterprise — SSO/SAML, audit logs, roles custom, white-label — bajo una licencia comercial aparte, source-available, y todavía está mayormente en desarrollo. El código del core solo puede tocarla a través de un archivo (`ee/lib/license.ts`), y sin una license key el core funciona exactamente igual. Dónde está esa línea y por qué lo contamos en [open core explicado](/blog/open-core-explicado).

## La versión corta

- Podés usar Zerosoft para lo que quieras, incluso comercialmente, gratis.
- Podés modificarlo. Si corrés una versión modificada que la gente usa por red, compartí tus cambios con esa gente.
- No podés cerrarlo.

Nos parece un trato justo. Es el mismo que nos mantiene honestos: si algún día hacemos la nube peor que el código, agarrás el código y te vas.
