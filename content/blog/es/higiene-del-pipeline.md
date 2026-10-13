---
title: "Ocho reglas para que el pipeline de un equipo chico diga la verdad"
description: "Cómo diseñar etapas, cuándo usar varios pipelines, qué hacer con los deals estancados y cómo usar tareas para que el pipeline del CRM se mantenga al día."
date: "2026-08-22"
author: "zerosoft"
tags: ["crm", "ventas", "playbook"]
---

Todo CRM arranca limpio. Seis meses después el tablero tiene 140 deals abiertos, la mitad con fecha de cierre del otoño pasado, y el "forecast ponderado" es un número por el que nadie apostaría un almuerzo. Nadie decidió hacer un desastre. Se fue acumulando, una actualización salteada a la vez.

La herramienta ayuda poco si el equipo no acuerda un puñado de reglas. El CRM sirve para que se vea cuando alguien las rompe. Estas son las ocho que adoptaríamos si fuéramos un equipo de ventas de cinco personas arrancando el lunes, con cómo se traduce cada una a lo que zerosoft CRM hace de verdad.

## 1. Un pipeline por proceso de venta, no por persona

zerosoft soporta varios pipelines, cada uno con sus etapas, y cambiar entre ellos en el tablero de deals es un dropdown. La tentación es armar uno por vendedor, por producto o por región. No lo hagas.

Un pipeline tiene que representar un **proceso de compra distinto**: negocio nuevo vs. renovaciones, o upgrades self-serve vs. deals enterprise. Si dos pipelines tendrían las mismas etapas, son un solo pipeline, filtrado por owner u origen.

Una prueba útil: si no podés explicar en una oración por qué un deal va en el pipeline A y no en el B, te sobra un pipeline.

## 2. Las etapas son cosas que hizo el comprador, no cosas que esperás

"Interesado" es un sentimiento. "Demo hecha" es un hecho. Nombrá las etapas por algo verificable que pasó:

- Calificado
- Demo hecha
- Propuesta enviada
- Negociación
- Cerrado ganado
- Cerrado perdido

De cinco a siete etapas alcanza para un equipo chico. Cada etapa en zerosoft tiene una **probabilidad %**, y el tablero la usa para mostrar arriba los deals abiertos, el monto abierto y un forecast ponderado. Poné esas probabilidades según tu propia historia si la tenés, y revisalas una vez por trimestre. Una etapa se marca como **Cerrado ganado** y otra como **Cerrado perdido**; eso es lo que alimenta los reportes de ganados/perdidos y el win rate.

Las etapas se reordenan arrastrando en los ajustes. Borrar una etapa o un pipeline que todavía tiene deals está bloqueado, y borrarlos es solo para admins, así nadie "ordena" por accidente.

## 3. Todo deal abierto tiene una próxima tarea

Esta es la regla que hace la mayor parte del trabajo. Si un deal no tiene un próximo paso con fecha, no es un deal; es una esperanza con un monto.

zerosoft muestra la próxima tarea abierta arriba de la página de cada deal, con un botón para completarla ahí mismo. La página de tareas (`/app/crm/tasks`) agrupa todo en Vencidas, Hoy y Próximas, filtrable por owner. Hacelo costumbre de equipo: cuando completás una tarea de un deal, creás la siguiente antes de cerrar la pestaña.

Si preferís no depender de la costumbre, los [workflows](/blog/workflows-crm-tareas-de-seguimiento) pueden crear el seguimiento solos cuando un deal llega a una etapa.

## 4. Todo deal abierto tiene monto y fecha de cierre

Un forecast es tan bueno como los deals que lo alimentan. Un deal sin monto es invisible en el forecast ponderado; un deal sin fecha de cierre es invisible en el tiempo.

Aclaración honesta: zerosoft todavía no tiene campos obligatorios. No podés forzar un valor al crear. Así que hacelo regla y hacé que las violaciones sean fáciles de encontrar:

