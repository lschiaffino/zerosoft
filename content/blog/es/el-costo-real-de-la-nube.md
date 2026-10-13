---
title: "Cuánto cuesta la nube, con precios públicos"
description: "Un VPS cuesta $5 por mes, un GB de almacenamiento cuesta centavos y el tráfico viene incluido por terabyte. La tabla de precios y lo que alcanza para correr con ella."
date: "2026-06-10"
author: "zerosoft"
tags: ["costos", "nube", "transparencia"]
---

Los precios de la nube son públicos: cualquier proveedor publica cuánto cuesta un servidor, un GB de almacenamiento y un terabyte de tráfico. Casi nadie los suma al evaluar una herramienta SaaS. Acá va la cuenta.

## La tabla

| Recurso | Precio público típico |
| --- | --- |
| VPS (1 vCPU, 1 GB RAM, 25 GB de disco, 1 TB de transferencia) | $5/mes |
| Almacenamiento de objetos | ~$0,02 por GB/mes |
| Ancho de banda adicional | centavos por GB (con 1 TB incluido) |
| Dominio propio | ~$10/año |
| SQLite como base de datos | $0 |

Con eso corrés buena parte de las herramientas de una empresa chica: links, CRM, agenda, documentos. Para Link, un usuario intenso (100.000 clics por mes) cuesta menos de $1 por mes en infraestructura. El detalle está en [cuánto cuesta correr un acortador](/blog/cuanto-cuesta-correr-un-link-shortener).

## Qué cobra el SaaS

Las empresas de SaaS que cotizan en bolsa publican márgenes brutos de más del 70%. De cada $100 de suscripción, la mayor parte paga ventas, marketing, oficinas y crecimiento, no servidores.

Por producto:

- Un acortador de links cobra $35 por mes por algo que cuesta menos de $1 servir.
- Un CRM cobra unos $50 por usuario por guardar contactos en una tabla.
- Un gestor de proyectos cobra hasta $30 por usuario por mover tarjetas.

## Cómo cobramos nosotros

El core de zerosoft es open source y lo corrés por $0 con la tabla de arriba. En zerosoft Cloud, cada workspace tiene un plan gratis y después paga por uso: clics, reservas, emails y almacenamiento. Las unidades que cobramos son las mismas que nos cuestan a nosotros, así que podés compararlas con la tabla. Los asientos no se cobran.

Si un número no te cierra, la alternativa está siempre: el mismo código en tu servidor, con tu base de datos en un archivo.
