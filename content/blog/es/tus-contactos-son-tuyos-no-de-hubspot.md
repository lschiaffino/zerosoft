---
title: "Precio por contacto: por qué tu factura de HubSpot crece con tu base"
description: "HubSpot cobra más a medida que juntás contactos, aunque guardar uno cuesta unos cientos de bytes. Qué se lleva un CSV de exportación, qué no, y cómo lo resolvimos en el CRM de zerosoft."
date: "2026-06-19"
author: "zerosoft"
tags: ["crm", "hubspot", "lock-in", "open source"]
---

Si tu empresa va bien, tu factura de HubSpot probablemente subió. El motivo suele ser que juntaste más contactos, no que uses más funciones. Este post explica por qué pasa y qué conviene revisar antes de depender de un CRM.

## Cuánto ocupa un contacto

Un contacto es una fila: nombre, email, teléfono, empresa y algunas fechas. Unos cientos de bytes. Cien mil contactos ocupan unos 50 MB. Un VPS de $5 trae 25 GB de disco.

Marketing Hub Professional arranca en unos $890 por mes e incluye 2.000 contactos de marketing. Los que pasan de ahí se compran en bloques. La factura queda atada al tamaño de tu propia base.

## Lo que no se lleva el CSV

HubSpot te deja exportar un CSV con nombres y emails. Lo que suele quedar afuera:

- **El historial**: qué emails abrió cada contacto, qué páginas visitó, de qué campaña vino.
- **Las asociaciones**: a qué empresa pertenece, en qué deals estuvo, qué tickets abrió.
- **Los workflows**: secuencias y automatizaciones que hay que reconstruir a mano del otro lado.

Una prueba útil: ¿podés irte llevándote todo, no solo la lista? Si la respuesta es no, conviene saberlo antes de cargar diez años de relación con clientes.

## Cómo lo resolvimos en el CRM

- **API pública** para contactos, empresas, deals, actividades, tareas, pipelines, productos, cotizaciones y tags.
- **Exportación** de contactos, empresas y deals en CSV o JSON, desde Configuración.
- **Contactos sin cargo extra.** En tu servidor no hay límite. En zerosoft Cloud se cobra por uso (emails, almacenamiento), no por contacto ni por asiento.
- **Importación desde HubSpot** con un preset de columnas para su exportación. La guía está en [cómo sacar tus contactos de HubSpot](/blog/migrar-contactos-de-hubspot-por-csv).

El código es abierto (AGPLv3). Si un día no te sirve, la base de datos es un archivo SQLite en tu servidor.
