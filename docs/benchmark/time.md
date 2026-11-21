# Benchmark: Time contra Harvest

Leído el 2026-11-15. Base de `content/feature-parity/time.ts`. Cada fila de paridad sale de una de estas capacidades.

## Fuentes

- Centro de ayuda, navegación (proyectos, tareas, tarifas facturables): https://support.getharvest.com/hc/articles/44165229587469-Navigating-Harvest
- Guía de inicio (proyecto con equipo, tareas, tarifas y presupuesto; perfil con permisos, capacidad y tarifas de costo): https://support.getharvest.com/hc/en-us/articles/4411239395341
- Videos básicos (aprobación de horas, vista del día, tarifas facturables): https://support.getharvest.com/hc/en-us/sections/28680140385421-Harvest-basics-videos
- API v2, entradas de horas (`/v2/time_entries`, `is_running`, `timer_started_at`, `/stop`, modo por duración o por hora de inicio y fin): https://help.getharvest.com/api-v2/timesheets-api/timesheets/time-entries/
- Funciones de registro de horas: https://www.getharvest.com/features/time-tracking-software
- Precios (Free con 1 usuario y 2 proyectos; los planes pagos cambiaron en 2026): https://www.timecamp.com/blog/harvest-pricing.md, https://www.teamwork.com/blog/harvest-alternatives/, https://toolradar.com/tools/harvest/pricing

- Vista Week (agregar fila con N, copiar las filas de la última hoja, las filas se copian solas, sin notas en la semana): https://support.getharvest.com/hc/en-us/articles/360048687531

## Fuentes que fallaron

getharvest.com, help.getharvest.com y support.getharvest.com no resuelven desde el sandbox (red limitada). Lo de arriba se leyó por los resultados del buscador. La página de precios oficial no se pudo leer: el sitio no cita un precio pago y remite a getharvest.com/pricing.

## Modelo de Harvest (lo que copiamos)

- Una entrada de horas: persona, día (`spent_date`), proyecto, tarea, notas, horas, facturable, y un cronómetro (`is_running`, `timer_started_at`).
- Proyecto con cliente, código, facturable, tarifa (por proyecto, por persona o por tarea) y presupuesto (horas o dinero, total o por tarea).
- Tareas facturables o no; en Harvest se asignan a cada proyecto.
- Roles: miembro, manager y administrador. Aprobaciones de horas en el plan más alto.
- Reportes por cliente, proyecto, tarea y equipo; exportación; facturas desde las horas.

## Lo que hicimos en el primer corte

Cronómetro y carga a mano, vista del día con la semana arriba, proyectos con cliente, código, tarifa y presupuesto en horas, tareas del workspace, archivar, reportes agrupados con monto facturable y CSV. El resto queda como `missing` en la tabla.

## Segundo corte (2026-11-16)

Hoja semanal en grilla como la vista Week de Harvest: filas por proyecto y tarea, celdas por día, totales, agregar y quitar filas y copiar las filas de la última hoja. Diferencias: las filas no se copian solas a una semana nueva (hay que pedirlo) y una fila sin horas no queda guardada.

## Tercer corte (2026-11-19): equipo y tareas por proyecto

Fuentes (leídas por el buscador; los dominios de Harvest siguen sin resolver desde el sandbox):

- API v2, asignaciones de tareas de un proyecto (cada una con `billable` y `hourly_rate`; una tarea con horas se archiva en vez de borrarse): https://help.getharvest.com/api-v2/projects-api/projects/task-assignments/
- Tarifas por persona o por tarea (un proyecto no mezcla tipos de tarifa): https://support.getharvest.com/hc/en-us/articles/360052713051
- Sumar personas y asignarlas a proyectos ("Assign to all projects" al invitar): https://support.getharvest.com/hc/en-us/articles/360048181732
- Asignar personas a varios proyectos a la vez: https://www.getharvest.com/it/blog/save-time-now-bulk-assign-teammates-to-projects

Lo que hicimos: cada proyecto tiene Equipo (todas las personas con Time, o solo las elegidas) y Tareas (todas
las del workspace, o solo las elegidas, cada una facturable o no en ese proyecto). Un miembro ve y carga solo en
sus proyectos; un admin ve todos y carga, como en Harvest, solo donde está en el equipo. Diferencias: no hay
manager de proyecto, ni tarifa ni presupuesto por persona o tarea, ni asignación en lote desde la ficha de la
persona. Los proyectos que ya existían quedan abiertos a todos con todas las tareas.

## Cuarto corte (2026-11-20): aprobación de horas

Fuentes (por el buscador):

- Enviar y aprobar hojas de horas ("Submit week for approval", aprobar desde la lista, aprobar traba toda la semana): https://support.getharvest.com/hc/en-us/articles/360048181832
- Lo que ve un miembro al enviar (botón en Time > Timesheet, confirmación, rango a elección): https://support.getharvest.com/hc/en-us/articles/360048687011
- Aprobación flexible (retirar la aprobación desde la vista Día o Semana destraba la semana entera): https://support.getharvest.com/hc/articles/39974542812429-Flexible-timesheet-approval
- Sección de ayuda: https://support.getharvest.com/hc/en-us/sections/360010207831-Approving-time-expenses

Lo que hicimos: la persona envía su semana desde la hoja (con horas y sin cronómetro corriendo) y sus entradas
quedan trabadas; mientras está pendiente la puede retirar (en Harvest la tiene que destrabar un admin). Dueños y
admins reciben un aviso, la ven en Aprobaciones (pendientes, aprobadas, devueltas), miran sus entradas y la
aprueban o la devuelven con una nota; una aprobada se reabre (queda devuelta). La persona ve la nota en su hoja y
en Aprobaciones ve sus semanas. Diferencias: aprueban solo dueños y admins (Harvest suma managers de proyecto),
se envía de a una semana (Harvest deja elegir un rango), no hay gastos que aprobar y quien administra todavía no
edita las horas de otra persona.
