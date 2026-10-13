---
title: "Cuánto cuesta correr un acortador de links"
description: "La cuenta completa de cómputo, base de datos, ancho de banda y backups para servir 100.000 clics por mes con la arquitectura de Link. Da menos de un dólar."
date: "2026-07-09"
author: "zerosoft"
tags: ["link", "costos", "nube"]
---

El plan pago básico de Bitly cuesta $35 por mes: redirects, un contador de clics, gráficos y códigos QR. Hicimos la cuenta de lo que cuesta servir eso con la arquitectura real de Link.

## Qué es un redirect

Llega un pedido a `tudominio/launch`. El servidor hace un `SELECT`, escribe un `INSERT` con el clic y devuelve unos 300 bytes con un header `Location`. No hay video, imágenes ni cómputo pesado.

## La cuenta

Un usuario intenso: 50 links activos y 100.000 clics por mes.

- **Cómputo.** 100.000 pedidos por mes son unos 2,3 por minuto. Un VPS de $5 (1 vCPU, 1 GB de RAM) atiende cientos por segundo de este tipo. Usás menos del 2% de la máquina: **$0,10 por mes**.
- **Base de datos.** SQLite en el mismo VPS. 100.000 clics son unos 20 MB por mes, 240 MB por año. El disco de 25 GB alcanza para años: **$0**.
- **Ancho de banda.** Menos de 100 MB por mes, con 1 TB incluido: **$0**.
- **Backups.** Un snapshot semanal: **unos $0,50 por mes**.

**Total: menos de $1 por mes.** Con 10.000 clics, menos de $0,20.

## Qué pagan los $35

No infraestructura. Pagan un dominio corto lindo (el tuyo cuesta unos $10 por año), un equipo de ventas y margen.

## Link

Link es open source: lo corrés en ese VPS de $5 por $0 de licencia. Si preferís que lo corramos nosotros, zerosoft Cloud tiene un plan gratis y después cobra por clic y por almacenamiento, sin cargo por asiento.
