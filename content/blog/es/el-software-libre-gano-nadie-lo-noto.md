---
title: "Internet corre sobre software libre, menos la capa que usás"
description: "Linux, Postgres, nginx y Kubernetes sostienen buena parte de internet. Las herramientas de oficina siguieron cerradas y con suscripción. Por qué pasó y qué hacemos al respecto."
date: "2026-05-28"
author: "zerosoft"
tags: ["open source", "linux", "saas"]
---

Para que leas esta página, el pedido probablemente pasó por un servidor Linux, un nginx y una base Postgres, adentro de un contenedor. La infraestructura de internet es, en su mayoría, software libre, y hace tanto tiempo que ya no es noticia.

Algunos datos verificables:

- Las 500 supercomputadoras del ranking TOP500 corren Linux desde 2017.
- Postgres, MySQL, Redis, nginx, Kubernetes, Docker y Git son open source.
- Los informes anuales de Synopsys sobre auditorías de código comercial encuentran componentes open source en más del 90% de las bases de código que revisan.

## La capa que quedó cerrada

La excepción es la capa que toca el usuario: el acortador de links, el CRM, el calendario, el gestor de proyectos, el chat del equipo. Esas herramientas siguen siendo propietarias y se pagan por mes.

Y están construidas sobre lo mismo: corren en Linux, guardan datos en Postgres y sirven tráfico con nginx. Abajo son open source; arriba se alquilan.

El resultado se ve en cualquier presupuesto. La infraestructura, que es lo difícil, no cuesta licencia. Las herramientas de oficina, que son técnicamente más simples, cuestan decenas de dólares por usuario por mes.

Hay una explicación. La infraestructura la construyeron ingenieros para otros ingenieros, y compartirla les convenía a todos. La capa de aplicación es donde estaba el negocio: el usuario final no audita código, paga suscripciones.

## Lo que estamos haciendo

zerosoft reconstruye esa capa como open source (AGPLv3). Empezamos por Link y hoy son once apps: CRM, Chat, Agents, Flow, Robots, Track, Link, Docs, Notes, Cal y Board.

Las podés correr en tu servidor por $0, o usar zerosoft Cloud, que tiene un plan gratis y después cobra por uso del workspace (clics, reservas, emails, almacenamiento).
