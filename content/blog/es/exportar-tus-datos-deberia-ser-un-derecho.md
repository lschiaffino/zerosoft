---
title: "Exportar tus datos debería ser un derecho"
description: "La portabilidad no es una feature premium: es un derecho. Cada producto de Zerosoftware nace con export completo en JSON, CSV y API. Acá está el test para comprobarlo."
date: "2026-06-15"
author: "Zerosoftware"
tags: ["export", "lock-in", "open source", "link"]
---

Hay una pregunta que casi nadie hace antes de firmar con un SaaS: ¿cómo me voy? No si se puede — el botón de export existe en casi todos lados — sino qué sale por esa puerta y en qué estado. La mayoría de las veces la respuesta es: menos de lo que creés, en peor formato del que necesitás.

Nosotros lo planteamos al revés: exportar tus datos no es una cortesía del proveedor. Es un derecho, y el software debería nacer con él.

## El test de los diez minutos

La prueba es simple: ¿podés irte en diez minutos? No cancelar la suscripción — eso siempre es fácil, porque les conviene — sino llevarte todo, en un formato abierto, sin hablar con nadie, y reconstruir tu operación en otro lado el mismo día.

El test tiene cuatro partes:

- **Completo**: todo lo que entró y todo lo que se generó. Si exportás los links pero no las estadísticas de clicks, no es un export: es un souvenir.
- **Abierto**: JSON, CSV, formatos que existen hace décadas y que cualquier herramienta lee. Un archivo propietario es una caja fuerte con tu nombre y la llave de otro.
- **Sin intermediarios**: ningún ticket de soporte, ningún "contactá a tu account manager", ninguna espera de 48 horas. Un botón y una API.
- **Verificable**: podés probarlo el día uno, con datos de prueba, antes de migrar nada. Si un producto no pasa el test con datos falsos, no lo va a pasar con los tuyos.

## Cómo exporta Link hoy

Link, nuestro shortener, cumple el test completo:

- Desde el dashboard exportás todos tus links — alias, destino, password, expiración, max clicks, tags, UTM — en JSON o CSV, con un click.
- Las analytics viajan con ellos: cada click registrado, con fecha, referrer, país, device, browser y OS. Filas crudas, no solo los agregados bonitos del panel.
- La API v1 expone todo lo anterior por HTTP, con tu API key. Un script de veinte líneas baja tu cuenta entera. Sin pedirnos permiso.
- Y si corrés self-hosted, el export más brutal de todos: tu base de datos es un archivo SQLite. Lo copiás y ya está. Eso es portabilidad.

## Lo que pasa afuera

El mercado, mientras tanto:

- **Slack**: en el plan gratuito, el export cubre solo los canales públicos. Tus mensajes directos y tus canales privados no salen por la puerta común.
- **Notion**: exporta, sí. Las bases de datos salen como CSV planos: las relaciones entre tablas, los rollups, la estructura que le dio sentido a tu información — eso no viaja. Te llevás las filas; el modelo se queda.
- Y después está la táctica más honesta de todas: la de las herramientas que directamente no tienen export y te derivan a soporte, donde un humano decide cuándo — y si — recuperás tus datos.

Nada de esto es un accidente. Un export completo es un cliente que se puede ir.

## Nuestra regla: el export nace con el producto

En Zerosoftware la regla es una sola y no se negocia: ningún producto sale sin export completo desde el día uno. JSON y CSV desde la interfaz, API pública documentada, formatos abiertos. Link ya lo hace. El CRM, Cal y Track — todos coming soon — van a abrir con la misma garantía el día que salgan.

Y el código es open source: si algún día hacemos las cosas mal, no necesitás el export — necesitás un VPS de $5 y una tarde.

Tus datos son tuyos. El software que no lo entiende así te está avisando, de antemano, cuánto va a costar irte.
