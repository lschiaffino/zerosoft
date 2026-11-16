# Apps nuevas

Estado de las apps nuevas que lanza el agente diario de "gauntlet loop" (foco: software nuevo, de a una app).
Orden decidido por el dueño: **Send** (DocSend) → **Time** (Harvest) → **Mail** (email marketing tipo Mailchimp) →
**Sites** (constructor de sitios).

No son apps nuevas sino funciones de apps que ya existen: tickets y SLA en Chat; suscripciones en Books; turnos en
People; stock y compras en Shop + Books.

Cada app tiene su tabla de paridad en `content/feature-parity/<app>.ts` y su benchmark en `docs/benchmark/<app>.md`.

## Send (DocSend): lanzada

- Estado: disponible para todos (sin `coming_soon` en `lib/products.ts`).
- Paridad: `content/feature-parity/send.ts` (revisada el 2026-11-15). Las filas que faltan las avanza el agente de
  paridad, no este.

## Time (Harvest): en vista previa interna

- Estado: `status: 'coming_soon'` en `lib/products.ts`. Solo el staff (ADMIN_EMAILS) la abre; el resto ve la lista
  de espera.
- Primer corte (2026-11-15): cronómetro y carga a mano (1:30, 1,5, 90m), vista del día con la semana arriba,
  proyectos con cliente, código, tarifa por hora y presupuesto en horas, tareas del workspace (cinco por defecto),
  archivar y borrar, reportes por proyecto, cliente, tarea o persona con monto facturable y CSV, ajustes de tareas,
  clientes y moneda, Cmd+K de proyectos y operaciones en el MCP.
- Permisos: cada persona carga, edita y borra solo sus entradas. Dueños y admins manejan clientes, proyectos, tareas
  y moneda, y ven las horas de todos en los reportes. Un miembro ve solo las suyas. Guests no entran.
- Código: `lib/time/`, `app/api/time/`, `lib/routes/time/`, `components/time/`, `app/[locale]/app/time/`,
  `styles/time.css`, `messages/<locale>/time.json`. Migración `20261115_1940_time`.
- Tests: `tests/unit/time.test.ts`, `tests/e2e/time.spec.ts`, caso "Time projects" en `tests/e2e/app-smoke.spec.ts`.

### Próximos pasos (en este orden)

1. Hoja semanal en grilla (proyecto/tarea por fila, horas por día, editable), como la vista Week de Harvest.
2. Asignar personas a proyectos y tareas por proyecto (hoy todos ven todos los proyectos y las tareas son del
   workspace).
3. Aprobación de horas (enviar la semana, aprobar o devolver) y que un admin edite las horas de otra persona.
4. Tarifas por persona y por tarea, presupuesto en dinero y aviso al pasar un porcentaje del presupuesto.
5. Recordatorios para cargar horas y aviso de cronómetro olvidado.
6. Facturar horas con Books (horas sin facturar → factura) y gastos.
7. Importar desde Harvest (CSV de entradas y de proyectos) y API pública (`/api/v1/time`).
8. Con 1 a 4 hechos, sacar `coming_soon` y anunciarla.

## Mail (email marketing): sin empezar

## Sites (constructor de sitios): sin empezar
