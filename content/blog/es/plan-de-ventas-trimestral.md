---
title: "Plan de ventas trimestral: de la meta de ingresos a las reuniones por semana"
description: "Cómo convertir una meta de ingresos en cuotas por persona y en una cantidad de reuniones semanales, con un ejemplo numérico y cómo cargarlo en el CRM de zerosoft."
date: "2026-11-07"
author: "zerosoft"
tags: ["crm", "ventas", "planificación", "playbook"]
---

Una meta de ingresos para el trimestre es un número que nadie puede ejecutar un martes a las diez de la mañana. Lo que sí se puede hacer un martes es agendar una reunión, mandar una propuesta o hacer un seguimiento. El plan de ventas es el trabajo de traducir lo primero en lo segundo.

Pipedrive publica una [guía de siete pasos para armar un plan de ventas](https://www.pipedrive.com/en/blog/sales-plan) con plantilla, y la idea central es partir la meta en objetivos de actividad y objetivos de resultado. Compartimos esa idea. Acá va la versión para un equipo de dos a seis personas, con una cuenta hecha de atrás para adelante y con lo que el CRM de zerosoft guarda y lo que todavía no.

## Paso 1: elegí una sola meta y un período

Una meta, un trimestre. Si hoy tenés tres metas ("crecer, retener, lanzar el producto nuevo"), el plan de ventas toma solo la que se mide en plata cobrada o en deals ganados.

Ejemplo que vamos a usar en todo el post (los números son inventados para mostrar la cuenta, reemplazalos por los tuyos):

- Meta del trimestre: 60.000 USD en valor ganado.
- Vendedores: 2.
- Ticket promedio de tus últimos deals ganados: 4.000 USD.

Si no tenés historia, usá tu mejor estimación y anotá que es una estimación. A la tercera revisión ya tenés datos reales.

## Paso 2: de la plata a los deals

Dividí la meta por el ticket promedio: 60.000 / 4.000 = 15 deals ganados en el trimestre. Eso son 7 u 8 por persona.

Este paso suele corregir la meta sola. Si 15 deals en 13 semanas te parece un número razonable, seguí. Si te parece imposible con dos personas, el problema está en la meta o en el ticket, y es mejor descubrirlo ahora.

## Paso 3: de los deals a las reuniones

Necesitás dos tasas de conversión de tu propio pipeline:

- De reunión a propuesta enviada. Supongamos 50%.
- De propuesta a deal ganado. Supongamos 30%.

Multiplicadas dan 15% de reuniones que terminan en deal. Para 15 deals necesitás 15 / 0,15 = 100 reuniones en el trimestre. En 13 semanas son unas 8 por semana en total, 4 por persona.

Ese "4 por persona por semana" ya es una instrucción que alguien puede seguir. Antes era "vender 30.000 USD".

Para sacar tus tasas reales, abrí los reportes del CRM: la pestaña de embudo muestra cuántos deals pasan de una etapa a la siguiente en el rango que elijas, y la de conversión te da el porcentaje. Usá un rango de seis meses si tenés volumen; con menos de 30 deals el porcentaje se mueve mucho y conviene tomarlo como orientativo. Si todavía no definiste bien las etapas, empezá por las [reglas de higiene del pipeline](/blog/higiene-del-pipeline).

## Paso 4: cargá las cuotas en el CRM

Los números del plan tienen que vivir en algún lugar que el equipo mire. En el CRM de zerosoft, en Ajustes › Cuotas, se carga una cuota por persona, por métrica y por período:

- Métricas: valor ganado (en la moneda base del workspace), deals ganados y reuniones agendadas.
- Períodos: mensual o trimestral, calendario.

Para el ejemplo, cada persona tendría tres cuotas trimestrales: 30.000 de valor ganado, 7 deals ganados y 50 reuniones. El resumen del CRM y los reportes muestran el progreso de cada una y comparan el porcentaje logrado con el esperado a esa altura del período. Si pasó el 40% del trimestre y llevás el 25% de la cuota, aparece como atrasado.

Tres detalles para no llevarte sorpresas:

- El ritmo esperado es lineal. No hay estacionalidad, así que si tu cuarto trimestre cierra fuerte en diciembre, el tablero va a mostrarte atrasado en octubre. Tomalo en cuenta al leerlo.
- Las reuniones cuentan las actividades de tipo reunión del CRM. Las reservas hechas en Cal crean solas una actividad de reunión; las que ocurren por otro lado las tiene que registrar alguien.
- Si un deal tiene participación repartida entre varias personas (splits), cada una suma su porcentaje al valor ganado.

Lo que no hay: cuotas de llamadas, emails o tareas. Pipedrive tiene objetivos de actividad más variados, y si tu plan depende de contar llamadas en frío, hoy tenés que llevar esa cuenta aparte, por ejemplo con un reporte guardado sobre actividades.

## Paso 5: repartí el trabajo por etapa

Con el embudo de arriba, el plan por etapa queda así para todo el equipo:

| Etapa | Cantidad en el trimestre | Por semana |
|---|---|---|
| Reuniones | 100 | 8 |
| Propuestas enviadas | 50 | 4 |
| Deals ganados | 15 | 1 o 2 |

La tabla se pega en el canal del equipo y se revisa cada semana. Si las reuniones van bien y las propuestas no, el cuello de botella no es la prospección. Hay que mirar por qué las reuniones no avanzan, y los motivos de pérdida de los reportes ayudan a contestarlo.

## Paso 6: sumá un colchón de seguimiento

Los deals no se cierran en orden de llegada. Un deal que entra en la semana 11 probablemente cierre en el trimestre siguiente. Por eso conviene que el pipeline cubra la meta más de una vez antes de que el trimestre esté avanzado. Una regla práctica: al cumplir la mitad del trimestre, el monto abierto en etapas de propuesta o más avanzadas debería ser al menos el doble de lo que falta ganar. Es una regla nuestra, no un estándar de la industria, y la podés ajustar con tu historia.

Para chequearlo, el forecast del CRM suma los deals abiertos según su categoría. Cómo configurarlo está en [el post sobre forecast para equipos chicos](/blog/forecast-de-ventas-para-un-equipo-chico).

## Paso 7: revisá cada semana y reescribí cada trimestre

Un plan sin revisión es un documento más. Reservá 30 minutos fijos (la [revisión semanal del CRM](/blog/revision-semanal-del-crm) sirve de agenda) y respondé tres preguntas con el tablero abierto:

1. ¿Estamos por encima o por debajo del ritmo esperado en cada cuota?
2. ¿Qué etapa está acumulando deals?
3. ¿Qué cambia esta semana?

Al cerrar el trimestre, recalculá el ticket y las tasas con los datos reales y armá el siguiente. El objetivo del primer plan es tener una base; el del tercero ya se parece a una predicción.

## Dónde vive el plan

Todo lo anterior funciona en una planilla. La diferencia de tenerlo en el CRM es que el avance se calcula solo con los deals y reuniones que ya cargaste, sin que nadie copie números a una hoja el viernes. Y como zerosoft es AGPL y se puede hostear por tu cuenta, el historial de tus cuotas y de tus deals queda en tu base de datos, exportable a CSV o JSON cuando quieras. Si venís de Pipedrive, la [guía de migración](/blog/migrar-de-pipedrive-a-crm) cubre cómo traer tus deals; las cuotas y objetivos hay que cargarlos de nuevo a mano, porque no se importan.