- En la vista de **tabla** de deals, ordená por fecha de cierre. Los deals sin fecha se van al fondo, donde los ves todos juntos.
- Ordená por monto ascendente para ver los ceros primero.
- Los filtros y el orden viven en la URL de la página, así que **guardala en favoritos** y revisarlos la semana que viene es un clic.

## 5. Una fecha de cierre pasada en un deal abierto es una mentira

Si la fecha de cierre fue el mes pasado y el deal sigue abierto, o se cerró y nadie lo actualizó, o la fecha era ficción. Las dos cosas hay que arreglarlas.

En la tabla de deals, armá los filtros avanzados: **Fecha de cierre antes de** (la fecha de hoy), **Etapa no es** Cerrado ganado, **Etapa no es** Cerrado perdido. Los filtros se combinan con AND; guardá el resultado en favoritos. Una limitación: las fechas en los filtros son absolutas, no relativas, así que actualizá la fecha cuando hagas la revisión. Para cada deal que aparezca, hacé una de tres cosas: mové la fecha con el motivo en una nota, mové la etapa, o cerralo.

## 6. Catorce días sin actividad significa que decidís hoy

En el tablero kanban, todo deal abierto sin actividad registrada en más de 14 días (o, si no tiene ninguna actividad, sin ediciones) muestra un badge visible de "Sin actividad en N días". Pasá el mouse por una tarjeta para ver la antigüedad del deal; la vista de tabla tiene una columna Antigüedad. Esos badges no son decoración. Son la lista de cosas a decidir esta semana.

Para cada deal marcado, elegí una:

- **Registrá lo que pasó**: una llamada, un email, una reunión, una nota. Si algo pasó y nadie lo anotó, anotalo.
- **Avanzalo**: si el comprador se movió, mové la etapa.
- **Cerralo como perdido**: si el comprador desapareció y dos seguimientos no dieron nada, dejá de hacerte el distraído.

"Dejarlo y ver qué pasa" no está en la lista. Así es como llegás a 140 deals abiertos.

## 7. Cerrá rápido los perdidos, y siempre decí por qué

Los equipos evitan cerrar deals como perdidos porque se siente como admitir una derrota. El resultado es un pipeline inflado de zombies que vuelven inútil el forecast.

En zerosoft, cerrar un deal como perdido te pide un motivo: Precio, Momento, Competencia, Sin presupuesto, No respondió más, Otro, o tu propio texto. Ese motivo queda guardado en el deal y aparece en el gráfico de **Motivos de pérdida** de los reportes. Después de un trimestre, ese gráfico te dice más sobre tu producto y tu precio que la mayoría de las encuestas. ¿"No respondió más" arriba de todo? Tu calificación es demasiado floja. ¿"Precio"? O tu pricing o tu targeting están mal.

Un deal perdido tampoco desaparece. Queda en el registro, con su historia, y una tarea de seguimiento a 90 días lo puede resucitar.

## 8. Campos personalizados: pocos, y solo si alguien los usa

Los campos custom en deals son útiles: tipo de deal, duración del contrato, competidor en juego. También son la forma más rápida de llenar de ruido el formulario hasta que nadie complete nada.

Regla práctica: no agregues un campo salvo que un reporte, un filtro o una decisión dependan de él. Si nadie filtró por él en dos meses, es un mueble.

## Que quede

Las reglas no sobreviven sin un ritual. Poné 30 minutos en el calendario todas las semanas, mismo día, todo el equipo, y recorran el tablero: badges primero, fechas de cierre pasadas segundo, deals sin próxima tarea tercero. Cuando cambia la etapa o el monto de un deal, zerosoft guarda un historial de propiedades en el registro, así ves qué se movió desde la semana pasada y quién lo movió.

El objetivo no es un tablero lindo. Es un tablero donde cada tarjeta abierta significa "alguien está trabajando esto, y sabemos cuándo vamos a saber". Cuando eso es verdad, el forecast deja de ser una adivinanza y pasa a ser una herramienta.
