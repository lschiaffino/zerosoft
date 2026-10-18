---
title: "Cuando un flow falla: reintentos, ramas de error y re-ejecución"
description: "Qué errores conviene reintentar, cuándo seguir y cuándo frenar, cómo armar un flow de error que te avise y cómo re-ejecutar desde el paso que falló sin repetir los anteriores."
date: "2026-10-18"
author: "zerosoft"
tags: ["flow", "automatización", "errores"]
---

Una automatización que nunca falla es una automatización que todavía no corrió lo suficiente. La API de afuera se cae diez minutos, alguien borra el proyecto de Track que un flow usaba, un formulario llega sin email. La pregunta útil es qué pasa después: si te enterás, si se arregla solo y si podés terminar el trabajo sin repetir lo que ya salió bien.

n8n resolvió parte de esto con su [error workflow](https://docs.n8n.io/flow-logic/error-handling/): un flujo aparte, con un nodo Error Trigger, que corre cuando otro falla. Es una buena idea y Flow tiene algo equivalente. Pero el flow de error es la última línea. Antes hay tres decisiones por nodo que evitan la mayoría de las alertas.

## Primero, separá los errores en dos tipos

**Transitorios.** El servicio no contestó a tiempo, la red falló, la API devolvió un 500 o un 429 (te pidió que esperes). Si volvés a intentar en un rato, probablemente funcione.

**Permanentes.** Falta un dato, la credencial está vencida, el email no es válido, la API devolvió un 400 o un 404. Reintentar diez veces da diez veces el mismo error.

Flow ya hace esta separación por vos. Un reintento solo se dispara con timeouts, errores de red, respuestas 5xx, 429 y límites de la IA. Un 404 no se reintenta aunque le pongas cinco intentos, porque no tiene sentido.

## Decisión 1: cuántos reintentos

Cada nodo que habla con afuera tiene "Reintentos si falla" en Avanzado, de 0 a 5. La espera se duplica en cada intento: 15 segundos, 30, 60, y así hasta un tope de una hora entre intentos.

Una guía práctica:

- **Request HTTP a una API que no controlás:** 2 o 3.
- **Slack, Sheets, Notion, Discord, Telegram:** vienen con 1 por defecto. Alcanza.
- **Cualquier cosa que no sea idempotente** (más abajo): 0, salvo que sepas que el servicio deduplica.

Un detalle honesto: en zerosoft Cloud el programador pasa una vez por hora, así que cada reintento se retoma en la próxima pasada y no a los 15 segundos. En self-host sigue la frecuencia de tu cron. Dentro de un Loop es distinto: ahí no se agenda nada, se reintenta en el momento, hasta 3 veces con esperas cortas y un presupuesto total de 30 segundos.

## Decisión 2: qué hace el nodo si igual falla

Después de los reintentos, cada nodo tiene la opción "Si este paso falla" con tres modos:

**Detener el flow.** Es el default. La corrida queda fallida en ese nodo. Usalo cuando los pasos siguientes dependen de este: si no se creó el contacto, no tiene sentido inscribirlo en una secuencia.

**Continuar.** El paso queda marcado como fallido y el flow sigue por la salida normal. La salida del nodo trae `error` y `failed: true`, para que un paso posterior lo pueda leer. Sirve para lo accesorio: si el aviso a Discord falla, el issue en Track igual tiene que crearse.

**Usar la rama de error.** Al nodo le aparece una salida Error y conectás ahí lo que tiene que pasar. El mensaje queda en `{{nodes.<id>.output.error}}`. Es el modo para un plan B: si la API principal falla, mandá los datos a una planilla para cargarlos a mano después.

Un ejemplo con los tres:

```
Webhook → CRM: crear contacto           (Detener: sin contacto no hay nada que hacer)
        → Request HTTP a tu facturador  (Rama de error → fila en Google Sheets "pendientes")
        → Slack #ventas                 (Continuar: el aviso es lo de menos)
```

## Decisión 3: un flow de error para todo lo demás

Lo que queda sin manejar termina en una corrida fallida. Para enterarte sin abrir el historial todos los días, configurá un flow de error. En el editor, elegí otro flow de tu workspace en "Flow de error". Cuando una corrida falla, ese flow corre con estos datos:

- `{{trigger.flow.name}}`: qué flow falló.
- `{{trigger.run.error}}`: el error, con el id del nodo adelante.
- `{{trigger.failedNode.id}}` y `{{trigger.failedNode.type}}`: dónde.
- `{{trigger.trigger}}`: lo que había disparado la corrida original.

Un flow de error mínimo tiene un solo nodo de Slack:

```
Falló "{{trigger.flow.name}}": {{trigger.run.error}}
Nodo: {{trigger.failedNode.id}} ({{trigger.failedNode.type}})
```

Un mismo flow de error puede servir a todos tus flows. Las credenciales que se usaron en la corrida llegan ocultas, así no terminan en un canal de Slack. Y un flow de error que falla no dispara otro flow de error, así no hay cadenas infinitas.

## Re-ejecutar desde el paso que falló

Recibiste la alerta, encontraste el problema (el proyecto de Track que el nodo usaba ya no existe) y lo corregiste en el editor. Falta terminar la corrida que quedó a mitad de camino.

En el historial de corridas, abrí la que falló y tocá **Re-ejecutar desde acá** en el nodo que falló. Flow crea una corrida nueva que:

- reusa la salida de todos los pasos anteriores, sin volver a ejecutarlos;
- corre ese nodo y todo lo que sigue con la versión guardada del flow, incluida tu corrección.

Así el contacto no se crea dos veces y el email de bienvenida no sale de nuevo. Funciona sobre corridas fallidas y exitosas. Dos límites: no podés re-ejecutar desde el disparador, y los pasos dentro de un Loop se re-ejecutan desde el Loop entero.

Si la corrección resultó peor que el problema, la pestaña Versiones guarda una versión cada vez que cambian los nodos (hasta 50) y muestra qué nodos se agregaron, quitaron o editaron. Restaurar una versión guarda la actual antes, por si acaso.

## Idempotencia: la pregunta antes de cada reintento

Reintentar es seguro solo si hacer lo mismo dos veces da el mismo resultado. Así se comportan los nodos de Flow:

- **CRM: crear contacto** busca primero por email. Si ya existe, devuelve el existente y no crea otro.
- **Stripe** manda una clave de idempotencia por corrida y por nodo, así un reintento de la misma corrida no crea dos clientes.
- **Request HTTP** depende de la API del otro lado. Un `POST` que crea una factura, reintentado después de un timeout, puede crear dos. Si la API acepta un header de idempotencia, mandalo con `{{run.id}}`. Si no, dejá los reintentos en 0 y usá la rama de error.
- **Enviar email** no tiene forma de saber si ya mandó. Un reintento es otro email.

## Topes que conviene conocer

Para que un error no se convierta en otro más grande, cada corrida tiene límites: 200 pasos (hasta 1.000 si hay Loops, que reservan lo que necesitan antes de empezar), 100 elementos por Loop y 1.000 corridas por hora por workspace. Un Loop que no entra en el tope falla antes de procesar el primer elemento, en lugar de quedar a la mitad con efectos parciales.

## Una rutina de diez minutos por semana

1. Abrí la lista de flows, mirá el estado de la última corrida de cada uno y entrá al historial de los que fallaron.
2. Para cada error permanente, corregí el nodo y re-ejecutá desde ahí.
3. Para cada error transitorio que se repite, subí los reintentos o pasá ese nodo a rama de error.
4. Si un aviso del flow de error te llegó más de tres veces por lo mismo, ese aviso es un arreglo pendiente.

Si todavía estás eligiendo qué automatizar, empezá por [cinco flows para un equipo chico](/blog/que-automatizar-primero).
