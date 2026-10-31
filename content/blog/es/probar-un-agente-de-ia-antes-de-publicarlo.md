---
title: "Cómo probar un agente de IA antes de que hable con tus clientes"
description: "Un método en cuatro pasos para probar un agente de soporte: tests guardados con un juez de IA, conversaciones simuladas, repetición de chats reales y versiones con borrador."
date: "2026-10-31"
author: "zerosoft"
tags: ["agents", "ia", "soporte", "calidad"]
---

Cambiás una línea de las instrucciones de tu agente de soporte y esa tarde alguien te cuenta que el bot le prometió un reembolso. Nadie lo había probado, porque probar un agente a mano es lento y siempre se prueba la misma pregunta feliz.

Intercom documenta cómo probar a Fin antes de lanzarlo: una [vista previa en el Messenger](https://www.intercom.com/help/en/articles/7837527-test-fin-ai-agent-before-rolling-it-out-to-customers) para tu equipo o segmentos de clientes, y un [Batch Test](https://www.intercom.com/help/en/articles/10521711-batch-test-fin-ai-agent) que corre preguntas reales antes de que las respuestas lleguen a un cliente. La idea es buena. Este post toma el mismo problema y lo resuelve con las herramientas de Agents, con lo que hace cada una y lo que todavía no hace.

## El problema: un agente cambia con cada edición

Un agente depende de tres cosas que editás seguido: las instrucciones, el conocimiento y las herramientas. Tocar cualquiera puede romper una respuesta que antes salía bien. Probar bien significa tener una lista fija de situaciones y volver a correrla cada vez que cambiás algo, como cualquier suite de tests.

El método tiene cuatro piezas. Se pueden usar por separado, pero juntas cubren casi todo.

## Paso 1: guardá preguntas con el comportamiento esperado

En la pestaña Playground del agente hay una sección Tests. Cada test es una pregunta de un visitante y una descripción de lo que hace una buena respuesta, en tus palabras. Un agente admite hasta 50.

Lo importante es qué escribís en "Comportamiento esperado". Describí acciones, no redacción:

```
Pregunta: ¿Hacen envíos a Brasil?
Esperado: Busca en el conocimiento y dice que el envío a Brasil tarda
5 días hábiles. No reserva reuniones.
```

Cada test corre en el playground en modo simulación: el agente responde de verdad, pero las herramientas que escriben (guardar un contacto, agendar, ejecutar un flow) no se ejecutan. Después un juez de IA compara la respuesta y las herramientas usadas con lo esperado, y marca Aprobado o Fallado con un motivo de una o dos frases. La redacción no tiene que coincidir; el juez evalúa el fondo.

Un punto de partida de diez tests para un agente de soporte:

1. Tres preguntas cuya respuesta está en tu conocimiento (precio, plazo, política).
2. Dos preguntas cuya respuesta no está. Esperado: no inventa y deriva.
3. Un pedido de reembolso. Esperado: deriva, no promete nada.
4. Alguien que pide hablar con una persona. Esperado: deriva en el primer mensaje.
5. Una pregunta fuera de tema. Esperado: la rechaza con amabilidad.
6. Un intento de que ignore sus instrucciones. Esperado: no cambia de comportamiento.
7. Una pregunta en portugués o inglés. Esperado: responde en el idioma del visitante.

Si ya tenés un buen intercambio en el playground, el botón "Guardar como test" lo convierte en caso sin retipear la pregunta.

## Paso 2: simulá conversaciones completas

Muchos problemas aparecen en el tercer mensaje, no en el primero: el agente pide el email, el cliente se queja, el agente se pierde. Para eso, un test puede ser de tipo "Conversación simulada".

Definís una persona y un objetivo, por ejemplo: "Ana, dueña de una panadería chica. Quiere una demo la semana que viene y da su email cuando se lo piden". Un cliente simulado por IA habla con el borrador del agente hasta cumplir el objetivo, ser derivado a una persona o llegar al tope de turnos (entre 2 y 8, por defecto 4). Después el juez evalúa la conversación entera contra tu criterio de éxito, y podés leer la transcripción turno por turno.

Dos simulaciones que conviene tener siempre:

- **El cliente cooperativo.** Da los datos que se le piden. Verifica que el agente completa la tarea (por ejemplo, agendar).
- **El cliente que se enoja.** Repite la pregunta y escribe seco. Verifica que el agente deriva en lugar de insistir.

Una simulación gasta tokens de dos conversaciones, la del cliente y la del agente, así que no hace falta correr todas en cada edición chica. Corré las simulaciones antes de publicar y los tests de una pregunta cuando cambies conocimiento.

## Paso 3: repetí conversaciones reales contra el borrador

Tus tests inventados reflejan lo que imaginás que preguntan los clientes. Las conversaciones reales muestran lo que preguntan de verdad. El Playground también tiene "Repetir las últimas 10": toma los primeros mensajes de las últimas diez conversaciones reales, se los manda al borrador guardado (también en simulación) y muestra lado a lado lo que contestó antes y lo que contesta ahora, con un veredicto de Mejor, Igual o Peor.

Es la prueba que más sorprende. Si cambiaste el tono de las instrucciones, enseguida ves si las diez respuestas siguen diciendo lo que tenían que decir. Cuando aparece un "Peor", ya tenés el siguiente test para guardar.

## Paso 4: publicá con borrador y dejá una salida

Las pruebas sirven si el agente en vivo no cambia mientras las hacés. Por eso Agents tiene versiones. Cuando publicás la primera, lo que guardás desde ahí queda como borrador: el playground y los tests usan el borrador, y los canales en vivo siguen con la versión publicada hasta que tocás Publicar. El flujo completo:

1. Editá y guardá. Aparece "Cambios sin publicar" junto al estado de la versión en vivo.
2. Corré los tests, las simulaciones y la repetición.
3. Si todo pasa, Publicar, con una nota opcional que diga qué cambió ("agregué la política de devoluciones").
4. Si algo salió mal, "Descartar borrador" vuelve el editor a la versión en vivo, y "Volver a esta versión" pone en vivo cualquier versión anterior como una versión nueva.

El registro de cambios guarda quién cambió qué y cuándo: instrucciones, archivos de conocimiento, herramientas, conexiones. Cuando un martes el agente se comporta distinto, ahí ves qué se tocó el lunes.

Para cambios grandes hay una opción más prudente: el test A/B, en la pestaña Versiones. Una versión guardada atiende entre el 5% y el 95% de las conversaciones nuevas y el resto sigue con la publicada. La tabla compara conversaciones, resueltas, derivaciones y pulgares arriba y abajo de cada variante, y podés poner la B en vivo o terminar el test. Con poco tráfico los números tardan en decir algo, así que usalo cuando tengas volumen y no como reemplazo de los tests.

## Lo que todavía no hace

Conviene saber los límites antes de confiar en las pruebas:

- **El juez es un modelo.** Puede equivocarse. Leé el motivo de cada Fallado y de algún Aprobado al azar, sobre todo al empezar.
- **La simulación no ejecuta las herramientas.** Verifica que el agente decidió llamar a "Agendar reunión" con los datos correctos, no que la reserva se haya creado. Esa parte se prueba con un caso real, a mano, una vez.
- **Los tests usan la versión guardada.** Si tenés cambios sin guardar en el editor, el aviso te pide guardarlos primero.
- **Los tests no bloquean la publicación.** La pestaña Canales muestra cuántos tests tiene el agente y cuántos pasaron, con un atajo para correrlos, pero publicar no depende de eso: decidís vos.

## Cuánto cuesta probar

En Intercom, probar con clientes reales en el entorno en vivo [se factura por resolución](https://www.intercom.com/help/en/articles/7837527-test-fin-ai-agent-before-rolling-it-out-to-customers). En Agents no hay un precio por resolución: los tests consumen tokens del modelo que elegiste, con tu propia clave si hacés self-host o por consumo en zerosoft Cloud, y la IA se cobra al costo del proveedor ×1,2. Un set de diez tests de una pregunta son diez respuestas cortas y diez veredictos cortos. Probar antes de publicar sale mucho más barato que corregir una promesa equivocada después.

## Una rutina que se sostiene

- **Cada vez que cambiás algo:** guardá, corré los tests de una pregunta.
- **Antes de publicar:** corré las simulaciones y "Repetir las últimas 10".
- **Cada semana:** mirá las conversaciones calificadas con pulgar abajo y convertí dos en tests nuevos.

Después de un mes tenés entre 20 y 30 casos que vienen de situaciones reales, y cambiar las instrucciones deja de dar miedo.
