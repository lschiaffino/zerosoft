---
title: "La API REST v1 en la práctica: claves personales, curl y errores reales"
description: "Creá una key zs_, acortá links, sacá estadísticas de clicks y cargá contactos y deals desde un script. Cada ejemplo coincide con el código, incluido qué pasa cuando algo sale mal."
date: "2026-08-13"
author: "Zerosoftware"
tags: ["api", "desarrolladores", "tutorial"]
---

Ya escribimos sobre [por qué documentamos todas las APIs](/blog/apis-abiertas-por-que-documentamos-todo). Este es el lado práctico: un recorrido por la API REST v1 de Zerosoft con comandos `curl` para copiar y pegar, para Link y para el CRM, más los errores con los que te vas a cruzar de verdad.

Todo lo que sigue lo chequeamos contra los handlers de `app/api/v1`, no solo contra la página de docs. La URL base es `https://zerosoft.ai/api/v1` en Zerosoft Cloud, o `https://tu-host/api/v1` si hacés self-host.

## Conseguí una key

Andá a Dashboard → Settings → API keys, ponele un nombre a la key ("CI deploy", "reemplazo-de-zapier", lo que quieras) y creala.

Tres cosas que tenés que saber:

- **Se muestra una sola vez.** La key es `zs_` seguido de 32 caracteres aleatorios. Guardamos solo su hash SHA-256 y los primeros 10 caracteres como prefijo visible. Si la perdés, creás otra.
- **Actúa como el workspace.** Lo que crees por API cae en el mismo workspace que ves en el dashboard. Los admins ven todas las keys del workspace; los members, solo las que crearon ellos. La lista muestra cuándo se usó cada key por última vez, y revocar tiene efecto en la siguiente request.
- **100 requests por minuto, por key.** Más sobre eso abajo.

Guardala en una variable de entorno y olvidate:

```bash
export ZS_KEY="zs_..."
export ZS="https://zerosoft.ai/api/v1"
```

## Links

Creá un link corto. Solo `url` es obligatorio; `slug` (hasta 32 caracteres), `title`, `tags` (hasta 5) y `domain` (un dominio propio que hayas verificado) son opcionales.

```bash
curl -X POST "$ZS/links" \
  -H "Authorization: Bearer $ZS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/spring-launch", "slug": "spring", "tags": ["launch"]}'
```

Recibís un `201` con `id`, `slug`, `domain`, `short_url`, `url`, `title`, `tags` y `created_at`.

Listalos, paginados (`pageSize` llega hasta 50):

```bash
curl "$ZS/links?page=1&pageSize=50" -H "Authorization: Bearer $ZS_KEY"
```

La respuesta es `{ "links": [...], "total": n }`, archivados incluidos, cada uno con su conteo de clicks.

Clicks por día de los últimos 30 días:

```bash
curl "$ZS/links/LINK_ID/stats" -H "Authorization: Bearer $ZS_KEY"
# { "slug": "spring", "total": 312, "byDay": [{ "date": "...", "count": 41 }, ...] }
```

Con eso te armás un reporte semanal en un cron sin abrir nunca el dashboard.

## CRM: contactos

Buscá y paginá (`pageSize` hasta 100):

```bash
curl "$ZS/crm/contacts?q=ana&page=1&pageSize=25" -H "Authorization: Bearer $ZS_KEY"
```

Creá uno. Ojo: los bodies de las requests usan nombres de campo en **camelCase**, y las respuestas devuelven la fila guardada con columnas en **snake_case**:

```bash
curl -X POST "$ZS/crm/contacts" \
  -H "Authorization: Bearer $ZS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"firstName": "Ana", "lastName": "Garcia", "email": "ana@example.com", "lifecycleStage": "lead", "source": "event"}'
# 201 → { "id": "...", "first_name": "Ana", "last_name": "Garcia", "lifecycle_stage": "lead", ... }
```

Actualizá con `PATCH` — todos los campos son opcionales:

