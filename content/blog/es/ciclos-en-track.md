---
title: "Ciclos de dos semanas en Track: guía para equipos chicos"
description: "Cómo correr ciclos de dos semanas en Track con issues, sub-issues, relaciones, estimaciones, estados propios y cuatro vistas, y qué le falta todavía."
date: "2026-07-26"
author: "zerosoft"
tags: ["track", "ciclos", "playbook"]
---

Un ciclo es una ventana de tiempo (normalmente dos semanas) con una lista: decidís qué entra, lo hacés y al final mirás qué quedó afuera. No hace falta planning poker ni un formulario con cuarenta campos.

Así correríamos ciclos en Track para un equipo de tres a diez personas. Es un playbook, no un tour de features, así que también dice qué le falta a Track.

## Paso 0: un proyecto por equipo, no por feature

En Track, un proyecto es dueño de sus issues, estados y ciclos. Cada issue recibe un identificador armado con el slug del proyecto: un proyecto con slug `app` genera `APP-1`, `APP-2`, etcétera.

La tentación es crear un proyecto por iniciativa. No lo hagas. Los ciclos viven dentro de un proyecto, así que si el trabajo del equipo está repartido en cinco proyectos, terminás con cinco sprints en paralelo y nadie sabe cuál importa. Un proyecto por equipo, y labels para las iniciativas. Las labels son libres (hasta 10 por issue, cada una con su color) y podés filtrar por ellas.

## Paso 1: armá tus estados

Un proyecto nuevo viene con cinco estados: **Backlog, Todo, In progress, Done, Cancelled**. Cada estado pertenece por debajo a una de esas cinco categorías, que es lo que mantiene todo ordenado cuando agregás los tuyos.

La mayoría de los equipos chicos necesita exactamente uno más: **En revisión**. En la página del proyecto abrí **Ajustes**, pestaña **Estados**, y agregalo con la categoría In progress. Ahí también le cambiás el nombre y el color a cualquier estado, los reordenás (el orden es el de las columnas del board) y borrás los que no uses, pasando sus issues a otro estado.

## Paso 2: creá el ciclo

En **Ajustes**, pestaña **Ciclos**, tocá **Nuevo ciclo**. El formulario propone el número y las fechas que siguen al último ciclo, con la misma duración, y avisa si se superpone con otro. Después el ciclo aparece en toda la UI: el formulario de issue, el panel de propiedades y los filtros.

Nuestro consejo: creá los próximos dos o tres ciclos de una, así la planificación nunca se traba. Nombres aburridos ("Ciclo 14", "Ciclo 15"). Si le erraste a las fechas, editalo desde la misma lista.

## Paso 3: planificar issues, sub-issues y estimaciones

Acá Track vuelve a sentirse normal. Todo lo que sigue está en la UI.

- **Issues**: título, descripción, estado, prioridad (urgent, high, medium, low), responsable, labels, fecha de entrega, ciclo y estimación.
- **Estimaciones**: números enteros, sin más. Track no te impone una escala. Elegí una y bancala: a nosotros nos gusta 1, 2, 3, 5, y todo lo que pase de 5 se parte.
- **Sub-issues**: desde cualquier issue creás una subtarea. Es un issue completo, con su estado y su responsable, y el padre muestra sus hijos. Usalas cuando un "5" resulta ser tres "2".
- **Relaciones**: `blocks`, `related` y `duplicates`. Se agregan desde el detalle del issue escribiendo el identificador del otro. El otro issue muestra la inversa ("blocked by", "duplicated by"), así las dependencias se ven desde las dos puntas.

Una reunión de planning práctica: filtrá la lista por el estado **Backlog**, ordená por **prioridad** y asigná issues al ciclo desde el panel de propiedades hasta que la suma de estimaciones se parezca a lo que el equipo realmente entregó la vez pasada. Esa suma la hacés vos: Track no totaliza estimaciones por ciclo ni grafica velocity. Una planilla o una servilleta alcanzan.

