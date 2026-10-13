---
title: "Por qué documentamos toda la API"
description: "La API v1 cubre links, CRM, Cal y Agents, con cada endpoint documentado en /docs y una spec OpenAPI. Qué se puede hacer con ella y por qué es la mejor garantía contra el lock-in."
date: "2026-05-27"
author: "zerosoft"
tags: ["api", "open source", "link"]
---

Una forma rápida de evaluar un producto es mirar su API. Si existe, está documentada y deja hacer lo mismo que la interfaz, podés automatizar, integrar y, si hace falta, irte. Si son tres endpoints escondidos y un "contactá a ventas", no.

Link nació con su API pública. Hoy la API v1 cubre también CRM, Cal y Agents.

## Qué cubre la API v1

Cada endpoint está documentado en [/docs](/docs), con ejemplos en curl, JavaScript, Python y Go, y hay una spec OpenAPI 3.1 para descargar.

- **Link**: crear (`POST /api/v1/links`, con slug, tags y UTM), listar, actualizar, borrar y leer estadísticas (`GET /api/v1/links/:id/stats`).
- **CRM**: contactos, empresas, deals, actividades, tareas, pipelines, productos, cotizaciones, asociaciones, tags, secuencias y formularios.
- **Cal**: tipos de evento y reservas (listar, crear, ver, cancelar).
- **Agents**: mandarle un mensaje a un agente desde tu app.

La autenticación es una clave personal en `Authorization: Bearer`, con scopes que elegís al crearla (por ejemplo `links:read` o `crm:write`). Cada clave admite 100 requests por minuto; si te pasás, la respuesta es un 429 con `Retry-After`. Los errores vuelven en JSON con códigos estables.

```bash
curl -X POST https://zerosoft.ai/api/v1/links \
  -H "Authorization: Bearer zs_..." \
  -H "Content-Type: application/json" \
  -d '{"url": "https://tuempresa.com/launch", "slug": "launch"}'
```

## Webhooks

Para enterarte de lo que pasa sin preguntar: `link.created`, `link.clicked`, `booking.*`, y eventos de contactos y deals del CRM, firmados con HMAC-SHA256 y con reintentos. El detalle está en [webhooks: firmar y verificar](/blog/webhooks-firmar-y-verificar).

## Por qué importa

1. **Podés automatizar tu salida.** Un script corto recorre tus links, baja las estadísticas y los recrea en otro lado, sin nuestra ayuda.
2. **Podés integrarte sin pedir permiso.** Si tu sistema habla HTTP, habla con zerosoft.
3. **El plan B ya existe.** El código es abierto. Si mañana dejamos de existir, tu script apunta a tu propio servidor con la misma API.

Lo que falta: Track, Docs, Chat, Flow, Robots, Notes y Board todavía no tienen endpoints públicos.