```bash
curl -X PATCH "$ZS/crm/contacts/CONTACT_ID" \
  -H "Authorization: Bearer $ZS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jobTitle": "Head of Ops", "city": "Montevideo"}'
```

Las empresas funcionan igual en `/crm/companies` y `/crm/companies/:id`.

## CRM: deals y tareas

Un deal necesita pipeline y etapa, así que pedilos primero:

```bash
curl "$ZS/crm/pipelines" -H "Authorization: Bearer $ZS_KEY"
```

Cada pipeline viene con sus etapas (`id`, `name`, `probability`, `isWon`, `isLost`). Después:

```bash
curl -X POST "$ZS/crm/deals" \
  -H "Authorization: Bearer $ZS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pipelineId": "PIPELINE_ID", "stageId": "STAGE_ID", "name": "Acme renewal", "amount": 4800, "currency": "USD", "contactIds": ["CONTACT_ID"]}'
```

`GET /crm/deals` lista los deals de `?pipelineId=…`, o los de tu primer pipeline si no lo pasás.

Las tareas cuelgan de contactos, empresas o deals:

```bash
curl -X POST "$ZS/crm/tasks" \
  -H "Authorization: Bearer $ZS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"subject": "Send renewal proposal", "dueAt": "2026-08-20 15:00", "dealId": "DEAL_ID"}'

curl "$ZS/crm/tasks?bucket=overdue" -H "Authorization: Bearer $ZS_KEY"
```

`bucket` acepta `overdue`, `today`, `upcoming` o `done`. Las fechas van como `YYYY-MM-DD`, opcionalmente con hora.

También hay endpoints de Cal (tipos de evento, reservas, cancelar) bajo `/calendar` — están en las [docs](/docs).

## Errores: una sola forma para todo

Todo error de v1 tiene el mismo body:

```json
{ "error": { "code": "slug_taken", "message": "That slug is already taken." } }
```

Decidí en base a `code`, mostrale `message` a los humanos. Los que te vas a encontrar:

| Status | Code | Cuándo |
| --- | --- | --- |
| 401 | `invalid_key` | Falta el header `Authorization: Bearer …`, o la key está mal o revocada. |
| 429 | `rate_limited` | Más de 100 requests en el minuto actual para esa key. |
| 400 | `invalid_url`, `invalid_slug`, `slug_taken`, `invalid_domain` | Problemas al crear el link. |
| 400 | `invalid_input`, `invalid_email`, `missing_name` | El body del CRM no validó. |
| 400 | `invalid_pipeline`, `invalid_stage` | El pipeline no existe, o la etapa no es de ese pipeline. |
| 404 | `not_found` | El registro no existe en tu workspace. |

## Sobre ese rate limit

El límite es una ventana fija de un minuto por key, contada en la base de datos (le dedicamos [un post entero](/blog/rate-limiting-en-la-base-de-datos)). Dos detalles que conviene saber:

- **Se cuenta antes de validar la key.** Probar keys a fuerza bruta gasta el mismo presupuesto. Además, las keys inválidas tienen un tope de 20 intentos por minuto por IP.
- **El 429 no trae header `Retry-After`.** Las ventanas se alinean al minuto del reloj, así que el cliente correcto más simple duerme hasta que arranca el minuto siguiente y reintenta.

```bash
# ingenuo pero correcto
until curl -fsS "$ZS/links" -H "Authorization: Bearer $ZS_KEY"; do sleep 15; done
```

Para importaciones masivas, mantenete bastante por debajo de 100 por minuto y nunca vas a ver un 429.

## Lo que (todavía) no está

Siendo honestos con los bordes: todavía no hay API para Track, Chat ni Docs, el CRM no emite eventos de webhook, y no hay OAuth para apps de terceros — las keys son personales. Si el dashboard puede hacer algo que la API no, eso es un hueco, no una decisión de diseño. Abrí un issue.
