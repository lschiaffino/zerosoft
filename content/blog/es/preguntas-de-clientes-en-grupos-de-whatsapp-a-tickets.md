---
title: "Preguntas de clientes en grupos de WhatsApp: cómo convertirlas en tickets con SLA"
description: "Un sistema de cuatro reglas para que ninguna pregunta se pierda en un grupo de WhatsApp con clientes: ticket por emoji o palabra clave, plazos de respuesta, marca de sin responder y aviso por email. Con los valores que usa Lines, la bandeja open source de zerosoft."
date: "2026-11-28"
author: "zerosoft"
tags: ["lines", "periskope", "whatsapp", "soporte"]
---

Muchos equipos chicos atienden clientes en grupos de WhatsApp: un grupo por cuenta, con el cliente adentro y dos o tres personas tuyas. Funciona hasta que el grupo tiene cuarenta mensajes por día y una pregunta del martes a las once queda enterrada bajo un audio, tres fotos y un "gracias". Nadie la ignoró a propósito. Simplemente nadie era el dueño.

Periskope, que vende una bandeja para WhatsApp, tiene [una nota sobre cómo manejar consultas de clientes en grupos de WhatsApp](https://periskope.app/blog/manage-customer-queries-on-whatsapp-groups) que propone marcar las consultas importantes y convertirlas en tickets y tareas. La idea es buena. Acá va nuestra versión: cuatro reglas que podés aplicar en una tarde, con los valores concretos que trae Lines, la bandeja de WhatsApp de zerosoft (licencia AGPL, self-host por $0 o zerosoft Cloud).

## Regla 1: toda pregunta tiene un ticket y un dueño

La unidad de trabajo es el ticket. Un ticket tiene estado (abierto, en curso, resuelto, cerrado), prioridad (baja, media, alta, urgente), persona asignada y vencimiento. Si una consulta no tiene ticket, depende de la memoria de alguien.

En Lines hay tres maneras de crearlo:

- **Desde el mensaje.** En el menú de cualquier mensaje del chat.
- **Con una reacción.** Reaccionar con 🎫 a un mensaje crea un ticket, un ticket por mensaje. Funciona desde Lines y también desde el teléfono, así que quien atiende desde el celular no tiene que abrir nada más. El emoji se puede cambiar en los ajustes, o dejar vacío para apagar la función.
- **Por palabra clave.** Si cargás palabras como "factura", "error" o "no funciona", un mensaje entrante que las contenga abre un ticket solo.

Empezá con el emoji y sin palabras clave. Las palabras clave generan tickets de más hasta que las afinás, y un equipo con la lista de tickets llena de ruido deja de mirarla.

## Regla 2: un plazo para cada prioridad

Un ticket sin plazo es una nota. Lines trae estos valores de partida, todos editables en Ajustes de Lines:

| Qué | Plazo por defecto |
|---|---|
| Primera respuesta | 60 minutos |
| Resolución, urgente | 4 horas (240 min) |
| Resolución, alta | 8 horas (480 min) |
| Resolución, media | 24 horas (1440 min) |
| Resolución, baja | 3 días (4320 min) |

La prioridad por defecto de un ticket nuevo es media. Antes de aceptar estos números, preguntate algo incómodo: ¿tu equipo puede cumplirlos de verdad? Un SLA de primera respuesta de 15 minutos que se rompe todos los días enseña a todos a ignorar los avisos. Es mejor arrancar con 60 minutos, cumplirlo durante un mes y bajarlo después.

## Regla 3: lo que no tiene ticket, igual no se puede quedar sin respuesta

No toda pregunta se marca con el emoji. Para eso está la marca de **sin responder**: si el último mensaje del cliente lleva más de cierto tiempo sin contestación (30 minutos por defecto), el chat queda marcado en la bandeja y lo podés filtrar con "sin responder".

Hay dos modos:

1. **Por tiempo.** Todo mensaje del cliente espera respuesta. Es simple, pero un "ok, gracias" activa la marca igual.
2. **Con IA.** Distingue preguntas y pedidos de comentarios sueltos. Podés escribirle reglas en texto, por ejemplo: "los agradecimientos no son preguntas, todo lo de facturación sí".

Dos detalles que importan en la práctica. Primero, lo que respondés desde el teléfono cuenta como respuesta: si alguien contesta desde WhatsApp en el celular, la marca se limpia. Segundo, crear un ticket desde el mensaje saca al chat de la lista de sin responder (se puede desactivar), porque a partir de ahí la pregunta ya tiene dueño y plazo.

Un ejemplo de regla de IA para un estudio contable: "Los mensajes con una foto de comprobante son pedidos. Las respuestas de una palabra (ok, listo, dale) no. Cualquier mención a un vencimiento es urgente". La IA solo marca, no contesta por vos, y conviene revisar la lista la primera semana para ajustar el texto.

## Regla 4: avisar cuando el plazo se rompe

Un plazo que nadie ve vencer no sirve. Lines puede mandar un email cuando un ticket pasa su tiempo de primera respuesta o de resolución. Se activa en los ajustes y podés elegir quién lo recibe: la persona asignada, los admins del workspace y hasta 10 direcciones extra, separadas por comas. Cada vencimiento avisa una sola vez, aunque el proceso que lo detecta corra dos veces. Además del email, el vencimiento dispara webhooks y se puede usar como disparador en Flow, por ejemplo para escribirle a un canal de Talk.

Una configuración razonable para cinco personas: aviso a la persona asignada y a una dirección de guardia compartida. Los admins reciben el aviso solo si lo activás, para no llenar bandejas.

## Cómo se ve en una semana real

Lunes: conectás la línea por QR y definís el emoji 🎫, la primera respuesta en 60 minutos y la marca de sin responder en 30. Durante la semana, quien lee un grupo reacciona con 🎫 a cada pedido real. Viernes: abrís la lista de tickets, filtrás los vencidos y mirás las métricas de tickets y de resolución. Con eso sabés qué grupos concentran los pedidos y quién está sobrecargado, y podés ajustar la asignación automática (rotativa entre quienes están en línea) antes de sumar a alguien.

## Qué todavía no está

Conviene decirlo claro. La conexión por QR usa Evolution API (en nuestro servidor, o en tu propio gateway WAHA o Evolution API), y varias funciones de la bandeja están probadas contra un proveedor simulado y todavía no con WhatsApp real. El estado de cada función está en la [lista pública de paridad](/es/products/lines) de la app. Las líneas de la API oficial (Cloud API) también están en esa categoría. Y como cualquier herramienta que usa WhatsApp por QR, depende de cómo trate WhatsApp esa conexión. Evaluá ese riesgo antes de poner en el centro de tu soporte un número que no podés reemplazar.

## Lo que ganás con la suite

Los tickets de Lines no viven aislados. Las tareas creadas desde un chat son tareas del CRM, con link de vuelta a la conversación, y los campos propios de un ticket sirven para filtros y para el export CSV. Si ya usás CRM, el cliente del grupo y sus negocios están a un clic. Y si hospedás zerosoft vos, los mensajes de tus clientes quedan en tu base de datos, no en la de un proveedor.

## Para empezar hoy

1. Elegí un solo grupo piloto, el más ruidoso.
2. Dejá 🎫 como emoji y primera respuesta en 60 minutos.
3. Activá la marca de sin responder, en modo por tiempo.
4. Activá el email de SLA solo para la persona asignada.
5. A los siete días, mirá cuántos tickets vencieron y por qué. Recién ahí tocá los plazos o prendé la IA.
