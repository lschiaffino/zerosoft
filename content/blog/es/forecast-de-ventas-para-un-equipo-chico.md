---
title: "Cómo armar un forecast de ventas que un equipo chico pueda defender"
description: "Categorías, cuotas y envíos por persona: cómo pasar de un pipeline lleno de deals a un número mensual en el que podés confiar, con ejemplos en zerosoft CRM."
date: "2026-11-05"
author: "zerosoft"
tags: ["crm", "ventas", "forecast", "playbook"]
---

El 28 del mes alguien pregunta cuánto vamos a cerrar y la respuesta sale de la intuición de quien esté más cerca del teclado. A veces acierta. Cuando no, aparece el monto que "estaba casi cerrado" y nunca se firmó.

Un forecast sirve para dejar de adivinar: pone por escrito, con reglas fijas, qué creemos que va a pasar, y después se compara con lo que pasó. Pipedrive [describe su herramienta](https://www.pipedrive.com/en/features/sales-forecasting-software) como una proyección que combina datos históricos, ventas actuales y el pipeline en vivo. Para un equipo de tres a ocho personas con poco historial, la parte útil es otra: reglas simples y un número que cada vendedor firma.

Esto es lo que usaríamos nosotros, y cómo se arma con lo que zerosoft CRM hace hoy.

## Paso 1: separá lo que pasó de lo que esperás

Un forecast mezcla tres cosas distintas y conviene no sumarlas a ciegas:

- **Ganado:** deals cerrados en el período. Es un hecho.
- **Abierto con compromiso:** deals que el vendedor aseguraría.
- **Abierto con esperanza:** deals que podrían cerrar si todo sale bien.

En zerosoft CRM esas capas se llaman Ganado, Commit, Best case y Pipeline. Los deals abiertos cuentan en el período de su fecha de cierre, y los ganados en el período en que se cerraron. Los perdidos no entran.

La cuenta más honesta para el mes es Ganado más Commit. El tablero la muestra como "lo más probable". Best case y Pipeline son el margen de upside, no el plan.

## Paso 2: definí qué es "commit" antes de la reunión

Si cada vendedor decide commit con su humor del día, el forecast mide el humor. Dejá escrito un criterio. Un ejemplo para un equipo B2B de ticket medio:

1. Hubo una propuesta enviada y el comprador la abrió.
2. Hay fecha de cierre dentro del período.
3. Sabemos quién firma y esa persona respondió en los últimos siete días.

Si falta una de las tres, el deal es Best case aunque guste mucho.

En el CRM, la categoría sale por defecto de la probabilidad de la etapa: 70% o más es commit, 40% o más es best case, el resto es pipeline. Por eso conviene que las probabilidades de tus etapas reflejen tu historia (ver [las reglas de higiene del pipeline](/blog/higiene-del-pipeline)). Cuando un deal no calza con la regla por defecto, cada deal permite elegir su categoría a mano, y existe la opción Omitir para sacarlo del forecast sin perderlo ni marcarlo como perdido. Un deal en pausa porque el cliente espera presupuesto del año siguiente es el caso típico.

## Paso 3: poné una meta por persona

Un número sin meta no dice si vas bien. Cargá la cuota de valor ganado de cada persona en los ajustes del CRM (sección Cuotas). El forecast la muestra al lado de lo ganado y calcula el porcentaje de avance.

Ejemplo con números inventados para ilustrar, no de ningún cliente: una meta mensual de 20.000 USD para Ana, 8.000 ganados el día 15, 6.000 en commit y 9.000 en best case.

- Ganado más commit: 14.000. Faltan 6.000 para la meta.
- Con todo el best case: 23.000. La meta se alcanza solo si cierran casi todos los deals esperanzadores.

Ese segundo renglón es lo que querés ver el día 15 y no el 28: hace falta abrir deals nuevos ahora, no rezar.

## Paso 4: que cada persona envíe su número

Acá está la parte que más distingue un forecast de un reporte. El reporte lo calcula el sistema. El envío lo hace una persona: mira su ganado más commit, ajusta con lo que sabe y manda un número con una nota opcional.

En zerosoft cada envío queda guardado con fecha, y vale el último, pero el historial se puede abrir. Eso permite ver cuánto cambió el número durante el mes y quién ajusta siempre hacia abajo sobre el final. Mirá esa tendencia sin acusar a nadie: suele indicar que el criterio de commit está flojo, no que alguien mienta.

Una rutina que funciona con cinco personas:

1. Lunes, 15 minutos: cada persona envía su forecast del mes.
2. Se abre la vista del equipo y se revisan solo los deals en commit con fecha de cierre cerca.
3. Los deals que cambiaron de categoría desde la semana pasada se explican en una frase.

## Paso 5: arreglá lo que rompe el forecast

Tres problemas ensucian el número casi siempre:

- **Deals sin fecha de cierre.** No entran en ningún período. La vista de forecast avisa cuántos deals abiertos no tienen fecha, y es la lista que hay que limpiar primero.
- **Fechas viejas.** Un deal "para el 30 de abril" que sigue abierto en noviembre infla el pipeline. Usá la tabla de deals ordenada por fecha de cierre en tu [revisión semanal](/blog/revision-semanal-del-crm).
- **Monedas mezcladas.** El CRM convierte a la moneda base del workspace con los tipos de cambio que cargues a mano; si falta una tasa, cuenta 1 a 1 y queda listada en los reportes. Cargá las tasas del mes antes de mirar totales.

También sirve filtrar por pipeline: renovaciones y negocio nuevo tienen ciclos distintos, y juntarlos produce un promedio que no describe a ninguno.

## Lo que todavía no hace

Una aclaración honesta: el forecast de zerosoft usa las probabilidades de etapa y las categorías que definís vos. No calcula probabilidades a partir de tu historial de cierres ni predice con modelos. Para un equipo chico es una ventaja, porque podés explicar de dónde sale cada peso del número. Si tu volumen justifica un modelo estadístico, hoy tendrías que exportar los deals (CSV o JSON) y hacerlo afuera.

## Dónde vive tu forecast

Un forecast guarda decisiones: quién prometió qué y cuándo. Esa historia es de tu empresa. En zerosoft los envíos están en tu base de datos, sea el self-host por $0 o zerosoft Cloud, y el CRM exporta todo cuando quieras irte. El forecast se arma en el CRM, pero la pelea de siempre (el deal que nadie actualiza) se resuelve con [tareas y workflows](/blog/workflows-crm-tareas-de-seguimiento) que crean el próximo paso solos.

## Resumen para imprimir

1. Ganado más commit es el plan. Best case es margen.
2. Escribí el criterio de commit y no lo cambies a mitad de mes.
3. Una meta por persona, cargada.
4. Cada persona envía su número el lunes, con una nota.
5. Limpiá deals sin fecha, fechas viejas y monedas antes de mirar totales.
6. Revisá el historial de envíos a fin de mes: ahí está lo que aprendés.
