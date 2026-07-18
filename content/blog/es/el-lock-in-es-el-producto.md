---
title: "El lock-in no es un efecto secundario del SaaS: es el producto"
description: "Export incompleto, formatos propietarios, integraciones que se rompen, precios que escalan con tu éxito. No son accidentes: son la estrategia."
date: "2026-06-16"
author: "Zerosoftware"
tags: ["lock-in", "saas", "open source"]
---

Cuando evaluás una herramienta SaaS, mirás las features, el precio de entrada y la interfaz. El proveedor, en cambio, mira otra cosa: cuánto te va a costar irte. Ese número — tu costo de salida — es el activo más valioso que tiene. El lock-in no es un efecto secundario del modelo. Es el modelo.

## Las cuatro tácticas de siempre

**1. El export incompleto.** El botón existe, así que técnicamente "podés llevarte tus datos". Lo que te llevás son los contactos. Lo que se queda: el historial de actividad, las notas, los archivos adjuntos, las automatizaciones que configuraste durante años. Te dan los ladrillos y se quedan con la casa.

**2. Formatos propietarios.** Tus datos salen en un formato que solo esa herramienta entiende — o en un CSV tan degradado que reconstruir las relaciones entre tablas te toma semanas. Técnicamente exportable, prácticamente inútil.

**3. Integraciones que se rompen.** Mientras estás adentro, todo se conecta con todo. El día que anunciás que te vas, descubrís que esas integraciones eran el pegamento de tu operación: el form del sitio, el sync con facturación, el webhook que dispara tu pipeline. Irse no cuesta la suscripción: cuesta rehacer media empresa.

**4. Precios que escalan con tu éxito.** El pricing por contacto, por asiento, por "registro" tiene una propiedad elegante y perversa: tu factura crece cuando tu negocio crece. Duplicaste tu base de clientes, duplicaste tu factura. Tu crecimiento es su modelo de revenue. No pagás por más software — el software es el mismo — pagás por haberte ido bien.

## Cómo detectarlo antes de firmar

No hace falta fe, hacen falta diez minutos de due diligence:

- **Exportá el día uno.** Creá datos de prueba y probá el export antes de migrar nada. Si lo que sale no alcanza para reconstruir tu operación, ya sabés lo que vale ese botón.
- **Mirá la curva de precios a 10x.** Calculá qué pagarías con diez veces tus usuarios, contactos o registros actuales. Si el número te incomoda hoy, te va a doler en dos años.
- **Leé los límites de la API.** Rate limits bajos y una API de juguete son una señal: no quieren que tus datos salgan por la puerta de servicio.
- **Preguntá por el formato.** ¿Documentan su modelo de datos? ¿Exportan en formatos abiertos (CSV, JSON, ICS, vCard) o solo en el suyo?

## La alternativa: ser dueño

La única defensa estructural contra el lock-in es la propiedad. Software cuyo código podés descargar, cuya base de datos está en tu servidor — o en una nube que se cobra al costo y de la que te podés ir en una tarde.

En Zerosoftware lo aplicamos así: todo el código es open source; si usás nuestra nube, pagás lo que la infraestructura cuesta, sin margen; y tus datos se exportan completos, en formatos abiertos, con un click. Si algún día hacemos las cosas mal, irte tiene que ser fácil. Quedarse debe ser una decisión, no una condena.
