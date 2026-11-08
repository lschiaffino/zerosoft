---
title: "Qué hacer con un pedido de función que llega por el chat"
description: "Un método de cuatro pasos para responder pedidos de funciones sin prometer de más: etiquetar en Chat, vincular al issue de Track, contar clientes distintos y avisar cuando se resuelve."
date: "2026-11-08"
author: "zerosoft"
tags: ["chat", "track", "soporte", "playbook"]
---

Un cliente escribe "¿podrían agregar exportación a Excel?". Hay tres respuestas malas. "Lo anotamos" y olvidarlo. "Sale este mes" sin saberlo. O un pegado manual a un Slack que nadie vuelve a leer. Las tres dejan al cliente sin información y al equipo sin datos.

Intercom tiene un [post sobre cómo responder a pedidos de funciones](https://www.intercom.com/blog/the-right-way-to-respond-to-feature-requests) que vale la pena leer para el tono de la respuesta. Acá nos ocupamos de la otra mitad: qué pasa con el pedido después de contestarlo, en un equipo de dos a ocho personas que usa Chat para soporte y Track para el producto.

## Paso 1: respondé con lo que sabés, no con lo que esperás

La respuesta tiene que hacer tres cosas: confirmar que entendiste el problema de fondo, decir qué existe hoy y decir qué va a pasar con el pedido. Si no hay fecha, se dice que no hay fecha.

Una plantilla para cargar como respuesta guardada en **Chat → tu widget → Respuestas guardadas** (atajo `/pedido`):

> Gracias por escribirnos. Para asegurarme de que lo entiendo: querés [problema en las palabras del cliente]. Hoy eso se resuelve así: [alternativa actual, o "todavía no tiene solución dentro del producto"]. Dejé tu pedido registrado junto al de otras personas que lo piden. No tengo fecha, y apenas la haya te escribo por acá.

Dos cosas sobre esa plantilla. Primero, "apenas la haya te escribo" es una promesa que después hay que cumplir, así que el paso 4 existe para eso. Segundo, la pregunta de fondo importa más que la función: "exportación a Excel" puede significar que alguien necesita pasar datos al contador, y eso quizá ya se resuelve con un CSV.

Una respuesta guardada también puede ejecutar acciones al insertarse: cambiar el estado, asignar, posponer o sumar etiquetas. Configurá `/pedido` para que agregue la etiqueta `pedido-de-funcion` y deje la conversación en pendiente. Así la clasificación no depende de la memoria de quien responde.

## Paso 2: una nota interna con el contexto, no con la cita

En el compositor de Chat hay un interruptor Respuesta / Nota. Las notas son mensajes del equipo que el visitante nunca ve, y se puede mencionar a alguien con `@` para que le llegue una notificación.

Usalo para dejar lo que el issue necesitaría y el cliente no dijo:

- Qué intentaba lograr cuando se topó con el límite.
- Si es un cliente que paga o un prospecto (en la ficha del visitante, Chat puede crear el contacto en el CRM si tiene email, y registrar la conversación en su historial).
- Qué hace hoy como alternativa.

Con esos tres datos, quien prioriza no tiene que volver a preguntarle al cliente.

## Paso 3: vinculá la conversación a un issue de Track

En el panel de detalles de la conversación hay una sección **Track** con dos botones: **Crear issue** y **Vincular issue**.

- **Crear issue**: elegís el team, escribís un título y se crea el issue con un extracto de los últimos mensajes y el link a la conversación.
- **Vincular issue**: escribís el identificador de uno que ya existe, como `WEB-12`.

Siempre buscá primero. Si el pedido ya existe, vinculá en lugar de crear un duplicado. Cada vínculo queda guardado como un pedido de cliente del issue, con el nombre y el email del visitante, el último mensaje que escribió y el link de vuelta a la conversación. Varias conversaciones pueden colgar del mismo issue, y en el hilo queda una nota de sistema con el identificador (el visitante no la ve). Si el team de Track es privado, solo ves y vinculás los issues de teams a los que tenés acceso.

Para sacar un vínculo hay un botón de desvincular al lado del identificador. Eso borra el pedido y no toca el issue.

## Paso 4: contá clientes, no mensajes

Acá está la ventaja de tener Chat y Track en el mismo producto. En Track, el issue muestra los pedidos de cliente que tiene, y la sección **Customers** de la barra lateral agrupa los pedidos por cliente. Al listar issues podés ordenar por cantidad de clientes. El conteo cuenta clientes distintos (empresa, si no contacto, si no email o nombre), así que el mismo cliente que insiste cinco veces cuenta una vez, y diez personas distintas cuentan diez. Cada pedido se puede marcar como importante.

Tres reglas para decidir con esos datos:

1. **Un cliente distinto, un voto.** Cinco mensajes de la misma cuenta son un pedido urgente de esa cuenta y un voto en el conteo.
2. **Mirá quién pide, no solo cuántos.** Si quien pide es un cliente que paga y el resto son visitantes curiosos, la lista ordenada por cantidad miente un poco. Para eso existe la marca de importante.
3. **El pedido sin problema detrás se archiva.** Si tras dos conversaciones no sabés qué intentaba lograr cada cliente, el issue no está listo para entrar al ciclo.

## Paso 5: cerrá el círculo

Cuando el issue pasa a hecho, tenés la lista de conversaciones que lo pidieron. Hoy el aviso lo mandás vos: abrís cada conversación vinculada y escribís. No hay un envío automático a los clientes al cerrarse el issue, y por ahora preferimos decirlo antes que hacerte creer lo contrario.

Para que no se pierda, una rutina semanal de diez minutos alcanza:

1. En Track, mirá los issues que pasaron a hecho esa semana y abrí los que tienen pedidos de clientes.
2. Entrá a cada conversación de origen desde el link del pedido.
3. Respondé con una frase concreta: qué cambió y dónde está. Después resolvé la conversación.

La respuesta de cierre es la que convierte un pedido en confianza. Un cliente al que le avisaste que lo que pidió ya existe es un cliente que vuelve a pedir.

## Lo que todavía no está

Para ser precisos: no hay aviso automático a los clientes cuando el issue se resuelve, y los vínculos se crean a mano desde cada conversación. Para un equipo chico, el flujo de este post cabe en una tarde de configuración, y el costo es $0 si lo corrés en tu servidor, o el plan gratis de zerosoft Cloud si preferís no mantenerlo.
