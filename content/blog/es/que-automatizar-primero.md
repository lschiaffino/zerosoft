---
title: "Qué automatizar primero: cinco flows para un equipo chico"
description: "Una regla para elegir qué automatizar y cinco flows concretos que se arman en Flow con plantillas: leads, reservas, deals, bugs del chat y cobros."
date: "2026-10-18"
author: "zerosoft"
tags: ["flow", "automatización", "guía"]
---

Las listas de "cosas para automatizar hoy" tienen un problema: te dan ideas, pero no te dicen cuál conviene primero. Y la primera automatización importa, porque es la que decide si el equipo confía en las siguientes.

Este post tiene dos partes. Primero, una regla corta para elegir. Después, cinco flows que se arman en Flow en pocos minutos, cada uno con su disparador, sus pasos y el detalle que suele romperse.

## La regla: frecuencia por costo de olvidarse

Antes de abrir el editor, anotá cada tarea repetitiva que hace el equipo y poné dos números al lado:

- **Cuántas veces por semana pasa.** Un lead nuevo puede pasar treinta veces. Un cierre de mes, una.
- **Cuánto cuesta que alguien se olvide.** Un lead que nadie llama en dos días se enfría. Una fila que falta en una planilla interna, casi nada.

Multiplicá. Lo que queda arriba es lo primero. Sumá dos filtros:

1. **Que la regla se pueda escribir en una frase.** "Cada formulario crea un contacto y avisa en #ventas" se automatiza. "Responder a los clientes enojados con el tono justo" todavía necesita a una persona.
2. **Que un error se pueda deshacer.** Un mensaje de Slack duplicado molesta. Un cobro duplicado es un problema. Empezá por lo reversible.

Con esa lista ordenada, estos son los cinco flows que más seguido quedan arriba en un equipo chico.

## 1. Lead de formulario: contacto en el CRM y aviso en Slack

**Disparador:** el evento `form.submitted` del CRM.
**Pasos:** "CRM: crear contacto" con el email y el nombre del envío, y después un mensaje de Slack.

La plantilla "Lead de formulario → CRM + Slack" ya lo trae armado. El texto del aviso usa los datos del evento:

```
Nuevo lead de {{trigger.form.name}}: {{trigger.submission.values.email}} ({{trigger.utm.utm_source | default:direct}})
```

El filtro `default:direct` evita el mensaje con un hueco cuando el lead no trae UTMs. Si tus UTMs siguen una convención, este aviso ya te dice de qué campaña vino (escribimos una en [UTMs sin planilla](/blog/utms-sin-planilla)).

**El detalle que se rompe:** formularios con spam. Agregá un nodo Filtro antes del contacto, con la condición de que el email exista y no contenga el dominio que te manda basura. Si el filtro no se cumple, la rama se corta y el contacto no se crea.

## 2. Reserva nueva: tarea para preparar la reunión

**Disparador:** `booking.created` de Cal.
**Paso:** "Track: crear issue" en el proyecto que elijas.

La plantilla "Nueva reserva en Cal → tarea en Track" arma el título con el tipo de evento y el nombre del invitado. En castellano quedaría así:

```
Preparar: {{trigger.eventType.title}} con {{trigger.invitee.name}}
```

Y en la descripción, el email del invitado y la hora. Si preferís una planilla, la plantilla "Nueva reserva → fila en Google Sheets" agrega una fila por reserva con fecha, nombre, email y evento.

**El detalle que se rompe:** las reservas canceladas. Armá un segundo flow con `booking.cancelled` que avise, o la tarea queda viva para una reunión que ya no existe.

## 3. Resumen diario de deals nuevos

**Disparador:** Programado, todos los días a las 09:00, en tu zona horaria.
**Pasos:** "CRM: deals recientes" (últimas 24 horas), un Filtro que sigue solo si hay al menos uno, y un email.

El cuerpo del email lista los nombres con dos filtros encadenados:

```
{{nodes.deals.output.deals | map:name | lines}}
```

El Filtro del medio importa más de lo que parece: un resumen que llega vacío cinco días seguidos enseña a ignorarlo.

**El detalle que se rompe:** la hora, menos que antes. En zerosoft Cloud el programador revisa cada minuto, así que un flow de las 09:00 arranca alrededor de un minuto después de las 09:00. Si tenés self-host, sigue la frecuencia con que llames a `/api/cron/minute` o `/api/cron/tick`: con el tick una vez por hora, un flow puede arrancar hasta una hora tarde. Para un resumen diario cualquiera de los dos alcanza. Para algo que tiene que salir en un segundo exacto, Flow no está pensado.

## 4. Bug reportado en el chat: issue en Track

**Disparador:** `message.received` de Chat.
**Pasos:** "AI: generar texto" que clasifica el mensaje, un nodo Si, y "Track: crear issue" en la rama verdadera.

La instrucción del paso de IA es corta a propósito. Algo así:

```
Respondé solo "bug" si el mensaje reporta un bug o un error. Si no, respondé "other".
```

Con un tope de 10 tokens, la salida es una palabra y el Si la compara con `contains`. La plantilla "Bug reportado en el chat → issue en Track" lo trae listo.

**El detalle que se rompe:** confiar a ciegas en la clasificación. Durante las primeras semanas, mirá el historial de corridas: cada ejecución guarda qué entró y qué salió de cada nodo, así ves qué mensajes la IA marcó como bug y cuáles no. Ese paso usa tu cuota de IA.

## 5. Deal ganado: cliente en Stripe

**Disparador:** `deal.won` del CRM.
**Paso:** el nodo de Stripe con la operación "crear cliente".

La plantilla "Deal ganado → cliente en Stripe" completa el nombre y una descripción con el monto. Necesitás una credencial de Stripe, que se guarda cifrada y se oculta en los logs de cada corrida.

**El detalle que se rompe:** el duplicado. Es el único de los cinco que toca plata, y por la regla del principio debería ser el último que actives. Flow manda a Stripe una clave de idempotencia por corrida y por nodo, así un reintento de la misma corrida no crea dos clientes. Si alguien marca el deal como ganado dos veces, son dos corridas distintas: agregá un Filtro o revisá en Stripe antes de confiar del todo.

## Cuánto te cuesta cada uno

En Zapier cada acción que se ejecuta es una tarea. El plan Team empieza en [$103,50 por mes con 2.000 tareas](https://zapier.com/pricing). Como ejemplo: con 30 formularios por día, el flow 1 hace dos acciones por envío, unas 1.800 tareas al mes. Con eso solo ya estás cerca del techo, y faltan los otros cuatro.

Flow en tu servidor no cobra por tarea. Hay topes para que un loop mal armado no tumbe nada: 1.000 corridas por hora por workspace, 200 pasos por corrida y 300 emails por día desde el nodo Enviar email, todos configurables en self-host.

## Lo que Flow todavía no tiene

Fuera de las apps de zerosoft, Flow trae nodos para Slack, Google Sheets, Gmail, Stripe, Notion, Discord y Telegram. Para el resto hay un nodo de request HTTP a cualquier API pública por HTTPS y un webhook entrante con URL secreta. Si la herramienta que usás no tiene API, Flow no la alcanza. Tampoco hay importador de zaps: cada flow se arma de nuevo, y con las plantillas lleva minutos.

## Por dónde empezar

Hacé la lista de frecuencia por costo, elegí lo que quede arriba y abrí Flow desde una plantilla. Probalo con el botón Probar y datos reales, mirá la salida de cada nodo y recién ahí prendelo. Cuando algo falle, y en algún momento algo va a fallar, el siguiente paso es [qué hacer cuando un flow falla](/blog/cuando-un-flow-falla).
