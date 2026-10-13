---
title: "Ciclos de dos semanas en Track: guía para equipos chicos"
description: "Cómo correr ciclos de dos semanas en Track con issues, sub-issues, relaciones, estimaciones, estados propios y cuatro vistas, y qué partes todavía necesitan un workaround."
date: "2026-07-26"
author: "zerosoft"
tags: ["track", "ciclos", "playbook"]
---

Un ciclo es una ventana de tiempo (normalmente dos semanas) con una lista: decidís qué entra, lo hacés y al final mirás qué quedó afuera. No hace falta planning poker ni un formulario con cuarenta campos.

Así correríamos ciclos en Track para un equipo de tres a diez personas. Es un playbook, no un tour de features, así que incluye las partes donde Track te hace laburar un poco: todavía no hay botón de "nuevo ciclo", y te mostramos el workaround exacto.

## Paso 0: un proyecto por equipo, no por feature

En Track, un proyecto es dueño de sus issues, estados y ciclos. Cada issue recibe un identificador armado con el slug del proyecto: un proyecto con slug `app` genera `APP-1`, `APP-2`, etcétera.

La tentación es crear un proyecto por iniciativa. No lo hagas. Los ciclos viven dentro de un proyecto, así que si el trabajo del equipo está repartido en cinco proyectos, terminás con cinco sprints en paralelo y nadie sabe cuál importa. Un proyecto por equipo, y labels para las iniciativas. Las labels son libres (hasta 10 por issue, cada una con su color) y podés filtrar por ellas.

## Paso 1: armá tus estados

Un proyecto nuevo viene con cinco estados: **Backlog, Todo, In progress, Done, Cancelled**. Cada estado pertenece por debajo a una de esas cinco categorías, que es lo que mantiene todo ordenado cuando agregás los tuyos.

La mayoría de los equipos chicos necesita exactamente uno más: **En revisión**. Hoy los estados propios se crean con el endpoint de la propia app, no desde una pantalla de configuración. Con la sesión iniciada, abrí la consola del navegador en cualquier página de Track y corré:

```js
await fetch('/api/track/projects/<project-id>/statuses', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'En revisión', category: 'in_progress', color: '#666666' }),
}).then((r) => r.json());
```

El id del proyecto es el UUID de la URL (`/app/track/projects/<project-id>`). La `category` tiene que ser `backlog`, `todo`, `in_progress`, `done` o `cancelled`. Los estados nuevos van al final; para reordenar, mandá la lista completa de ids a `PATCH /api/track/projects/<project-id>/statuses/reorder` como `{ "statusIds": [...] }`.

Sí, es medio tosco. Una pantalla de configuración para estados y ciclos es el próximo paso obvio. Ojo: son rutas internas autenticadas con tu sesión, porque Track todavía no tiene API pública.

## Paso 2: creá el ciclo

Misma historia: los ciclos se crean con un POST y después aparecen en toda la UI: el formulario de issue, el panel de propiedades, los filtros y la lista de ciclos al pie de la página del proyecto.

```js
await fetch('/api/track/projects/<project-id>/cycles', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Ciclo 14', startAt: '2026-08-03', endAt: '2026-08-14' }),
}).then((r) => r.json());
```

Nuestro consejo: creá los próximos dos o tres ciclos de una, así la planificación nunca se traba esperando que alguien abra la consola. Nombres aburridos ("Ciclo 14", "Ciclo 15"). Todavía no hay endpoint para editar un ciclo: si le erraste a las fechas, borralo (`DELETE /api/track/cycles/<id>`) y crealo de nuevo.

## Paso 3: planificar issues, sub-issues y estimaciones

Acá Track vuelve a sentirse normal. Todo lo que sigue está en la UI.

- **Issues**: título, descripción con formato, estado, prioridad (urgent, high, medium, low), responsable, labels, fecha de entrega, ciclo y estimación.
- **Estimaciones**: números enteros, sin más. Track no te impone una escala. Elegí una y bancala: a nosotros nos gusta 1, 2, 3, 5, y todo lo que pase de 5 se parte.
- **Sub-issues**: desde cualquier issue creás una subtarea. Es un issue completo, con su estado y su responsable, y el padre muestra sus hijos. Usalas cuando un "5" resulta ser tres "2".
- **Relaciones**: `blocks`, `related` y `duplicates`. Se agregan desde el detalle del issue escribiendo el identificador del otro. El otro issue muestra la inversa ("blocked by", "duplicated by"), así las dependencias se ven desde las dos puntas.

Una reunión de planning práctica: filtrá la lista por el estado **Backlog**, ordená por **prioridad** y asigná issues al ciclo desde el panel de propiedades hasta que la suma de estimaciones se parezca a lo que el equipo realmente entregó la vez pasada. Esa suma la hacés vos: Track no totaliza estimaciones por ciclo ni grafica velocity. Una planilla o una servilleta alcanzan.

## Paso 4: las cuatro vistas y cuándo usar cada una

Track tiene cuatro vistas, y cada una responde una pregunta distinta.

- **Lista**: "¿qué hay en este ciclo?" Filtrá por ciclo, ordená por prioridad o identificador. Es tu vista de planning y de triage.
- **Board**: "¿dónde está cada cosa?" Las columnas son tus estados, en orden. Para mover una tarjeta, cambiale el estado desde el selector de la tarjeta (todavía no hay drag-and-drop en el board). Es la vista de la daily.
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

El último día, filtrá la lista por el ciclo y mirá lo que no está en una categoría de terminado. Para cada sobrante, decidí: pasarlo al próximo ciclo (un cambio en el panel de propiedades), mandarlo de vuelta al backlog o cancelarlo. Cancelled es un estado real por algo: matar trabajo a propósito es una feature.

Después, una retro de cinco minutos. Si usás Docs, el template **Retro semanal** que viene incluido sirve perfecto, y podés linkear la página desde los issues del próximo ciclo.

## Lo que falta (en serio)

Track cubre el núcleo de un flujo con ciclos, pero no todo. Hoy no hay pantalla de configuración para estados ni ciclos, no hay gráficos de velocity ni burndown, no hay pase automático de lo que quedó sin terminar, no hay atajos de teclado ni sincronización en tiempo real: refrescá para ver los cambios de un compañero. Si eso es central en cómo trabaja tu equipo, un tracker más maduro como Linear te va a servir más, y preferimos decírtelo ahora.

Si lo que necesitás es una caja de tiempo, una lista y un equipo que se ponga de acuerdo en qué significa "terminado", tenés todo lo de arriba. Corre en tu servidor por $0 o en zerosoft Cloud, que tiene un plan gratis.
