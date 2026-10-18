---
title: "Cuándo un agente de IA tiene que pasarle la conversación a una persona"
description: "Cinco situaciones en las que un agente de soporte o de ventas tiene que derivar, cómo se configura cada una en Agents y qué revisar cada semana para ajustar las reglas."
date: "2026-10-18"
author: "zerosoft"
tags: ["agents", "ia", "soporte"]
---

Un agente de IA que nunca deriva termina inventando. Uno que deriva todo es un formulario de contacto con más pasos. El trabajo está en el medio: decidir en qué casos la conversación tiene que pasar a una persona, y que esa persona la reciba con contexto.

Zapier tiene una buena guía sobre [human-in-the-loop](https://zapier.com/blog/human-in-the-loop/) en flujos de IA en general: aprobaciones, ruteo por confianza, escalamientos y registros. Este post baja esas ideas a un caso concreto, un agente que habla con tus clientes, y muestra cómo se configura cada regla en Agents, con lo que hace y lo que todavía no hace.

## Las cinco situaciones que siempre derivan

**1. El visitante lo pide.** "Quiero hablar con alguien" no se discute. Insistir con el bot en ese momento es la forma más rápida de perder un cliente.

**2. La respuesta no está en tu conocimiento.** Si el agente no encontró nada en tus docs, cualquier cosa que diga es una adivinanza con buena redacción.

**3. Hay plata o contratos de por medio.** Reembolsos, bajas, descuentos, facturas mal emitidas, cláusulas. El agente puede juntar los datos, pero la decisión es de una persona.

**4. El cliente está enojado o lo intentó dos veces.** Si alguien repite la misma pregunta o escribe en mayúsculas, el próximo mensaje tiene que ser humano.

**5. Un lead que vale la pena.** Esta es la que más se olvida. Derivar también sirve para lo bueno: un lead que dijo que tiene presupuesto y lo necesita este trimestre no debería esperar al seguimiento del lunes.

## Cómo se configura cada una en Agents

En Agents, la derivación es una herramienta: "Derivar a una persona". Tiene que estar prendida en la pestaña Herramientas para que las reglas de abajo apliquen. Después, en Instrucciones, dentro de Avanzado:

**Cuando el visitante pide hablar con una persona.** Un interruptor, prendido por defecto. Cubre la situación 1.

**Cuando el agente no sabe la respuesta o no está seguro.** Otro interruptor, también prendido por defecto. Cubre la situación 2. Conviene ser precisos: no hay un número de confianza detrás. Es una regla que el agente recibe en sus instrucciones, junto con otra fija: no inventar precios, políticas, fechas, links ni funciones. Si además prendiste "Buscar conocimiento", el agente tiene que buscar antes de responder sobre el negocio, y la búsqueda vacía queda registrada.

**Derivar siempre con estas palabras.** Una lista separada por coma, hasta 30. Cubre la situación 3, y es la más confiable de todas: si el mensaje del visitante contiene una de esas palabras, la conversación se deriva sin pasar por el modelo. Ni siquiera se gasta un token. Un punto de partida:

```
reembolso, devolución, baja, cancelar, factura, abogado, denuncia, contrato
```

La comparación ignora mayúsculas y tildes, así que "devolucion" también cuenta. Ojo con palabras muy cortas o muy comunes: "plan" derivaría la mitad de las conversaciones.

**Las situaciones 4 y 5 van en el brief.** Las instrucciones del agente se escriben como se las explicarías a alguien nuevo. Por ejemplo:

```
Si el cliente repite la misma pregunta o se nota molesto, no insistas:
derivá a una persona y avisale que alguien del equipo le responde por acá.

Cuando un lead te diga que lo necesita este trimestre y tiene presupuesto,
guardá una nota en el CRM con el resumen y derivá a una persona.
```

La plantilla "Calificador de leads" ya trae esta lógica: puntúa cada lead como CALIENTE, TIBIO o FRÍO y deriva los calientes.

## Qué pasa cuando deriva

Depende del canal:

- **En el widget de Chat**, la conversación queda marcada como derivada, se agrega un mensaje de sistema, la prioridad sube a alta y tu equipo recibe un aviso. Desde ahí, el agente deja de responder. También se calla apenas alguien del equipo contesta, aunque nadie haya derivado.
- **En la página pública y por API**, el equipo recibe una notificación con un link directo a la conversación.

En los dos casos el visitante lee un mensaje de derivación. Podés escribir el tuyo (hasta 500 caracteres) o usar el de defecto, que sale en español, portugués o inglés según cómo escribió el visitante.

Un buen mensaje de derivación dice dos cosas: que una persona va a responder y por dónde. "Te paso con alguien del equipo, te responde por acá" es mejor que "Tu consulta es muy importante para nosotros".

## Acciones que no dependen solo de la buena voluntad del modelo

La guía de Zapier pone las aprobaciones primero, y tiene razón: hay acciones que no deberían pasar sin una confirmación. Agents no tiene todavía una cola donde una persona apruebe una acción antes de que corra. Lo que sí tiene son controles en el código de cada herramienta, que el modelo no puede saltear:

- **Agendar una reunión** exige un horario que el propio agente ofreció en un mensaje anterior, la confirmación explícita del visitante, su nombre y su email. El horario se vuelve a verificar justo antes de reservar.
- **Guardar o buscar un contacto en el CRM** solo acepta un email que el visitante escribió en la conversación. El agente no puede usarse para averiguar si un email cualquiera está en tu base.
- **Request HTTP** solo llega a los dominios que permitas, hasta 20.
- **Ejecutar flow** solo corre los flows que elegiste.

Para todo lo demás, la regla es simple: si una acción no se puede deshacer, no le prendas la herramienta.

## La revisión semanal

Las reglas de derivación se ajustan mirando conversaciones reales. Treinta minutos por semana alcanzan:

1. **Abrí la pestaña Conversaciones** y filtrá por canal. Las derivadas tienen su marca.
2. **Mirá las derivadas.** ¿Cuántas podría haber resuelto el agente si la respuesta estuviera en tus docs? Cada una es una página por escribir.
3. **Mirá las que no derivaron.** Buscá respuestas largas a preguntas de plata o reclamos. Si encontrás una, sumá la palabra a la lista.
4. **Calificá.** Cada respuesta tiene pulgar arriba y abajo, con una nota opcional ("debería haber derivado"). La lista de agentes muestra el conteo.
5. **Leé el registro de herramientas.** Cada conversación guarda qué herramientas usó el agente, con qué datos y qué le devolvieron. Si "Buscar conocimiento" volvió vacío y el agente respondió igual, ahí tenés un problema concreto.

## Lo que cuesta derivar

Intercom cobra [$0,99 por cada resultado de Fin](https://www.intercom.com/pricing), además de los asientos. Ese modelo empuja a medir al agente por lo que resuelve solo. En Agents no hay un precio por resolución: pagás los tokens del modelo que elijas, con tu clave si hacés self-host o por consumo en zerosoft Cloud. Una derivación por palabra clave no usa el modelo.

Eso cambia la cuenta. Derivar de más te cuesta tiempo del equipo. Derivar de menos te cuesta clientes. Las reglas de arriba buscan el punto entre los dos.
