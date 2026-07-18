---
title: "El software libre ganó. Nadie lo notó."
description: "Linux, Postgres, nginx, Kubernetes: el mundo ya corre sobre open source. La única capa que siguió propietaria es la que toca el usuario. Esa última milla es la que venimos a cerrar."
date: "2026-05-28"
author: "Zerosoftware"
tags: ["open source", "linux", "saas"]
---

Si estás leyendo esto, tu pedido viajó por un servidor Linux, pasó por un nginx, consultó un Postgres y probablemente salió de un contenedor orquestado por Kubernetes. El mundo ya corre sobre software libre. Hace rato. Tan hace rato que dejó de ser noticia.

Los números son de una contundencia que aburre:

- Más del 80% de los servidores web y prácticamente el 100% de las 500 supercomputadoras más potentes del mundo corren Linux.
- Más del 90% de la infraestructura cloud se apoya en software open source.
- Postgres, MySQL, Redis, nginx, Kubernetes, Docker, Git: el stack completo con el que se construye internet es libre.
- Las auditorías de código de Synopsys vienen reportando hace años que más del 90% de las bases de código comerciales contienen componentes open source.

La batalla por el servidor terminó. Ganó el software libre, y ganó tan completo que nadie lo festeja: es simplemente el aire que respira la industria.

## La capa que quedó afuera

Hay una excepción visible: la capa que toca el usuario. El acortador de links, el CRM, el calendario, el gestor de proyectos, el chat del equipo. Esa última milla siguió propietaria, cerrada y con suscripción mensual.

La ironía es difícil de ignorar: esos productos están construidos enteramente sobre software libre — corren en Linux, guardan datos en Postgres, sirven tráfico con nginx — pero se venden como cajas negras. El SaaS moderno es open source por abajo y alquiler por arriba.

El resultado salta a la vista en cualquier presupuesto de IT: la infraestructura, que es lo técnicamente difícil, es gratis. Las herramientas de oficina, que son lo técnicamente simple, cuestan decenas de dólares por usuario por mes. El mapa de precios del software quedó exactamente al revés.

No es un accidente técnico. La infraestructura se liberó porque los ingenieros la construían para sí mismos, y compartir era una ventaja competitiva. La capa de aplicación quedó capturada porque ahí estaba el modelo de negocio: el usuario final no audita código, paga suscripciones.

## La última milla

Eso es lo que venimos a cerrar. Las herramientas de trabajo — las que usa todos los días alguien que no programa — son la última milla del software libre.

Empezamos por **Link**: short links con alias custom, analytics sin cookies, QR en SVG y PNG, links con password y expiración, y una API pública v1. Ya está disponible, el código es abierto y la nube se cobra al costo. Después vienen Track (Q4 2026), CRM (Q1 2027) y Cal (Q2 2027), con el mismo contrato: self-host a $0 o cloud al costo, sin margen.

El software libre no necesita que lo descubran. Necesita que lo terminen. La infraestructura ya es libre; falta liberar lo que toca la gente.

> La última milla del open source no corre en un datacenter. Corre en tu pestaña del navegador.
