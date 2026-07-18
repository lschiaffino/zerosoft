---
title: "Cuánto cuesta realmente correr un acortador de links (spoiler: centavos)"
description: "Bitly cobra $35 al mes. Nosotros hicimos la cuenta completa de lo que cuesta servir redirects y analytics. Los números, sin vergüenza."
date: "2026-07-09"
author: "Zerosoftware"
tags: ["link", "costos", "nube"]
---

Bitly cobra $35 por mes por su plan básico pago. Veamos qué comprás exactamente con esos $35: redirects (301/302), un contador de clicks, algunos gráficos, QR codes.

Ahora hagamos la cuenta de lo que eso cuesta servir de verdad. Con números reales, de la arquitectura real de Link, nuestro acortador.

## Qué es un redirect, técnicamente

Una request llega a `tudominio/launch`. El servidor hace un `SELECT` en una base de datos, escribe un `INSERT` con el click, y devuelve una respuesta de ~300 bytes con un header `Location`.

Eso es todo. Es probablemente la workload más liviana que existe en la web. No hay video, no hay imágenes, no hay cómputo. Es leer una fila y contestar.

## La cuenta, sin trampas

Supongamos un usuario intenso: 50 links activos, 100.000 clicks por mes.

- **Cómputo.** 100.000 requests mensuales son ~2.3 requests por minuto. Un VPS de $5/mes (1 vCPU, 1GB RAM) maneja cientos de requests por *segundo* para esto. Estás usando menos del 2% de la máquina. Costo real asignado: **$0,10/mes**.
- **Base de datos.** SQLite en el mismo VPS. 100.000 clicks son 100.000 filas chicas: ~20MB al mes. En un año, 240MB. El disco de 25GB del VPS te da para una década. Costo: **$0**.
- **Ancho de banda.** 300 bytes por redirect + la página de analytics que mirás vos. Menos de 100MB al mes. El VPS incluye 1TB. Costo: **$0**.
- **Backups.** Snapshot semanal: ~$0,50/mes.

**Total: menos de $1 por mes.** Y si tenés 10.000 clicks en vez de 100.000, menos de $0,20.

## Entonces, ¿qué son los $35?

No son infraestructura. Son:

- El dominio corto bonito (que también podés tener: cuestan $10/año).
- El equipo de ventas.
- El margen del 3.400%.

Cuando el precio de algo es 35 veces su costo, no estás comprando tecnología. Estás comprando la ausencia de alternativa. Hasta que hay alternativa.

## Nuestro compromiso

Con Link, el software es gratis y open source: descargalo y corrélo en ese VPS de $5, tuyo para siempre. Y si querés que lo corramos nosotros, con login y backups y uptime, pagás lo que la nube cuesta. Al costo. Con esta misma cuenta abierta.

Los bits son gratis. Ahora los precios también empiezan a serlo.
