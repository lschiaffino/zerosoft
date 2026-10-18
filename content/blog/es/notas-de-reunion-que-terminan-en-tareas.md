---
title: "Notas de reunión que terminan en tareas"
description: "Un formato de notas de reunión en Docs con decisiones y acciones que tienen dueño y fecha, una tabla de seguimiento entre reuniones, el pase de las acciones grandes a Track y una página automática por cada reserva de Cal."
date: "2026-10-18"
author: "zerosoft"
tags: ["docs", "reuniones", "plantillas"]
---

El blog de Notion tiene un post muy leído sobre [plantillas de notas de reunión](https://www.notion.com/blog/meeting-notes-template). Divide el trabajo en tres momentos (antes, durante y después), recomienda mandar una agenda, nombrar a alguien que tome notas y cerrar con próximos pasos con responsable.

Todo eso es correcto. El problema aparece una semana después: las notas existen, pero nadie sabe si las acciones se hicieron. Donde fallan las notas de reunión es en el seguimiento. Este post propone un formato corto en Docs donde cada acción tiene dueño y fecha, una forma de revisarlas en la reunión siguiente y un criterio para pasar a Track lo que es trabajo de verdad.

## La plantilla de partida

Docs trae una plantilla **Notas de reunión** con tres secciones: Agenda, Notas y Acciones (esta última con un to-do). Creá la página desde el inicio de Docs con **Empezar desde una plantilla** y agregale lo que falta. Así queda la nuestra:

```
Fecha: 2026-10-20 · Participantes: @Ana, @Martín, @Lucía
Notas: @Martín

## Agenda
- Precio del plan anual (Ana, 10 min)
- Bug del CSV de contactos (Lucía, 5 min)

## Decisiones
- El plan anual tiene 2 meses de descuento. Decidió: Ana.

## Notas
...

## Acciones
[ ] @Lucía: Arreglar la exportación de CSV · vence 22/10
[ ] @Ana: Actualizar la página de precios · vence 24/10

## Pendiente de la reunión anterior
- [[Producto · 2026-10-13]]
```

Tres cambios sobre la plantilla incluida:

1. **Una sección de Decisiones separada de las Notas.** Dentro de un mes nadie va a releer las notas, pero alguien va a preguntar "¿cuándo decidimos esto y quién?". Una línea por decisión, con quién la tomó.
2. **Cada acción con @persona y fecha.** Al escribir `@` y elegir a un compañero, Docs le manda una notificación de que lo mencionaste en esa página. Es el aviso que reemplaza el "te mando las notas".
3. **Un link a la reunión anterior** con `[[`, que busca la página por título mientras escribís. Por eso conviene titular todas igual: `Producto · 2026-10-20`.

Docs no deja guardar plantillas propias todavía. El workaround que usamos: una página "Plantillas" con esta versión adentro, y **Duplicar** cada vez que hace falta. Duplicar copia la página con todas sus subpáginas.

## Antes: la agenda en la misma página

Creá la página de la reunión el día anterior y escribí la agenda ahí, con quién trae cada tema y cuántos minutos. El que quiera sumar un tema lo agrega en la página. Si alguien quiere comentar un punto antes de la reunión, puede dejar un **comentario sobre ese bloque**: el comentario queda pegado al punto de la agenda y se resuelve cuando se trata.

Una regla que ahorra reuniones: si la agenda está vacía la noche anterior, la reunión se cancela.

## Durante: notas de quien no habla

Una persona toma notas y rota cada semana. Mientras escribe, tres atajos ayudan a no perder el hilo:

- `/` abre el menú de bloques: títulos, listas, to-dos, citas, código, tablas.
- `[[` linkea otra página: un spec, la página de un cliente, la reunión anterior.
- `@` menciona a alguien.

Docs guarda solo, apenas dejás de escribir. Si dos personas editan la página a la vez, Docs avisa que otra persona la editó mientras escribías y te deja ver la versión nueva o sobrescribirla. La edición en tiempo real con varios cursores todavía no existe, así que en la reunión escribe una sola persona y el resto comenta.

## Después: diez minutos para ordenar

Apenas termina la reunión, la persona que tomó notas:

1. Pasa las notas sueltas a viñetas cortas.
2. Revisa que cada acción tenga @persona y fecha. Si una acción no tiene dueño, no es una acción.
3. Mueve a Decisiones lo que se decidió en el medio de una discusión.
4. Decide qué acciones van a Track (ver abajo).

Si hace falta mandarlas afuera, por ejemplo a un cliente, el menú de la página exporta a **Markdown** o a **PDF**. Para alguien del equipo alcanza con **Copiar enlace**.

## El seguimiento: una tabla de acciones abiertas

Este es el paso que casi todas las plantillas saltean. Las acciones de cada reunión quedan en cada página, y nadie abre cinco páginas para ver qué quedó pendiente.

La solución en Docs es una página fija, "Acciones abiertas", con un **bloque de base de datos** (`/database`). Es una tabla con columnas tipadas. La nuestra:

| Acción | Responsable | Vence | Estado | Reunión |
|---|---|---|---|---|
| Arreglar la exportación de CSV | Lucía | 2026-10-22 | Abierta | Producto · 10-20 |
| Actualizar la página de precios | Ana | 2026-10-24 | Abierta | Producto · 10-20 |

Columnas: Acción (texto), Responsable (select con los nombres del equipo), Vence (fecha), Estado (select: Abierta, Hecha, Descartada), Reunión (texto).

El bloque de base de datos todavía no filtra, ordena ni agrupa, y no tiene relaciones con otras páginas. Para un equipo chico se maneja: las filas hechas se borran cada semana y la tabla queda corta.

La reunión siguiente arranca con esa tabla, cinco minutos. Cada acción vencida tiene tres salidas: se hizo, se le pone fecha nueva o se descarta en voz alta.

## Qué va a Track y qué se queda en Docs

No todas las acciones son iguales. Una regla simple:

- **Se queda en Docs** si dura menos de un día y no depende de nadie más: "mandarle el contrato a X", "confirmar la fecha con el proveedor".
- **Va a Track** si es trabajo de producto, si tiene sub-tareas o si alguien más va a necesitar ver en qué estado está. En Track tiene estado, prioridad, ciclo, comentarios y aparece en **Mis tareas** de la persona.

Cuando una acción pasa a Track, reemplazá el texto en las notas por el identificador del issue (`APP-57`). El pase hoy es manual: copiás el título y lo creás en Track. Docs y Track todavía no están conectados por un bloque o un link automático.

## Para reuniones con clientes: una página por reserva

Si agendás reuniones con Cal, Flow puede crear la página de notas sola. Armá un flujo con el disparador **Cal: reserva creada** y el paso **Docs: crear página**, con un título como:

```
{{trigger.eventType.title}} · {{trigger.invitee.name}}
```

y en el contenido el email del invitado y la fecha (`{{trigger.invitee.email}}`, `{{trigger.startsAt}}`). Las líneas en blanco separan párrafos. El paso crea solo párrafos, así que los títulos de la plantilla los sumás vos al abrir la página. Flow también trae la plantilla "Nueva reserva en Cal → tarea en Track", que crea un issue para preparar cada reunión.

## Lo que Docs no hace (todavía)

Notion resume notas con IA y genera la lista de acciones. Docs no tiene IA dentro del editor. Tampoco tiene edición en tiempo real ni una base de datos con filtros. Lo que sí tiene alcanza para que cada reunión termine con decisiones escritas y acciones con dueño: plantilla, menciones, links entre páginas, comentarios por bloque, historial de versiones y exportación. Corre en tu servidor por $0 o en zerosoft Cloud, y si querés ver cómo encaja con el resto de tu wiki, tenemos una [guía para armar una wiki interna con Docs](/blog/wiki-interna-con-docs).
