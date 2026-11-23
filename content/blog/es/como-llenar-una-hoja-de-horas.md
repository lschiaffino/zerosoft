---
title: "Cómo llenar una hoja de horas para que alguien la pueda usar"
description: "Qué anotar, cada cuánto y con qué nivel de detalle: un formato de hoja semanal, reglas para las notas, ejemplos de entradas buenas y malas, y cómo se arma en Time, la app de horas de zerosoft, incluido lo que todavía no hace."
date: "2026-11-23"
author: "zerosoft"
tags: ["time", "harvest", "hojas de horas"]
---

Harvest publicó una [guía sobre cómo escribir una hoja de horas](https://www.getharvest.com/blog/how-do-you-write-a-timesheet), pensada para empresas medianas que tienen que elegir formato, definir el período de pago y conseguir aprobaciones. Si sos un equipo de tres a quince personas que cobra por hora o quiere saber en qué se va la semana, el problema es más chico y más práctico: qué anotar para que la hoja sirva de verdad cuando la abra alguien que no estuvo.

Este post propone un formato, reglas para las notas y una rutina semanal. Al final, cómo se arma en Time, la app de horas de zerosoft, y qué todavía no tiene.

## Una hoja de horas responde cuatro preguntas

Antes del formato, la función. Una hoja sirve si, abierta seis meses después, contesta:

1. **Quién** trabajó.
2. **Para qué cliente o proyecto**.
3. **En qué tipo de trabajo** (diseño, desarrollo, reunión, administración).
4. **Cuánto**, y si se puede facturar.

Todo lo demás es opcional. Si tu hoja contesta esas cuatro cosas, ya supera a la mayoría de las planillas que circulan por ahí.

## El formato mínimo: una fila por proyecto y tarea

La estructura que mejor aguanta es una grilla semanal. Cada fila es un proyecto con una tarea, cada columna es un día, y al final van los totales:

| Proyecto y tarea | Lun | Mar | Mié | Jue | Vie | Total |
|---|---|---|---|---|---|---|
| Sitio Rivera, diseño | 3:00 | 2:30 | | 1:00 | | 6:30 |
| Sitio Rivera, desarrollo | | 3:00 | 5:00 | 4:00 | 2:00 | 14:00 |
| Interno, reuniones | 1:00 | 0:30 | 1:00 | | 1:00 | 3:30 |
| Total | 4:00 | 6:00 | 6:00 | 5:00 | 3:00 | 24:00 |

Dos decisiones que conviene tomar una vez y no repetir:

- **Tareas cortas y fijas.** Cinco a ocho tipos de tarea para todo el equipo. Si cada persona inventa las suyas, los reportes por tarea no se pueden comparar.
- **Lo interno también va.** Reuniones, administración y capacitación tienen su propio proyecto, marcado como no facturable. Si no se anota, las horas facturables parecen más eficientes de lo que son y el costo real de un cliente queda subestimado.

## Cada cuánto se carga

Hay tres hábitos posibles y los tres funcionan distinto:

- **Con cronómetro, al momento.** Es la más precisa y la que más se olvida: arrancás el cronómetro, te interrumpen, pasan dos horas.
- **Al final del día, diez minutos.** El punto medio. Todavía te acordás de qué hiciste, y es corto para que no pese.
- **El viernes, de memoria.** La menos confiable. Las horas se redondean hacia lo que "debería" haber pasado y los lunes largos desaparecen.

Para un equipo chico, la regla que mejor aguanta es: **cargar al final de cada día y revisar la semana el viernes**. El cronómetro queda para el trabajo que hacés de corrido y que se factura al minuto.

## Cómo escribir las notas

La nota es lo que convierte una hora en una explicación. Compará:

| Nota débil | Nota útil |
|---|---|
| "Trabajo en el sitio" | "Maqueta de la home en móvil, ajustes del menú" |
| "Reunión" | "Llamada con Rivera: definen alcance de la tienda" |
| "Varios" | "Responder 12 mails de soporte y corregir el formulario de contacto" |
| "Arreglos" | "Bug del carrito: el cupón se aplicaba dos veces" |

Una regla que sirve: **verbo más objeto**. Si la persona que factura tiene que preguntarte qué quisiste decir, la nota falló. Dos o tres líneas alcanzan; no hace falta un diario.

## Cómo anotar la duración

Elegí un formato y mantenelo. En decimales (1.5) o en horas y minutos (1:30), pero no mezclando dentro de un mismo reporte sin avisar. Sobre el redondeo, decidilo por escrito: si redondeás, que sea siempre igual, y si no redondeás, que lo diga la política. Lo peor es que cada persona redondee a su criterio.

## La rutina semanal en cinco pasos

1. **Lunes**: abrí la semana nueva y copiá las filas de la anterior, para no armar la grilla de cero.
2. **Cada día**: anotá horas y una nota por entrada, al terminar la jornada.
3. **Viernes por la tarde**: revisá los totales. ¿Algún día queda vacío? ¿Hay una fila con notas flojas?
4. **Viernes**: si tu equipo aprueba horas, enviá la semana.
5. **Primer día hábil del mes**: exportá el mes y compará con lo que se facturó.

## Cómo se arma esto en Time

Time es la app de horas de zerosoft. Una aclaración primero: en el sitio figura como "Próximamente". El código está en el repositorio, pero todavía no es una app que cualquier workspace pueda abrir desde el catálogo. Lo que sigue describe lo que ya hace el código y lo que no.

**Lo que hace:**

- **Cronómetro y carga a mano.** Un cronómetro por persona (arrancar otro frena el primero) y duraciones escritas como `1:30`, `1.5`, `1,5`, `90m` o `1h 30m`, hasta 24 horas por entrada.
- **Vista del día y hoja semanal en grilla**, con una fila por proyecto y tarea, totales por fila, por día y por semana, y un botón para copiar las filas de la última semana con horas. La semana va de lunes a domingo.
- **Notas en cada entrada**, de hasta 2000 caracteres. Se escriben en la vista del día.
- **Proyectos con cliente, código, tarifa por hora y presupuesto en horas.** Cada proyecto puede tener un equipo propio y sus propias tareas, cada una facturable o no en ese proyecto.
- **Aprobación de semanas.** La persona envía su semana y sus horas quedan trabadas. Dueños y admins la aprueban o la devuelven con una nota. Mientras está pendiente, la persona puede retirarla.
- **Reportes** por proyecto, cliente, tarea o persona, con horas, horas facturables y monto, y exportación a CSV con fecha, persona, cliente, proyecto, tarea, notas, horas, facturable y monto. Un miembro ve solo sus horas.
- **Atajos de teclado**: `N` abre una entrada nueva.
- Corre en tu servidor, con tus datos en tu base.

**Lo que todavía no hace**, y conviene saberlo antes de adoptarlo:

- Hora de inicio y de fin de cada entrada: se carga la duración.
- Recordatorios para que la gente cargue sus horas.
- Facturas desde las horas, gastos y pagos.
- Tarifas por persona o por tarea, y avisos de presupuesto.
- Editar las horas de otra persona (hoy cada uno edita las suyas).
- API pública y apps de teléfono o escritorio. Funciona en el navegador del teléfono.
- Importar desde Harvest.

Si hoy necesitás facturar desde las horas o mandar recordatorios automáticos, Harvest lo hace y Time no. Si lo que buscás es una hoja ordenada, aprobaciones y un CSV que podés abrir en cualquier planilla, el recorrido de arriba ya está.

## Plantilla para copiar

Si por ahora llevás las horas en una planilla, esta estructura cubre lo esencial. Una fila por entrada:

```
fecha | persona | cliente | proyecto | tarea | notas | horas | facturable
2026-11-18 | Lucía | Rivera | Sitio | Diseño | Maqueta de la home en móvil | 3.00 | sí
```

Es el mismo orden que usa el CSV de Time, así que si más adelante migrás, las columnas ya coinciden.

## El resumen en una tarjeta

- Una hoja responde cuatro cosas: quién, para quién, en qué tipo de trabajo y cuánto.
- Una fila por proyecto y tarea; cinco a ocho tareas fijas; lo interno también se anota.
- Cargá al final de cada día y revisá el viernes.
- Notas con verbo y objeto, no "varios".
- Un formato de duración y una política de redondeo, por escrito.
- Time hace la hoja, las aprobaciones y el CSV. Todavía no factura, no recuerda y no registra hora de inicio y fin.
