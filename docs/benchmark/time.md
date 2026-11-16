# Benchmark: Time contra Harvest

Leído el 2026-11-15. Base de `content/feature-parity/time.ts`. Cada fila de paridad sale de una de estas capacidades.

## Fuentes

- Centro de ayuda, navegación (proyectos, tareas, tarifas facturables): https://support.getharvest.com/hc/articles/44165229587469-Navigating-Harvest
- Guía de inicio (proyecto con equipo, tareas, tarifas y presupuesto; perfil con permisos, capacidad y tarifas de costo): https://support.getharvest.com/hc/en-us/articles/4411239395341
- Videos básicos (aprobación de horas, vista del día, tarifas facturables): https://support.getharvest.com/hc/en-us/sections/28680140385421-Harvest-basics-videos
- API v2, entradas de horas (`/v2/time_entries`, `is_running`, `timer_started_at`, `/stop`, modo por duración o por hora de inicio y fin): https://help.getharvest.com/api-v2/timesheets-api/timesheets/time-entries/
- Funciones de registro de horas: https://www.getharvest.com/features/time-tracking-software
- Precios (Free con 1 usuario y 2 proyectos; los planes pagos cambiaron en 2026): https://www.timecamp.com/blog/harvest-pricing.md, https://www.teamwork.com/blog/harvest-alternatives/, https://toolradar.com/tools/harvest/pricing

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
