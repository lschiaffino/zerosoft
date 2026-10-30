---
title: "Aprobaciones humanas en un flow: pausar, preguntar y seguir"
description: "Cómo poner a una persona en medio de una automatización: el nodo Aprobación de Flow, qué pasa si nadie responde, cómo usar el comentario y un ejemplo completo con descuentos."
date: "2026-10-30"
author: "zerosoft"
tags: ["flow", "automatización", "aprobaciones"]
---

Algunas decisiones no se automatizan. Un reembolso grande, un descuento fuera de lista, un gasto que supera el tope del mes. Lo que sí se puede automatizar es todo lo que rodea a la decisión: juntar los datos, preguntarle a la persona correcta, esperar la respuesta y ejecutar lo que corresponda cuando llega.

A eso se le dice "humano en el medio". Zapier le dedicó una [guía entera](https://zapier.com/blog/human-in-the-loop-guide/) y un paso propio, y en n8n existe la operación [Send and Wait for Response](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.respondtochat/). Flow lo resuelve con un nodo, Aprobación. Esta guía explica cómo se comporta de verdad, incluidos los casos incómodos: nadie contesta, dos personas contestan a la vez, alguien abre el link sin querer.

## Qué hace el nodo

Aprobación pausa la corrida y manda un pedido por email a hasta 10 personas. Si elegís una credencial de Slack, también lo publica en un canal con dos botones. Cada destinatario recibe links firmados que abren una página donde puede aprobar o rechazar y dejar un comentario opcional.

El nodo tiene dos salidas, **Aprobado** y **Rechazado**. Conectás a cada una lo que debe pasar y listo, sin un nodo condicional en el medio.

Campos que vas a completar:

- **Quién aprueba:** emails separados por coma. Acepta variables, así que `{{trigger.manager_email}}` funciona.
- **Asunto y Qué hay que aprobar:** también aceptan variables. Acá va todo el contexto para decidir sin abrir otra pestaña.
- **Pedirla también en Slack:** opcional, con credencial y canal.
- **Tiempo límite y Si nadie responde**, en Avanzado.

## Cuenta la primera respuesta

Si mandás el pedido a tres personas, decide quien conteste primero. Las otras dos, al abrir su link, ven que el pedido ya se respondió. No hace falta que se pongan de acuerdo ni hay un modo "todos tienen que aprobar". Si tu regla es "dos firmas", encadená dos nodos Aprobación, cada uno con su grupo.

Esto simplifica el diseño: el pedido va a un grupo que puede decidir (por ejemplo, las tres personas de ventas con permiso para dar descuentos) y se resuelve cuando alguien lo toma.

## Un link abierto no es una decisión

Los links de aprobación llevan `?decision=approve` o `?decision=reject`. Podrías pensar que con abrirlos ya se decide, pero no: la página muestra la opción elegida y espera que confirmes con un botón. El motivo es práctico. Muchos servicios de correo y seguridad abren los links de los emails para escanearlos, y si un GET aprobara, un escáner aprobaría reembolsos por vos.

Lo mismo vale para Slack: los botones abren la página, no deciden por sí mismos.

## Qué pasa si nadie responde

Cada pedido nace con un vencimiento. Por defecto son 3 días, y podés ponerlo en horas o días. Al vencer, el nodo hace lo que configuraste en **Si nadie responde**:

- **Rechazar** (el valor por defecto): la corrida sigue por la salida Rechazado. Es lo prudente para dinero.
- **Aprobar:** sigue por Aprobado. Sirve para trámites de bajo riesgo donde el silencio significa "adelante", como una solicitud de acceso a una herramienta de prueba.
- **Fallar:** la corrida termina con error `approval_timeout`, y se aplica todo lo que ya sabés de [cuando un flow falla](/blog/cuando-un-flow-falla): flow de error, alerta, re-ejecución desde el nodo.

El vencimiento lo resuelve el worker de Flow, así que puede llegar un poco después de la hora exacta, según la frecuencia con que corra tu cron. Para plazos de horas, tenelo en cuenta. El email avisa la fecha de vencimiento al destinatario.

## Qué datos deja la decisión

Después del nodo, los pasos siguientes pueden leer:

- `{{nodes.<id>.output.approved}}`: verdadero o falso.
- `{{nodes.<id>.output.decision}}`: `approved` o `rejected`.
- `{{nodes.<id>.output.comment}}`: lo que escribió la persona (vacío si no escribió o si venció).
- `{{nodes.<id>.output.decidedAt}}`: cuándo se decidió.
- `{{nodes.<id>.output.timedOut}}`: verdadero si decidió el vencimiento y no una persona.

El comentario es la parte más útil. Un rechazo sin motivo genera tres mensajes de ida y vuelta. Un rechazo con motivo se puede reenviar tal cual a quien lo pidió.

## Ejemplo: descuentos que superan el 20%

El caso: alguien de ventas necesita ofrecer un descuento mayor al que está permitido, y el responsable comercial tiene que autorizarlo antes de que la cotización salga.

```
Webhook (descuento solicitado: deal, monto, porcentaje, motivo, email del vendedor)
  → Filtro: porcentaje > 20
  → Aprobación
      Quién aprueba:  comercial@tuempresa.com
      Asunto:         Descuento de {{trigger.percent}}% para {{trigger.deal}}
      Qué aprobar:    Pide: {{trigger.seller_email}}
                      Monto de lista: {{trigger.amount}}
                      Motivo: {{trigger.reason}}
      Tiempo límite:  1 día. Si nadie responde: rechazar.
  → [Aprobado]   Enviar email al vendedor: "Aprobado. {{nodes.aprobacion.output.comment}}"
  → [Rechazado]  Enviar email al vendedor: "No aprobado. Motivo: {{nodes.aprobacion.output.comment}}"
```

Si tus deals viven en el CRM de zerosoft, el disparador puede ser un evento del propio CRM, como `deal.updated`, en lugar de un webhook. El resto del flow no cambia.

## Límites que conviene conocer

- **No se puede usar dentro de un Loop.** Un pedido por elemento de una lista de cien sería cien emails, y el editor no te deja armarlo. Si necesitás aprobar un lote, juntá el resumen en un solo pedido antes del Loop.
- **Hasta 10 destinatarios** por nodo.
- **La corrida queda en espera** y al retomar sigue desde ese nodo con el contexto que tenía.
- **El pedido va por email o Slack.** Quien aprueba abre una página pública firmada; no necesita cuenta de zerosoft. Según la [documentación de Zapier](https://help.zapier.com/hc/en-us/articles/38733184458765/), el revisor entra a su cuenta de Zapier para decidir. Para aprobar con alguien externo (un cliente, un contador) conviene la primera forma.
- **No edita datos.** La persona decide y comenta, pero no modifica los campos del pedido. Si necesitás que corrija un monto, usá "Esperar hasta una llamada" y un formulario propio que retome la corrida.

## Cuándo no poner una aprobación

Cada aprobación agrega espera y le pide atención a una persona. Una regla para decidir:

1. Si el error se arregla fácil después (un tag mal puesto), no pidas permiso: actuá y avisá.
2. Si el error cuesta plata o confianza (un reembolso, un email a todos los clientes), pedí aprobación.
3. Si la misma persona aprueba el 100% de los pedidos durante un mes, el control no está filtrando nada. Convertilo en una regla automática.

## Cómo probarlo antes de dejarlo andando

Mandá el pedido a vos mismo, con un vencimiento de 15 minutos, y recorré los tres caminos: aprobar con comentario, rechazar, y dejarlo vencer. Fijá datos de prueba en el disparador para repetirlo sin volver a cargar nada. Después mirá el historial de la corrida y verificá que el paso quede como esperando, y luego como exitoso con la salida que esperabas.

Si recién empezás con Flow, [qué automatizar primero](/blog/que-automatizar-primero) te da cinco flujos para arrancar, y todos admiten sumarle una aprobación en el punto donde el riesgo lo pida.
