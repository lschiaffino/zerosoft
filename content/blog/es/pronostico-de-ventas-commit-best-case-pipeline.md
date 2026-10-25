---
title: "Un pronóstico de ventas que se puede defender: commit, best case y pipeline"
description: "Cómo armar el forecast mensual de un equipo chico con tres categorías, una meta por persona y un número enviado cada período, y cómo se hace en zerosoft CRM."
date: "2026-10-25"
author: "zerosoft"
tags: ["crm", "ventas", "forecast"]
---

Hay dos formas comunes de pronosticar ventas en un equipo chico. La primera es sumar todo lo que está abierto y llamarlo "pipeline". La segunda es preguntarle al líder del equipo cuánto cree que se cierra y anotar la respuesta. La primera da un número inflado. La segunda da un número que depende del humor de esa semana.

Pipedrive publica una [guía de pronóstico de ventas](https://pipedrive.com/es/blog/pronostico-de-ventas) que recomienda combinar métodos cuantitativos y cualitativos. Estamos de acuerdo con eso. Acá va una versión concreta para equipos de dos a quince personas: qué categorías usar, cómo fijar metas, qué número se envía y cómo se corrige con el tiempo. Cada paso está mapeado a lo que zerosoft CRM hace hoy.

## Un número solo no alcanza: tres categorías

Un pronóstico útil separa lo que ya pasó de lo que podría pasar. Con cuatro columnas alcanza:

- **Ganado**: deals cerrados como ganados dentro del período.
- **Commit**: deals abiertos que el vendedor se juega a cerrar en el período.
- **Best case**: deals abiertos que pueden cerrarse si todo sale bien.
- **Pipeline**: el resto de lo abierto con fecha de cierre en el período.

La suma de ganado y commit es el número "más probable". Es el que se le dice al resto de la empresa. Best case y pipeline son el margen: lo que explica por qué un mes salió mejor de lo previsto.

En zerosoft, el forecast (`/app/crm/forecast`) muestra exactamente esas columnas por mes o por trimestre, con la meta al lado y un total ponderado. Un detalle que conviene saber: los deals abiertos cuentan en el período de su fecha de cierre, y los ganados en el período en que se cerraron. Un deal abierto sin fecha de cierre no entra en ningún período. La pantalla te avisa cuántos hay ("N deals abiertos no tienen fecha de cierre"), y esa cifra es el primer pendiente de cada revisión.

## La categoría sale de la etapa, y se puede pisar

Para no pedirle a nadie que clasifique cada deal a mano, zerosoft asigna la categoría según la probabilidad de la etapa:

- 70% o más: commit.
- 40% o más y menos de 70%: best case.
- Menos de 40%: pipeline.

Esos umbrales están en el código, no son configurables todavía. Si tus probabilidades por etapa son razonables, la mayoría de los deals ya cae donde corresponde.

Después viene lo más valioso: cada deal tiene un selector de categoría en la tabla del forecast, con la opción "Automática" y las cuatro manuales. Pisarla es una decisión de criterio. Un deal en Negociación (70%) del que sabés que el comprador está esperando presupuesto se baja a best case. Un deal en Propuesta (40%) con orden de compra firmada pero sin facturar sube a commit. También existe "Omitir", que saca el deal del pronóstico sin cerrarlo, útil para un deal dormido que no querés perder pero tampoco contar.

Cada cambio de categoría queda en el historial del deal con quién lo hizo, así que en la revisión podés preguntar "¿por qué este deal bajó de commit?" y la respuesta está registrada.

## Metas por persona, no una meta para todos

Un pronóstico sin meta es una lista de montos. Con meta, es una distancia. En la configuración del CRM cargás una cuota de valor ganado por persona, mensual o trimestral. El forecast la usa para mostrar cuánto de la meta ya está ganado en cada fila ("45,5% de la meta ganado") y el total del equipo suma las metas individuales.

Una regla práctica para fijarlas: partí de lo que el equipo ganó en los últimos tres períodos del mismo tipo, no de lo que la empresa necesita. Si la diferencia entre ambos es grande, es un problema de plan y conviene discutirlo como tal, no tapado con una meta que nadie cree.

Si trabajan con equipos de ventas definidos, el forecast se filtra por equipo y por pipeline. Eso sirve cuando tenés un pipeline de negocio nuevo y otro de renovaciones y no querés mezclar los dos números.

## El número que envía cada persona

La parte cualitativa del método es esta: cada vendedor mira sus deals y envía **un número** para el período. Puede coincidir con ganado más commit o no. Si no coincide, la nota (hasta 500 caracteres) explica por qué: "el deal de $18.000 depende de que el cliente apruebe el presupuesto el 3".

En zerosoft, cada envío se guarda con fecha, autor y nota. Vale el último, pero el historial queda visible desde "Ver historial de envíos". Esto permite ver cuánto cambió el número durante el mes, algo que una planilla compartida pisa sin dejar rastro. Los admins pueden ajustar el número de otra persona, y el historial muestra quién lo hizo.

Cuando ganado más commit y el número enviado difieren en más de un 15 o 20% de forma sistemática, ahí hay algo para conversar: o la persona es conservadora, o las etapas no reflejan la realidad.

## Cuando hay deals compartidos

Si dos personas trabajan un deal, el forecast puede repartirlo por porcentaje. Los splits de cada deal se cuentan en las filas por persona, en las cuotas y en el total, de modo que un deal de $10.000 dividido 60/40 aporta $6.000 y $4.000 y el total sigue siendo $10.000, no $20.000. Si no hay splits, el deal entero es del responsable.

## La revisión mensual en 20 minutos

Una plantilla para la reunión, usando solo la pantalla de forecast:

1. **Cerrá el período anterior.** Mirá el mes pasado con el botón "Período anterior". Comparás meta, ganado y número enviado. Anotá la diferencia entre el número enviado y lo ganado, por persona.
2. **Arreglá lo que no cuenta.** Revisá el aviso de deals sin fecha de cierre. Cada uno recibe fecha o se cierra.
3. **Revisá commit uno por uno.** Para cada deal en commit, una pregunta: ¿qué tiene que pasar para que cierre y cuándo? Si nadie sabe contestar, baja a best case.
4. **Mirá el siguiente período.** Con "Período siguiente" ves qué entra el mes que viene. Si la suma de commit y best case no llega a la meta, el problema se ve con tiempo.
5. **Cada persona envía su número.** Con nota. Se hace en la misma reunión, no después.

Veinte minutos alcanzan para cinco personas. Para más, cada líder de equipo hace los pasos 3 y 5 antes y la reunión se dedica a las diferencias.

## Qué todavía no hace

Para no prometer de más: zerosoft no calcula pronósticos con modelos estadísticos ni predice fechas de cierre por su cuenta. El forecast es aritmética transparente sobre las categorías y probabilidades que vos definís, y esa es la idea. Los umbrales de 70% y 40% no se editan desde la interfaz. Y si querés cruzar el forecast con otros datos, el constructor de reportes permite agrupar por categoría de forecast.

## Cómo probarlo

Si ya estás en zerosoft, abrí CRM, Reportes y Forecast. Cargá una cuota por persona en la configuración y revisá las categorías de los deals abiertos del mes. Si venís de otro CRM, la [migración de contactos por CSV](/blog/migrar-contactos-de-hubspot-por-csv) te deja empezar con datos reales. Y como el código es abierto bajo AGPL, podés correr todo en tu propia infraestructura y leer en `lib/crm-forecast.ts` exactamente cómo se calcula cada columna.

Un buen pronóstico se discute cada mes con los mismos números a la vista, y cada ciclo lo vuelve más honesto.
