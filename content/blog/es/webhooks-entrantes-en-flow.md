---
title: "Webhooks entrantes en Flow: recibir, proteger y responder"
description: "Cómo armar una URL que otros servicios llaman: método, autenticación por header, leer el cuerpo, responder con tu propio código de estado y qué límites tiene hoy."
date: "2026-10-23"
author: "zerosoft"
tags: ["flow", "webhooks", "automatización"]
---

Un webhook entrante es una URL que le das a otro servicio para que te avise cuando pasa algo: un formulario enviado, un pago, un push a un repositorio. Del otro lado queda un flow que arranca solo. Es el trigger más usado en cualquier herramienta de automatización y también el que más se arma mal, porque la URL queda pública en internet.

n8n lo resuelve con un nodo Webhook que tiene dos direcciones, una de prueba y una de producción, según la [documentación del nodo](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/). La de prueba solo escucha mientras estás mirando el editor. La de producción se registra al activar el flujo. Flow tiene una sola URL por trigger y la decisión de qué hacer con ella cae en cuatro ajustes. Acá van, con ejemplos para copiar.

## 1. Crear el trigger y copiar la URL

En Flow, creá un flow nuevo y elegí **Webhook entrante** como trigger. Guardá: recién ahí aparece la URL, con esta forma:

```
https://tu-dominio/api/flow/hooks/fh_xxxxxxxxxxxxxxxxxxxx
```

El token después de `fh_` es el secreto de ese nodo. Hay uno por trigger, y si borrás el nodo, el token se va con él. Tratalo como una contraseña: no lo pegues en un repositorio público ni en un ticket.

Una consecuencia práctica: con el flow apagado, la URL contesta 404. Es la misma respuesta que da un token que no existe, así que quien la prueba no sabe si el flow está pausado o si la URL es inventada.

## 2. Elegir qué métodos acepta

El campo **Acepta** tiene tres opciones: solo POST (el valor por defecto), solo GET, o GET y POST. Cualquier otro método recibe un 405.

- **POST** para casi todo: formularios, Stripe, GitHub, tu propio backend.
- **GET** para servicios que verifican la URL antes de empezar a mandar eventos, o para un botón en un email que dispara una acción.
- **GET y POST** cuando tenés los dos casos en la misma URL.

El cuerpo se interpreta según el `Content-Type`. Con `application/json` queda como objeto (y si el JSON está roto, el que llama recibe un 400 en vez de una corrida con basura). Con `application/x-www-form-urlencoded` queda como objeto de campos. Con cualquier otro tipo llega como texto. El tope es de 256 KB: más que eso recibe un 413.

## 3. Leer los datos en los pasos siguientes

Todo lo que llega queda disponible como plantilla en los nodos de después:

- `{{trigger.body}}` para el cuerpo, y por ejemplo `{{trigger.body.email}}` para un campo.
- `{{trigger.query}}` para los parámetros de la URL (`?origen=landing`).
- `{{trigger.headers}}` para los headers.
- `{{trigger.method}}` para saber si fue GET o POST.

Un ejemplo concreto: un formulario de tu sitio hace POST con `{"nombre": "Ana", "email": "ana@ejemplo.com"}`. Agregá un nodo **CRM: crear contacto** con el email `{{trigger.body.email}}`. Si ya existe un contacto con ese email, el nodo devuelve el existente en lugar de duplicarlo, así que reenviar el formulario no ensucia la base. Después sumá **CRM: inscribir en secuencia** para arrancar el seguimiento.

Para ver cómo quedó cada dato, abrí la corrida: el historial guarda la entrada y la salida de cada paso.

## 4. Cerrar la puerta con una credencial

Por defecto, quien tenga la URL puede llamarla. Si el servicio que te llama puede mandar un header, pedí autenticación en el campo **Pedir autenticación**. Hay dos formas:

- **API key en un header.** Creás una credencial con el nombre del header (por ejemplo `X-Api-Key`) y el valor. Cada request tiene que traerlo; si no, recibe 401.
- **Usuario y contraseña (Basic).** Para servicios que solo saben mandar `Authorization: Basic`.

La comparación del secreto es de tiempo constante, y el header con la clave no se pasa al flow, así que no queda guardado en el historial de corridas. Si borrás la credencial, la URL no se abre: queda cerrada hasta que elijas otra. Los intentos fallidos también cuentan contra el límite de la IP, lo que frena a quien prueba contraseñas.

Hoy Flow no valida firmas HMAC genéricas en este trigger. Para Stripe existe un trigger aparte que verifica la firma con el signing secret. Si necesitás verificar otra firma, la salida es un nodo de código que la calcule, o poner una API key en el header.

## 5. Responder con tu propio código de estado

Por defecto el webhook contesta 202 de inmediato y la corrida sigue por detrás. Sirve para casi todo: el servicio de afuera no se queda esperando.

Cuando necesitás que la respuesta dependa del resultado, cambiá **Responde** a **Con el paso Responder al webhook** y agregá ese nodo al final. Elegís el código de estado, el tipo de contenido (JSON, texto o HTML) y el cuerpo, que puede usar datos de los pasos anteriores. Un caso simple:

1. Webhook entrante recibe `{"email": "ana@ejemplo.com"}`.
2. Un nodo **CRM: crear contacto** crea o encuentra el contacto.
3. **Responder al webhook** devuelve 200 con un JSON de confirmación. Si agregás antes un nodo **Filtro** que corte la rama cuando `{{trigger.body.email}}` no existe, podés poner otro **Responder al webhook** en la rama de error con un 422.

Los límites reales: quien llama espera hasta 25 segundos. Si la corrida no respondió a tiempo, recibe un 202 y la corrida sigue. Si el flow falla, recibe un 500. La respuesta se entrega con un `Content-Security-Policy: sandbox`, para que un cuerpo HTML armado con datos de afuera no pueda ejecutar scripts en tu dominio.

Eso alcanza para verificaciones de endpoints, formularios que necesitan un código claro y APIs chicas. No alcanza para algo que tarde un minuto: para eso, contestá 202 y avisá por otro canal cuando termine.

## Límites que conviene conocer

- Cada token acepta 600 requests por minuto. Pasado eso, recibe un 429.
- Cada workspace tiene un tope de corridas por hora: 1000 por defecto, configurable en self-host con la variable `FLOW_RUNS_PER_HOUR`. Pasado el tope, el webhook contesta 429 y quien llama puede reintentar más tarde.
- Se descartan los headers `cookie`, `authorization` y los de infraestructura (`x-forwarded-*` y similares) antes de entregarlos al flow.
- Solo hay una URL por trigger: no existe una URL de prueba separada. Para probar sin tocar producción, armá un segundo flow con su propio trigger y apuntá el servicio de prueba a esa URL.

## Checklist antes de publicar la URL

1. Elegí el método mínimo que necesitás.
2. Si el servicio lo permite, pedí una API key en un header.
3. Probá con `curl` y mirá la corrida en el historial.
4. Armá un flow de errores para enterarte si algo se rompe (lo contamos en [Cuando un flow falla](/blog/cuando-un-flow-falla)).
5. Guardá la URL en un gestor de secretos, no en el chat del equipo.

Con self-host, todo esto corre en tu servidor y las corridas se guardan en tu base de datos.
