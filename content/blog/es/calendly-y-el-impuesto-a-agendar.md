---
title: "Calendly cobra $12 por usuario. Qué hay detrás de una reserva"
description: "Una página de reservas es una página pública con tu disponibilidad y un formulario que escribe en tu calendario. Qué cuesta servir eso y qué hace Cal en su lugar."
date: "2026-06-18"
author: "zerosoft"
tags: ["cal", "agendar", "saas"]
---

Técnicamente, Calendly es una página pública con tu disponibilidad y un formulario que crea un evento en tu calendario. El plan Standard cuesta $12 por usuario por mes ($10 si pagás el año).

El producto está bien hecho. Lo que discutimos es el precio: una reserva es una fila en una base de datos, un par de llamadas a la API de Google Calendar y un email de confirmación. Centavos.

## La cuenta con un equipo

- Un equipo comercial de 10 personas: $120 por mes.
- Por año: $1.440.
- En cinco años: $7.200.

El plan gratis de Calendly tiene un solo tipo de evento y una sola conexión de calendario. Alcanza para probar y queda corto apenas lo usás en serio.

## Cómo se fija el precio

El precio no sale del costo. Sale del valor percibido: "si te consigue una reunión más por mes, se paga solo". Es el razonamiento de buena parte del SaaS: pagás lo que el proveedor estima que podés pagar.

## Cal

Cal es nuestra herramienta de agenda. Hoy tiene:

- **Páginas de reserva** con tu disponibilidad semanal, buffers, aviso mínimo y ventana de reservas.
- **Zona horaria del invitado**: cada uno ve los horarios en su hora.
- **Google Calendar**: lo ocupado bloquea horarios y cada reserva se crea con link de Meet.
- **Round-robin, formularios de ruteo y embed** en tu sitio.
- **Emails con .ics**, recordatorio 24 horas antes y reprogramación o cancelación desde el email.
- **API REST y webhooks** firmados.

Lo que todavía no tiene: Outlook o iCloud, cobros con Stripe, eventos grupales y horarios reutilizables entre tipos de evento.

Es open source y lo corrés por $0. En zerosoft Cloud, el workspace tiene un plan gratis y después paga por reserva; los asientos no se cobran. La comparación completa está en [Cal vs Calendly](/blog/zerosoft-cal-vs-calendly).
