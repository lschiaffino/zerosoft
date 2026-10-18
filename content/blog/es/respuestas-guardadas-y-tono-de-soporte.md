---
title: "Respuestas guardadas: cinco reglas de tono y doce plantillas para soporte"
description: "Cómo convertir una guía de tono de soporte en reglas que se pueden chequear, y doce respuestas guardadas listas para Chat, con las acciones automáticas que conviene asociar a cada una."
date: "2026-10-18"
author: "zerosoft"
tags: ["chat", "soporte", "plantillas", "playbook"]
---

Las respuestas guardadas tienen mala fama porque muchas suenan a robot. Suenan así cuando nadie las revisó contra una idea clara de cómo quiere sonar el equipo.

Intercom publicó [PREACH](https://www.intercom.com/blog/preach-framework-for-customer-support-tone/), el marco de tono con el que su equipo de soporte revisa conversaciones: seis rasgos (orgulloso, responsable, empático, articulado, conciso, humano). Es una buena lista para una revisión entre pares. A las seis de la tarde, con treinta conversaciones abiertas, un adjetivo ayuda poco. Este post baja el tono a cinco reglas que se pueden chequear frase por frase y trae doce respuestas guardadas escritas con esas reglas, listas para cargar en Chat.

## Cinco reglas que se pueden chequear

1. **Decí el próximo paso y cuándo.** "Lo reviso y te escribo antes de las 17" se puede cumplir o no. "Lo estamos viendo" no se puede medir.
2. **Contá lo que hiciste.** "Probé con tu cuenta y reproduje el error" informa. "Entendemos tu frustración" no le agrega nada a nadie.
3. **Una pregunta por mensaje.** Si necesitás tres datos, pedilos en una lista numerada y explicá para qué sirven.
4. **Una disculpa, concreta.** "Perdón, el cobro duplicado fue un error nuestro" una vez. Tres "disculpá las molestias" seguidas suenan a guion.
5. **Prometé solo lo que controlás.** Si el arreglo depende de otro equipo, prometé el próximo aviso. La fecha del arreglo la da ese equipo.

Antes de guardar una respuesta, pasala por las cinco. Si falla una, reescribila.

## Cómo funcionan en Chat

- Cada widget tiene su lista de **respuestas guardadas**: nombre, atajo (sale del nombre) y texto.
- En una conversación, escribís `/` y parte del atajo o del nombre, elegís de la lista y el texto cae en la caja de respuesta. Lo podés editar antes de mandarlo.
- En **Acciones automáticas (Avanzado)**, cada respuesta puede cambiar el estado de la conversación (abierta, pendiente o resuelta), asignarla a alguien o a quien la usa, agregar tags o posponerla unas horas. Las acciones se aplican al enviar, no al elegir la respuesta: si te arrepentís y no mandás nada, la conversación queda como estaba.
- Una respuesta guardada que manda una persona cuenta como primera respuesta para el SLA. La del bot no cuenta (lo explicamos en [SLAs de soporte con Chat](/blog/slas-de-soporte-con-chat)).

Dos cuidados. Las respuestas guardadas no tienen variables todavía: no hay `{{nombre}}`, así que en las plantillas de abajo los huecos van entre corchetes y la persona los completa antes de mandar. Y el bot también lee tus respuestas guardadas. En el modo "Respuestas guardadas" (y en el modo AI cuando el modelo falla) el bot elige la que más se parece a la pregunta y la manda tal cual, corchetes incluidos. Si el bot lee respuestas guardadas, revisá cada una pensando que puede salir sola: o la escribís sin huecos, o pasás el bot al modo "Páginas de docs".

## Doce plantillas

Cada una con su atajo y las acciones que le asociaríamos.

**1. `/recibido`** (sin acciones)
> Gracias por escribir. Ya estoy con esto y te respondo acá antes de las [hora].

**2. `/necesito-datos`** (estado: pendiente)
> Para revisarlo necesito dos cosas:
> 1. El email de la cuenta.
> 2. Una captura de lo que ves en pantalla.
> Con eso puedo buscar tu caso directamente.

**3. `/reproducido`** (tag: bug)
> Probé con los mismos pasos y vi el mismo error, así que el problema es nuestro. Ya se lo pasé al equipo que lo arregla. Te escribo acá cuando haya novedades, aunque sea para decirte que sigue abierto.

**4. `/arreglado`** (estado: resuelta)
> Ya está arreglado: [qué cambió]. Si te vuelve a pasar, respondé en esta conversación y la retomo.

**5. `/reembolso`** (asignar a: [persona de facturación], tag: facturacion)
> Te paso con [nombre], que maneja los cobros y puede resolver el reembolso. Ya tiene esta conversación con todo el contexto, así que no hace falta que repitas nada.

**6. `/cobro-duplicado`** (tag: facturacion)
> Perdón, el cobro doble fue un error nuestro. Ya pedí la devolución de [monto]; suele verse en tu resumen en [plazo que da tu procesador de pagos].

**7. `/no-se-puede`** (estado: resuelta)
> Hoy eso no se puede hacer: [límite concreto]. Lo más parecido es [alternativa]. Si te sirve, te paso los pasos.

**8. `/pedido`** (tag: feedback, estado: resuelta)
> Lo anoté como pedido para el equipo de producto, con tu caso de uso. No te puedo dar una fecha. Si sale, te aviso por esta vía.

**9. `/espero-respuesta`** (posponer 24 h)
> Quedo atento a tu respuesta. Si mañana no tengo novedades, te vuelvo a escribir.

La conversación se oculta 24 horas y vuelve sola al inbox. Así el "te vuelvo a escribir" queda a cargo de la herramienta.

**10. `/escalado`** (asignar a: [líder de soporte], estado: abierta)
> Lo pasé a [nombre], que conoce mejor esta parte. Te escribe acá; mientras tanto, la conversación sigue abierta.

**11. `/caida`** (tag: incidente)
> Tenemos un problema que afecta a [qué parte]. Estamos trabajando en eso y te aviso acá apenas vuelva a funcionar. Perdón por el corte.

**12. `/cierre`** (estado: resuelta)
> Listo. Si algo no quedó claro, respondé acá y lo seguimos. Vas a ver una encuesta de una pregunta; con eso aprendemos qué mejorar.

La última anticipa el CSAT: al resolver una conversación, el widget le pide al visitante una calificación de 1 a 5 con comentario opcional.

## Cómo mantenerlas

Una vez por mes, alcanza con media hora:

1. **Leé diez conversaciones resueltas** al azar. Chequeá las cinco reglas en lo que se mandó de verdad: la plantilla editada a las apuradas dice más que la original.
2. **Leé los comentarios de CSAT bajos.** Si dos mencionan la misma respuesta, reescribila.
3. **Borrá las que el equipo dejó de usar.** Una lista de 80 respuestas hace que nadie encuentre la buena con `/`.
4. **Revisá los tags.** Si `/reproducido` agrega `bug`, filtrar por ese tag te dice cuántos errores reportó la gente este mes.

## Lo que todavía no hace

- Las respuestas guardadas no tienen variables ni campos que se completen solos.
- Son por widget. Si tenés dos widgets, cada uno tiene su lista.
- No hay sugerencias automáticas de respuesta ni reescritura con IA dentro del inbox.

Chat corre por $0 en tu servidor, o en zerosoft Cloud sin cargo por asiento.
