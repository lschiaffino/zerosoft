---
title: "La revisión semanal del CRM en 30 minutos"
description: "Una rutina semanal para equipos de ventas chicos: un panel, algunas vistas guardadas, dos listas dinámicas y un reporte que rota. Qué mirar, en qué orden y qué hacer con lo que encontrás."
date: "2026-09-06"
author: "zerosoft"
tags: ["crm", "reportes", "playbook"]
---

La mayoría de los equipos mira su CRM en dos modos: a las apuradas, el día antes de una reunión de directorio, y nunca, el resto del tiempo. Ninguno funciona. El primero produce números en los que nadie confía; el segundo produce un CRM que nadie actualiza, que es justamente cómo terminás en el primero.

La solución es aburrida y efectiva: treinta minutos, una vez por semana, mismo día, con una agenda que no cambia. Esta es la que correríamos nosotros, armada sobre lo que zerosoft CRM tiene de verdad: paneles, reportes, vistas guardadas y listas dinámicas.

## Armalo una vez (unos 20 minutos)

La revisión dura 30 minutos solo si no construís nada durante la revisión. Hacé esto una sola vez.

### Un panel "Revisión semanal"

En `/app/crm/dashboards`, creá un panel y agregá estos widgets:

- **KPI** ×4: nuevos contactos, nuevos deals, monto ganado y actividades. Cada widget de KPI elige una métrica, un pipeline opcional y un rango (7 días, 30 días, 90 días, trimestre o 12 meses). Para una revisión semanal, usá 7 días.
- **Forecast ponderado**: el pipeline abierto ponderado por la probabilidad de cada etapa.
- **Embudo del pipeline**: cuántos deals hay en cada etapa.
- **Ganados vs perdidos**: la tendencia por mes.
- **Tareas abiertas** y **Ranking de actividad**: quién está haciendo el trabajo y qué está pendiente.

Nueve widgets, una pantalla. Podés tener varios paneles (uno por pipeline, por ejemplo), pero para la revisión semanal alcanza con uno.

### Tres vistas guardadas de deals

Desde la tabla de deals, con los filtros avanzados, guardá:

1. **Fecha de cierre vencida**: fecha de cierre antes de hoy, etapa no es Cerrado ganado, etapa no es Cerrado perdido.
2. **Sin monto**: ordenado por monto, ascendente.
3. **Míos, abiertos**: owner sos vos, etapa no es Cerrado ganado, etapa no es Cerrado perdido.

Una aclaración: las fechas de los filtros son absolutas, no "hoy" en sentido relativo. Actualizá la fecha de la primera vista cada semana; son cinco segundos.

### Dos listas dinámicas

En `/app/crm/lists`, creá dos listas **dinámicas**. Una lista dinámica es un filtro que se recalcula cada vez que la abrís:

- **Leads sin tocar**: estado del lead = Nuevo.
- **Mal momento**: estado del lead = Mal momento.

La primera es tu cola de triage. La segunda es la pila de gente que dijo "ahora no", que es el pipeline más barato que vas a tener en tu vida.

## La agenda

Mismo orden todas las semanas. Poné un timer si hace falta.

### Minutos 0–5: los números

Abrí el panel. Leé los cuatro KPI en voz alta. Cada uno muestra la variación contra el período anterior del mismo largo, así que el "monto ganado" de los últimos 7 días viene con su comparación contra los 7 días previos.

Todavía no discutan. Solo anotá lo que sorprenda: una caída en actividades, un pico de contactos nuevos, una semana con cero ganados. Esas son las preguntas para el resto de la reunión.

### Minutos 5–15: el tablero

Este es el corazón. Abrí el tablero de deals y recorrelo de izquierda a derecha.

- **Badges de "Sin actividad en N días".** Todo deal abierto sin actividad en más de 14 días queda marcado en su tarjeta. Para cada uno, el owner dice una oración: qué sigue y cuándo. Si no hay respuesta, se cierra como perdido (con motivo) antes de que termine la reunión.
- **Vista de fecha vencida.** Para cada deal: nueva fecha con motivo, nueva etapa, o se cierra.
- **Vista sin monto.** Completalos, o admití que no sabés lo suficiente como para llamarlo deal.

Diez minutos pasan volando. Si el tablero es demasiado grande para recorrerlo en diez minutos, ese es el hallazgo: tenés demasiados deals abiertos para el tamaño de tu equipo.

### Minutos 15–20: tareas

Abrí `/app/crm/tasks` y mirá **Vencidas**, filtrado por owner. Sin escrachar a nadie: se reprograma o se cierra. Una tarea vencida hace dos semanas es una tarea que nadie va a hacer. Borrala o convertila en una decisión.

### Minutos 20–25: listas

Abrí las dos listas dinámicas. La cantidad de miembros está ahí mismo, en la página de listas.

- **Leads sin tocar** debería estar cerca de cero. Si crece semana a semana, los leads entran más rápido de lo que los trabajás. Asignalos ahora, o cambiá cómo calificás.
- **Mal momento**: elegí tres personas que dijeron "ahora no" hace más de un trimestre y asignales una tarea de seguimiento. Tres por semana son 150 por año.

### Minutos 25–30: un reporte, rotando

`/app/crm/reports` tiene siete vistas: Resumen, Embudo, Forecast, Orígenes, Responsables, Actividad y Conversión. Cada una toma un rango (7d, 30d, 90d, trimestre, 12m), un agrupamiento (día, semana, mes, trimestre) y filtros por pipeline, origen, prioridad y owner. No las mires todas cada semana; rotalas:

- **Semana 1, Embudo.** Conversión de etapa a etapa. ¿Dónde está la caída más grande? Ese es el foco del mes que viene.
- **Semana 2, Orígenes.** Contactos, deals y monto por origen. ¿El canal que trae más leads es también el que trae más pipeline?
- **Semana 3, Resumen.** Motivos de pérdida, ganados vs perdidos, días promedio al cierre. Si "No respondió más" encabeza los motivos de pérdida, el problema es tu seguimiento, no tu pitch.
- **Semana 4, Conversión y Responsables.** Ganados dividido creados en el período, comparado con el período anterior, y el desglose por owner: ganados, perdidos, win rate y actividades completadas. Usalo para ver quién necesita ayuda, no para armar un ranking.

Cuando una configuración de reporte te sirve, guardala con **Guardar reporte** y el mes que viene es un clic.

## Lo que esta revisión no es

No es una llamada de forecast con el CEO. No es una sesión de coaching. No es donde rediseñás el pipeline. Si aparece alguna de esas cosas, anotala y agendala aparte. La revisión funciona porque es corta y predecible.

Dos límites honestos:

- **Los reportes no convierten monedas.** Los montos se suman en una sola moneda por reporte. Si vendés en varias, filtrá por pipeline o tenelo en cuenta al leer los totales.
- **No hay reportes programados por email.** Nadie recibe un PDF el lunes a la mañana. La revisión es el mecanismo de entrega.

## Por qué funciona

Una revisión semanal no se trata de los números. Se trata de que todos saben que el lunes a las 10 sus deals van a estar en pantalla. Esa presión chiquita y predecible es lo que hace que la gente registre la llamada el jueves en vez de "después".

Treinta minutos por semana son dos horas por mes. Es la herramienta de ventas más barata que vas a comprar, y ya la tenés.
