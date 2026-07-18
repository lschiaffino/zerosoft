---
title: "Tus contactos son tuyos, no de HubSpot"
description: "HubSpot te cobra más cuanto más crece tu base de contactos. Pero un contacto es una fila que cuesta bytes guardar. Tus contactos son tuyos, e irte debería llevar minutos, no un proyecto de migración."
date: "2026-06-19"
author: "Zerosoftware"
tags: ["crm", "hubspot", "lock-in", "open source"]
---

Mirá tu factura de HubSpot. Si tu empresa va bien, subió. No porque uses más funciones: porque juntaste más contactos. Hiciste bien tu trabajo — más gente te conoce, más gente te dejó su email — y el premio es pagar más por mes. Es el único negocio donde tener más clientes propios te sale más caro.

## El impuesto al contacto

Un contacto es una fila en una tabla: nombre, email, teléfono, empresa, algunas fechas. Unos cientos de bytes. Cien mil contactos son ~50 MB de disco. Un VPS de $5 trae 25 GB: te entran las bases de quinientas empresas.

Ahora mirá la página de precios: Marketing Hub Professional arranca en ~$890 por mes e incluye 2.000 marketing contacts. ¿Te pasaste? Los contactos extra se compran en bloques pagos. Tu factura está indexada al tamaño de tu propia base. No pagás por tecnología: pagás alquiler por tus propios datos, y el alquiler sube cada vez que tu negocio va bien.

> Cuando tu factura crece con tus contactos, no estás pagando software. Estás pagando peaje por hablar con tu propia gente.

## El verdadero lock-in no es el CSV

Sí, HubSpot te deja exportar un CSV con nombres y emails. Eso no es libertad: es una cortesía. Lo que el CSV no se lleva es la memoria:

- **El historial**: qué emails abrió cada contacto, qué páginas visitó, por qué campaña llegó. La línea de tiempo completa de la relación.
- **Las asociaciones**: qué contacto pertenece a qué empresa, en qué deals estuvo, qué tickets abrió.
- **Los workflows**: las secuencias, los nurtures, las automatizaciones que construiste durante años. Eso no se exporta: se reconstruye, a mano, del otro lado.

Te podés ir, pero te vas sin memoria. El test honesto es este: ¿puedo irme en 10 minutos llevándome todo, no solo la lista? Si la respuesta es no, tus contactos no son tuyos. Son del CRM y vos los estás alquilando.

## Lo que estamos construyendo

Nuestro CRM llega en Q1 2027 y nace con las reglas que Link ya aplica hoy:

- **API-first**: la API pública sale documentada el día uno, como hicimos con la API v1 de Link. Todo lo que hace la interfaz, lo hace curl.
- **Export completo, siempre**: JSON, CSV o API. Todo, incluido el historial. Sin pedir permiso, sin ticket de soporte.
- **Contactos ilimitados**: porque un contacto es una fila y las filas no cuestan nada. Tu factura no crece cuando crecés vos.
- **El mismo contrato de siempre**: código abierto, self-host a $0 en tu VPS, o cloud hosteado al costo real de la infraestructura.

Mientras tanto, Link ya está live — short links, analytics sin cookies, QR, API documentada en /docs — y funciona con exactamente este principio: tus datos salen tan fácil como entran.

Los contactos son tuyos porque la relación es tuya. El CRM tiene que ser una herramienta que usás, no una bóveda que te cobra por mirar lo tuyo.