## Paso 4: las cuatro vistas y cuándo usar cada una

Track tiene cuatro vistas, y cada una responde una pregunta distinta.

- **Lista**: "¿qué hay en este ciclo?" Filtrá por ciclo, ordená por prioridad o identificador. Es tu vista de planning y de triage.
- **Board**: "¿dónde está cada cosa?" Las columnas son tus estados, en orden. Para mover una tarjeta, arrastrala a otra columna o cambiale el estado desde el selector de la tarjeta. Es la vista de la daily.
- **Calendario**: "¿qué vence cuándo?" Los issues caen en su fecha de entrega; los que no tienen fecha van a una lista de Sin programar. Sirve para trabajo atado a fechas reales: un lanzamiento, una entrega a un cliente.
- **Gantt**: "¿tiene sentido el orden?" Las barras van de la fecha de inicio a la de entrega, y podés arrastrar una barra para moverla o estirar sus bordes para cambiar inicio o fin. Así es, de hecho, como se carga la fecha de inicio. Combinado con relaciones `blocks`, es el mejor lugar para detectar una dependencia programada después de lo que bloquea.

## Paso 5: vistas guardadas para que nadie rearme filtros

Cualquier combinación de tipo de vista, filtros y orden se puede guardar con un nombre, y podés marcar una como tu default del proyecto. Las vistas guardadas son personales, cada uno tiene las suyas, así que proponele algunas al equipo:

- **Este ciclo (board)**: board filtrado por el ciclo actual.
- **Lo mío**: lista filtrada por vos como responsable, ordenada por prioridad.
- **Urgente, cualquier ciclo**: lista con prioridad urgent + high.
- **Trabajo con fecha**: calendario filtrado por una label como `cliente`.

Cuando arranca un ciclo nuevo, actualizá el filtro de ciclo en la vista "Este ciclo" y guardala de nuevo.

## Paso 6: durante el ciclo

El loop diario es corto:

1. Abrí el board. Lo que esté hace demasiado en **In progress** se gana un comentario.
2. Los comentarios soportan @menciones; la persona mencionada recibe una notificación en el **Inbox** de Track, que también junta asignaciones, cambios de estado y comentarios en tus issues.
3. Adjuntá capturas o logs al issue (hasta 10 MB por archivo).
4. Cada issue guarda un log de actividad: quién cambió estado, prioridad, responsable, ciclo o título, y cuándo. Cuando alguien pregunta "¿por qué se atrasó esto?", la respuesta suele estar ahí.

## Paso 7: cerrar el ciclo

El último día, filtrá la lista por el ciclo y mirá lo que no está en una categoría de terminado. Para cada sobrante, decidí: dejarlo para el próximo ciclo, mandarlo de vuelta al backlog o cancelarlo. Después tocá **Completar** en la lista de ciclos: todo lo que quedó sin terminar pasa junto al ciclo siguiente (o queda sin ciclo si no hay uno). Cancelled es un estado real por algo: matar trabajo a propósito es una feature.

Después, una retro de cinco minutos. Si usás Docs, el template **Retro semanal** que viene incluido sirve perfecto, y podés linkear la página desde los issues del próximo ciclo.

## Lo que falta (en serio)

Track cubre el núcleo de un flujo con ciclos, pero no todo. Hoy no hay gráficos de velocity ni burndown, los ciclos no se crean solos con una cadencia, no hay paleta de comandos y no hay sincronización en tiempo real: refrescá para ver los cambios de un compañero. Si eso es central en cómo trabaja tu equipo, un tracker más maduro como Linear te va a servir más, y preferimos decírtelo ahora.

Si lo que necesitás es una caja de tiempo, una lista y un equipo que se ponga de acuerdo en qué significa "terminado", tenés todo lo de arriba. Corre en tu servidor por $0 o en zerosoft Cloud, que tiene un plan gratis.
