---
title: "Lock-in: cuatro tácticas del SaaS y cómo detectarlas antes de firmar"
description: "Exportaciones incompletas, formatos propietarios, integraciones que se rompen y precios que crecen con tu base. Cómo reconocer cada una en diez minutos de prueba."
date: "2026-06-16"
author: "zerosoft"
tags: ["lock-in", "saas", "open source"]
---

Al evaluar una herramienta SaaS mirás funciones, precio de entrada e interfaz. Al proveedor le importa otro número: cuánto te va a costar irte. Estas son las cuatro formas más comunes de subir ese número y cómo detectarlas antes de firmar.

## Las cuatro tácticas

**1. Exportación incompleta.** El botón existe y te llevás los contactos. Se quedan el historial de actividad, las notas, los adjuntos y las automatizaciones.

**2. Formatos propietarios.** Los datos salen en un formato que solo esa herramienta entiende, o en un CSV que pierde las relaciones entre tablas. Reconstruirlas lleva semanas.

**3. Integraciones que se rompen.** El formulario del sitio, el sync con facturación, el webhook que alimenta tu pipeline. Mientras estás adentro, todo se conecta. Al irte, hay que rehacerlo.

**4. Precios que crecen con tu base.** Por contacto, por asiento, por registro. Duplicás clientes y se duplica la factura, con el mismo software.

## Cómo detectarlo

- **Exportá el primer día.** Cargá datos de prueba y exportalos antes de migrar nada. Si lo que sale no alcanza para reconstruir tu operación, ya sabés cuánto vale el botón.
- **Calculá el precio a 10x.** Lo que pagarías con diez veces tus usuarios o contactos.
- **Leé los límites de la API.** Un rate limit bajo y pocos endpoints indican que los datos no están pensados para salir.
- **Preguntá por el formato.** ¿Documentan el modelo de datos? ¿Exportan CSV, JSON, ICS, vCard?

## Qué hacemos en zerosoft

El código es open source: si nuestra nube no te sirve, lo corrés vos con tus datos. Un workspace self-hosteado es un archivo SQLite y una carpeta de adjuntos. Link exporta links y clics en CSV y el CRM exporta en CSV o JSON; todas las apps con API pública (Link, CRM, Cal) se pueden leer completas por REST.

Todavía hay huecos: Docs exporta de a una página (Markdown o PDF), sin un export de todo el espacio, y Track no tiene API pública. Están en la lista.
