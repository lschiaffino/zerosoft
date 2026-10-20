---
title: "Workflows del CRM que crean las tareas de seguimiento"
description: "Cómo usar los workflows del CRM de zerosoft para crear tareas de seguimiento automáticas: triggers y acciones reales, cinco recetas para equipos chicos y sus límites."
date: "2026-08-08"
author: "zerosoft"
tags: ["crm", "workflows", "automatización"]
---

Los deals casi nunca mueren porque alguien dijo que no. Mueren porque nadie hizo el seguimiento. La propuesta salió un martes, la semana se complicó y cuando alguien se acordó, el prospecto ya había firmado con otro que sí se acordó.

La solución no es disciplina. Es que el seguimiento exista antes de que alguien tenga que pensarlo. Para eso están los workflows de zerosoft CRM, y lo más útil que hacen es aburrido: crear una tarea, con fecha, pegada al registro correcto.

## Las piezas

Un workflow vive en `/app/crm/workflows` y tiene tres partes: un nombre, uno o más **triggers** y una o más **acciones**. Crear, editar, activar, correr y borrar workflows es **solo para admins**: es configuración compartida de todo el workspace y no querés que cada miembro ande cableando automatizaciones.

Los triggers que existen hoy:

- **Contacto creado**, **Contacto actualizado**
- **Deal creado**, **Deal actualizado**
- **Etapa cambiada** (opcionalmente solo desde una etapa y/o hacia una etapa)
- **Deal ganado**, **Deal perdido**
- **Tarea vencida**
- **Email recibido**
- **Manual**

Y las acciones:

- **Crear tarea**
- **Crear actividad** (una nota, llamada, reunión o email en el timeline)
- **Enviar email**
- **Actualizar campo** (estándar o custom)
- **Agregar a lista** (listas estáticas)
- **Webhook**
- **Notificar usuario** (una notificación dentro de la app)

Un workflow puede tener hasta 10 triggers (cualquiera lo dispara) y hasta 20 acciones, que corren en orden. Cada ejecución queda registrada en el historial del workflow con su estado, así que cuando algo no pasó, ves por qué en vez de adivinar.

## Cómo se comporta "Crear tarea"

Es la acción que más vas a usar, así que conviene saber exactamente qué hace:

- **Asunto**: el título de la tarea. Es texto literal; los placeholders no se reemplazan en el asunto de las tareas.
- **Vence en días**: cuántos días desde ahora. Si lo dejás vacío, es 1.
- **Owner ID**: opcional. Si lo dejás vacío, la tarea se crea sin owner.
- **Las asociaciones vienen solas.** Si el trigger fue un deal, la tarea queda pegada a ese deal, al primer contacto del deal y a la empresa de ese contacto. Si fue un contacto, queda pegada al contacto y a su empresa. La tarea aparece en el timeline del registro, en el banner de "próxima tarea" de la página de detalle y en `/app/crm/tasks` bajo Vencidas, Hoy o Próximas.

## Cinco recetas para un equipo chico

### 1. Cada lead nuevo recibe un primer contacto

- Trigger: **Contacto creado**
- Acción: **Crear tarea**, asunto "Primera llamada", vence en 1 día

La más simple y la que más rápido rinde. Cada contacto nuevo, venga de la API o de alguien que lo cargó a mano, tiene una tarea con fecha. Ojo: los imports por CSV también crean contactos. Apagala antes de importar unos miles de filas, salvo que quieras unos miles de tareas.

### 2. Propuesta enviada → perseguila en tres días

- Trigger: **Etapa cambiada**, hacia la etapa "Propuesta enviada"
- Acción: **Crear tarea**, asunto "Seguimiento de propuesta", vence en 3 días

El filtro de etapa pide el ID de la etapa, no su nombre. La forma más rápida de sacarlo es `GET /api/v1/crm/pipelines` con tu API key, que lista cada pipeline con sus etapas. Sí, pegar un ID es tosco; está en nuestra lista.

### 3. Un deal perdido puede volver

- Trigger: **Deal perdido**
- Acción: **Crear tarea**, asunto "Volver a contactar", vence en 90 días

Perder por timing o por presupuesto no es lo mismo que perder por fit. Una tarea a tres meses no cuesta nada y convierte algunos "no" en "todavía no". zerosoft ya te pide un motivo de pérdida cuando cerrás un deal como perdido, así que quien recibe la tarea tiene el contexto.

### 4. Ganado → arrancá el onboarding

- Trigger: **Deal ganado**
- Acciones: **Crear tarea** "Mandar kickoff de onboarding", vence en 1 día, y después **Notificar usuario** con un mensaje tipo `Cerramos {{deal.name}} por {{deal.amount}} {{deal.currency}}`

Los mensajes de notificación y los emails sí soportan placeholders: `{{contact.firstName}}`, `{{contact.fullName}}`, `{{contact.email}}`, `{{company.name}}`, `{{deal.name}}`, `{{deal.amount}}`, `{{deal.currency}}` y campos custom como `{{contact.custom.tu_clave}}`.

### 5. Una tarea se venció → que haga ruido

- Trigger: **Tarea vencida**
- Acción: **Notificar usuario**, mensaje `Tarea vencida de {{contact.fullName}}`

**Tarea vencida** se dispara una vez por tarea, cuando pasa su fecha y sigue abierta. Si cambiás la fecha, se vuelve a armar. Lo mueven los endpoints programados `/api/cron/minute` y `/api/cron/tick`: en nuestra nube corre cada minuto; si hosteás vos, apuntá cualquier cron a uno de los dos con tu `CRON_SECRET` como Bearer token, o este trigger nunca se dispara.

## Los límites, sin vueltas

Los workflows son simples a propósito. Antes de montar tu proceso encima, sabé lo que no hacen:

- **Ramas simples.** Cuando escribimos este post no había condiciones. Hoy hay una acción de rama sí/no sobre una propiedad (por ejemplo, "monto > 10.000"); las acciones siguientes corren en una rama o en la otra.
- **"Actualizado" es cualquier actualización.** "Deal actualizado" y "Contacto actualizado" se disparan con cada edición, incluso las mínimas. Combinarlos con "Crear tarea" es una gran forma de enterrar a tu equipo. Preferí triggers específicos (cambio de etapa, ganado, perdido).
- **"Email recibido" depende del sync de Gmail,** que hoy corre solo desde el cron de cada hora (y con "Sincronizar ahora").
- **No hay esperas.** "Vence en N días" pone la fecha de la tarea; el workflow corre en el momento. Para esperar, usá Flow.
- **Las ejecuciones manuales no tienen registro asociado.** "Ejecutar ahora" sirve para probar un email o un webhook; una tarea creada así no queda pegada a nada.
- **Protección contra loops.** Una acción como "Actualizar campo" puede disparar otros workflows, pero un workflow nunca se vuelve a correr dentro de la misma cadena y las cadenas cortan a los tres niveles. No podés armar un loop infinito; tampoco una cascada de 10 pasos.

## Un set inicial sensato

Si lo configurás hoy, arrancá por las recetas 2 y 3. Cubren los dos momentos donde más se pierden deals: el silencio después de una propuesta y la calma después de una pérdida. Sumá la 1 si los leads entran más rápido de lo que podés clasificarlos. Sumá la 5 cuando la gente realmente trabaje desde la lista de tareas.

Después dejalo quieto un mes y mirá el historial de ejecuciones. Si un workflow sigue creando tareas que nadie completa, es ruido. Apagalo. El objetivo no es tener más tareas. Es que el seguimiento correcto ya exista cuando alguien abre el CRM el lunes.
