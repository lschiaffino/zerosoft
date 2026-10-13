---
title: "Exportar tus datos: un test de diez minutos para cualquier SaaS"
description: "Cuatro condiciones para que una exportación sirva de verdad (completa, abierta, sin intermediarios y verificable) y cómo las cumple cada app de zerosoft hoy."
date: "2026-06-15"
author: "zerosoft"
tags: ["export", "lock-in", "open source", "link"]
---

Casi nadie pregunta antes de contratar un SaaS cómo se va a ir. El botón de exportar existe en casi todos lados; la pregunta es qué sale y en qué estado. Proponemos un test de diez minutos para hacerlo antes de firmar.

## El test

¿Podés llevarte todo, en un formato abierto, sin hablar con nadie, y reconstruir tu operación en otro lado el mismo día? Cuatro condiciones:

- **Completo.** Lo que cargaste y lo que se generó. Si te llevás los links pero no los clics, falta la mitad.
- **Abierto.** JSON o CSV, formatos que lee cualquier herramienta.
- **Sin intermediarios.** Un botón o una API. Sin tickets de soporte ni esperas.
- **Verificable.** Lo probás el primer día con datos de prueba, antes de migrar nada.

## Cómo exporta zerosoft hoy

- **Link**: todos los links en CSV, o links y cada clic (referrer, país, dispositivo) en JSON. El log de clics de cada link también baja en CSV. Y la API v1 expone links y estadísticas.
- **CRM**: contactos, empresas y deals en CSV o JSON desde Configuración, más una API REST para todo el modelo.
- **Cal**: tipos de evento y reservas por API.
- **Self-host**: la base de datos completa es un archivo SQLite. Lo copiás y tenés todo.

Lo que todavía no pasa el test: Docs no exporta a Markdown ni PDF (solo copiar el contenido de una página), y Track no tiene API pública. Están en la lista.

## Lo que pasa afuera

- **Slack**: en el plan gratuito, la exportación cubre los canales públicos. Los mensajes directos y los canales privados quedan afuera.
- **Notion**: las bases de datos salen como CSV planos. Las relaciones y los rollups no viajan.
- Algunas herramientas no tienen exportación y te mandan a soporte.

Una exportación completa es un cliente que se puede ir. Por eso no siempre la hay.

## La regla

Cada app nueva de zerosoft tiene que pasar este test o decir públicamente qué le falta. Y como el código es abierto, la salida de último recurso siempre existe: tu propio servidor y una tarde.
