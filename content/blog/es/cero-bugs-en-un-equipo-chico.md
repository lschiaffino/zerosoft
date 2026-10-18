---
title: "Cero bugs en un equipo chico: triage, plazos y una sola regla"
description: "Cómo adoptar una política de cero bugs con tres a diez personas: una regla de dos salidas, plazos por prioridad, una guardia semanal y la cola de triage de Track para lo que llega por Chat o Flow."
date: "2026-10-18"
author: "zerosoft"
tags: ["track", "bugs", "playbook"]
---

Linear contó en su blog que [trabaja con una política de cero bugs](https://linear.app/now/zero-bugs-policy): cada bug reportado se arregla o se descarta, y ninguno va a parar al backlog. Sus plazos son 48 horas para los de prioridad alta y 7 días para el resto. Para llegar ahí frenaron todo el trabajo de producto durante tres semanas y vaciaron unos 175 bugs abiertos.

La idea es buena y funciona mejor todavía en un equipo chico. Con cinco personas no hay un equipo de QA ni un gerente que reparta tickets, así que el backlog de bugs crece en silencio hasta que un cliente se va. Este post adapta la política a un equipo de tres a diez personas y muestra cómo llevarla en Track con lo que Track hace hoy.

## La regla: cada bug tiene dos salidas

Un bug que entra tiene exactamente dos destinos posibles:

1. **Se arregla**, dentro del plazo de su prioridad.
2. **Se descarta**, con una línea que explique por qué ("pasa solo en Safari 14", "es el comportamiento esperado").

La tercera salida, "lo dejamos para después", queda prohibida. El costo de arreglar un bug casi no cambia si lo hacés hoy o en seis meses. Lo que cambia es cuánto tiempo lo sufre el cliente y cuánto contexto perdiste vos.

## Plazos que un equipo chico puede cumplir

Copiar los plazos de una empresa con decenas de ingenieros es la forma más rápida de abandonar la política en un mes. Proponemos estos, mapeados a las cuatro prioridades de Track:

| Prioridad en Track | Qué significa | Plazo |
|---|---|---|
| Urgente | Algo no anda para todos o se pierden datos | El mismo día |
| Alta | Una función importante falla para algunos clientes | 2 días hábiles |
| Media | Molesta, tiene workaround | 7 días |
| Baja | Cosmético | 7 días, o se descarta |

Track no mide plazos ni avisa cuando se vencen. Lo que sí tiene es la **fecha de vencimiento** de cada issue: cuando aceptás un bug, cargale la fecha que corresponde según la tabla. A partir de ahí, el **Resumen** muestra lo vencido de cada proyecto y **Mis tareas** agrupa lo de cada persona en Vencidas, Hoy, Próximas y Sin fecha. Esa es la alarma.

## Paso 1: un lugar donde caen los bugs

La política se cae si los bugs llegan por cinco canales distintos y alguien tiene que acordarse de pasarlos a mano. En Track, cada proyecto puede activar **Triage para issues externos** desde sus ajustes (pestaña Triage; lo activa un admin). Con el triage prendido, los issues que no crea una persona desde la app esperan en una cola aparte hasta que alguien los acepta. No aparecen en las listas ni en Mis tareas mientras tanto, así que el board del equipo no se llena de ruido.

Lo que entra a esa cola hoy:

- **Chat**: un agente de Agents con la herramienta **Crear issue en Track** puede cargar el bug que reporta un visitante, con sus datos de contacto en la descripción.
- **Flow**: el paso **Track: crear issue** crea un issue desde cualquier flujo. Hay una plantilla, "Bug reportado en el chat → issue en Track", que usa IA para detectar mensajes que reportan un bug y abre un issue de prioridad alta. Con el mismo paso podés convertir en issue lo que llega por un formulario del CRM (disparador "CRM: formulario enviado").

Los bugs que encuentra el propio equipo se cargan desde la app y van directo a la lista, sin pasar por triage. Cada issue en la cola muestra de dónde vino ("Desde Chat", "Desde Flow"), así sabés a quién volver a escribirle.

## Paso 2: una guardia por semana

Alguien tiene que mirar la cola. En un equipo chico, rotá la guardia cada semana entre todos los que escriben código, también los fundadores. Esa persona abre la cola de triage dos veces por día y resuelve cada issue con uno de tres botones:

- **Aceptar en** un estado (por defecto, el primero de la categoría Todo), con prioridad, responsable y fecha de vencimiento.
- **Rechazar**: el issue pasa al estado cancelado del proyecto. Es el "se descarta" de la regla. Dejá la razón en un comentario.
- **Duplicado**: escribís el identificador del original (por ejemplo `ZER-12`), Track lo vincula con una relación "duplica" y cancela el repetido.

Si dos personas resuelven el mismo issue a la vez, Track avisa que otra persona ya lo resolvió, así no se pisan.

La guardia no arregla todo. Decide. Asigna el bug a quien mejor conoce esa parte del código, y si nadie la conoce, se lo queda.

## Paso 3: los bugs primero, todas las mañanas

La costumbre que hace funcionar todo es simple: lo primero del día son tus bugs asignados. Abrí **Mis tareas**, mirá Vencidas y Hoy, y recién después seguí con el trabajo del ciclo.

Para que nadie arme filtros todos los días, guardá una vista en la lista de issues: filtro por prioridad Urgente y Alta, más la etiqueta `bug`, ordenada por prioridad. Las etiquetas son del workspace y se comparten entre proyectos, así que `bug` significa lo mismo en todos lados. Las vistas guardadas son personales; pasale la receta al equipo y que cada uno la guarde.

Con el teclado: `J` y `K` recorren la lista, `Enter` abre el issue y `C` crea uno nuevo.

## Paso 4: que el merge cierre el bug

Si conectás la integración de GitHub (un webhook por workspace, con los repos que elijas), Track vincula cada PR o commit que menciona un identificador en el branch, el título o la descripción. Desde el issue podés **copiar el nombre de branch** sugerido, algo como `zer-123-arreglar-el-login`, y al abrir el PR el issue ya queda vinculado.

En la configuración elegís qué pasa con el estado: mover el issue a En progreso al abrir el PR y a Hecho al mergearlo. En la descripción del PR, solo cuentan para cerrar las menciones precedidas de una palabra clave como `fixes`, `closes`, `arregla` o `resuelve`. Un "bloqueado por ZER-11" vincula sin cerrar.

## Paso 5: la revisión del viernes

Quince minutos, todo el equipo:

1. Mirá el **Resumen**: issues vencidos por proyecto y cuántos esperan triage.
2. Filtrá la lista por la etiqueta `bug` y agrupá mentalmente por responsable. Si alguien tiene más de cuatro o cinco abiertos, redistribuí o sacalo dos días del ciclo para que vacíe su cola.
3. Buscá patrones. Si la mitad de los bugs de la semana son del mismo módulo, eso es un issue de producto, y va al próximo ciclo.
4. Pasá la guardia a la siguiente persona.

Track no tiene un dashboard de bugs por persona; este conteo lo hacés con filtros. Con diez o veinte bugs abiertos alcanza.

## El arranque: vaciar el backlog una vez

Si hoy tenés cuarenta bugs viejos, la política no arranca hasta que los resolvés. Una semana de limpieza suele alcanzar en un equipo chico:

- Seleccioná los bugs viejos en la lista (`X` marca la fila activa, Shift+clic marca un rango) y con la **edición masiva** cambiales estado, prioridad, responsable o etiquetas de una sola vez.
- Los que nadie puede reproducir, a cancelado con un comentario.
- El resto se reparte y se arregla esa semana, sin trabajo nuevo.

## Avisarle al cliente

El cierre del círculo es la parte que más agradece un cliente. Cuando un bug que llegó por Chat pasa a Hecho, respondele en la misma conversación. Hoy ese aviso es manual: Track y Chat todavía no reabren la conversación solos. Si querés automatizar una parte, Flow tiene el disparador "Track: issue cambió de estado", y la plantilla "Issue urgente → Discord" muestra cómo mandar un aviso a un canal del equipo.

## Lo que necesitás y lo que falta

Necesitás un proyecto con triage activado, una etiqueta `bug`, una tabla de plazos que el equipo acepte y una guardia que rote. Todo eso corre en Track, en tu servidor por $0 o en zerosoft Cloud.

Lo que Track todavía no hace: medir plazos de bugs, mostrar un tablero de bugs por persona, ni volver a abrir la conversación de Chat cuando se cierra el issue. Si tu política depende de esas métricas, hoy las vas a llevar a mano.
